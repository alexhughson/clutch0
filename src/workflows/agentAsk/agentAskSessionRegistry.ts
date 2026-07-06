import {
  type AgentSession,
  type ResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  createAgentToolBlock,
  createPiAgentOutputFormatter,
  getLatestAssistantText,
  type PiAgentOutputFormatter,
} from "../../lib/agentOutput/piAgentOutputAdapter";
import type { AgentOutputUpdate } from "../../lib/agentOutput/agentOutputTypes";
import { buildAgentPromptWithContext } from "../../lib/llm/agentContext";
import { createConfiguredPiAgentSession } from "../../lib/llm/piAgentSession";
import { recordSessionRuntimeEvent, useAppStore } from "../../store/appStore";
import type { AgentAskMode, ContextItem } from "../../types";
import {
  activateAgentAskTools,
  createAgentAskResourceLoader,
} from "./agentAskResources";
import { buildAgentSkillKickoffPrompt } from "./agentSkillKickoff";
import {
  createAgentSandbox,
  getAgentSandboxDiff,
  removeAgentSandbox,
  type AgentSandbox,
} from "./agentSandbox";

type AgentAskHandle = {
  outputFormatter: PiAgentOutputFormatter;
  sandbox?: AgentSandbox;
  session: AgentSession;
  unsubscribe: () => void;
};

type AgentAskStartupHandle = {
  abort: () => void;
  done: Promise<void>;
  sandbox?: AgentSandbox;
  session?: AgentSession;
  unsubscribe?: () => void;
  registered: boolean;
};

const agentAskSessions = new Map<string, AgentAskHandle>();
const agentAskStartups = new Map<string, AgentAskStartupHandle>();

export async function startAgentAskSession({
  itemId,
  contextItems,
  focusedContextItemId,
  mode = "ask",
  prompt,
  root = process.cwd(),
  signal,
  skillName,
}: {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  itemId: string;
  mode?: AgentAskMode;
  prompt: string;
  root?: string;
  signal?: AbortSignal;
  skillName?: string;
}) {
  if (agentAskSessions.has(itemId) || agentAskStartups.has(itemId)) {
    throw new Error(`Agent session already exists for context item ${itemId}.`);
  }

  const abortHandle = createStartupAbortHandle(signal);
  const startup: AgentAskStartupHandle = {
    abort: abortHandle.abort,
    done: Promise.resolve(),
    registered: false,
  };
  agentAskStartups.set(itemId, startup);
  startup.done = runAgentAskSessionStartup({
    contextItems,
    focusedContextItemId,
    itemId,
    mode,
    prompt,
    root,
    signal: abortHandle.signal,
    skillName,
    startup,
  }).finally(() => {
    abortHandle.dispose();
    agentAskStartups.delete(itemId);
  });
  await startup.done;
}

async function runAgentAskSessionStartup({
  itemId,
  contextItems,
  focusedContextItemId,
  mode,
  prompt,
  root,
  signal,
  skillName,
  startup,
}: {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  itemId: string;
  mode: AgentAskMode;
  prompt: string;
  root: string;
  signal: AbortSignal;
  skillName?: string;
  startup: AgentAskStartupHandle;
}) {
  recordSessionRuntimeEvent({
    contextItemIds: contextItems.map((item) => item.id),
    focusedContextItemId,
    itemId,
    kind: "agent-session.started",
    mode,
    skillName,
  });

  try {
    throwIfAgentSessionAborted(signal);
    const sandbox =
      mode === "edit" ? await createAgentSandbox({ root, signal }) : undefined;
    startup.sandbox = sandbox;
    throwIfAgentSessionAborted(signal);
    const sessionRoot = sandbox?.path ?? root;
    if (sandbox !== undefined) {
      useAppStore.getState().actions.agentAsk.attachSandbox({
        itemId,
        sandbox: {
          baselineTree: sandbox.baselineTree,
          diffStatus: "unknown",
          path: sandbox.path,
          root: sandbox.root,
        },
      });
      recordSessionRuntimeEvent({
        itemId,
        kind: "agent-session.sandbox-attached",
        sandboxPath: sandbox.path,
      });
    }

    const resourceLoader = await createAgentAskResourceLoader({
      root: sessionRoot,
    });
    throwIfAgentSessionAborted(signal);
    const initialPrompt = await buildInitialAgentPrompt({
      contextItems,
      focusedContextItemId,
      prompt,
      resourceLoader,
      root: sessionRoot,
      skillName,
    });
    throwIfAgentSessionAborted(signal);
    const { session } = await createConfiguredPiAgentSession({
      cwd: sessionRoot,
      noTools: "builtin",
      resourceLoader,
      sessionManager: SessionManager.inMemory(sessionRoot),
    });
    startup.session = session;
    if (isAgentSessionAborted(signal)) {
      throw new Error("Agent session was aborted.");
    }
    activateAgentAskTools(session, mode);

    const outputFormatter = createPiAgentOutputFormatter();
    const unsubscribe = session.subscribe((event) => {
      recordAgentOutputUpdates({
        itemId,
        source: "event",
        updates: outputFormatter.format(event),
      });
    });
    startup.unsubscribe = unsubscribe;
    if (isAgentSessionAborted(signal)) {
      throw new Error("Agent session was aborted.");
    }

    agentAskSessions.set(itemId, {
      outputFormatter,
      sandbox,
      session,
      unsubscribe,
    });
    startup.registered = true;
    startup.sandbox = undefined;
    startup.session = undefined;
    startup.unsubscribe = undefined;
    agentAskStartups.delete(itemId);
    useAppStore.getState().actions.agentAsk.recordOutput({
      itemId,
      update: {
        block: createAgentToolBlock({
          phase: "start",
          summary:
            skillName !== undefined
              ? `agent skill ${skillName}`
              : mode === "edit"
                ? "agent edit sandbox session"
                : "agent ask session",
          toolName: "pi",
        }),
        kind: "append-block",
      },
    });
    await runAgentPrompt(itemId, initialPrompt);
  } catch (error) {
    await disposeAgentAskStartup(startup);
    recordSessionRuntimeEvent({
      errorMessage: error instanceof Error ? error.message : String(error),
      itemId,
      kind: "agent-session.failed",
    });
    useAppStore.getState().actions.agentAsk.fail({
      errorMessage: error instanceof Error ? error.message : String(error),
      itemId,
    });
  }
}

function throwIfAgentSessionAborted(signal: AbortSignal | undefined) {
  if (isAgentSessionAborted(signal)) {
    throw new Error("Agent session was aborted.");
  }
}

function isAgentSessionAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function buildInitialAgentPrompt({
  contextItems,
  focusedContextItemId,
  prompt,
  resourceLoader,
  root,
  skillName,
}: {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  prompt: string;
  resourceLoader: ResourceLoader;
  root: string;
  skillName?: string;
}) {
  const userMessage = await buildAgentPromptWithContext({
    contextItems,
    focusedContextItemId,
    prompt,
    root,
  });

  if (skillName === undefined) {
    return userMessage;
  }

  return await buildAgentSkillKickoffPrompt({
    resourceLoader,
    skillName,
    userMessage,
  });
}

export async function sendAgentAskMessage({
  itemId,
  message,
}: {
  itemId: string;
  message: string;
}) {
  if (message.trim().length === 0) {
    return;
  }

  const handle = agentAskSessions.get(itemId);
  if (handle === undefined) {
    useAppStore.getState().actions.agentAsk.fail({
      errorMessage:
        "This agent session is no longer available in this Clutch process.",
      itemId,
    });
    return;
  }

  useAppStore.getState().actions.agentAsk.startMessage({ itemId });
  await runAgentPrompt(itemId, message);
}

export async function disposeAgentAskSession(itemId: string): Promise<void> {
  const startup = agentAskStartups.get(itemId);
  if (startup !== undefined) {
    startup.abort();
    await startup.done;
    return;
  }

  const handle = agentAskSessions.get(itemId);
  if (handle === undefined) {
    return;
  }

  handle.unsubscribe();
  handle.session.dispose();
  recordSessionRuntimeEvent({
    itemId,
    kind: "agent-session.disposed",
    sandboxPath: handle.sandbox?.path,
  });
  agentAskSessions.delete(itemId);
  if (handle.sandbox !== undefined) {
    await removeAgentSandbox(handle.sandbox);
  }
}

export async function disposeAllAgentAskSessions(): Promise<void> {
  const startups = [...agentAskStartups.values()];
  for (const startup of startups) {
    startup.abort();
  }

  await Promise.all(
    [
      ...[...agentAskSessions.keys()].map((itemId) =>
        disposeAgentAskSession(itemId),
      ),
      ...startups.map((startup) => startup.done),
    ],
  );
}

export async function saveAgentSandboxDiffToContext(itemId: string) {
  const handle = agentAskSessions.get(itemId);
  if (handle?.sandbox === undefined) {
    useAppStore.getState().actions.agentAsk.fail({
      errorMessage: "This agent edit session does not have an active sandbox.",
      itemId,
    });
    return;
  }

  const diff = await refreshAgentSandboxDiff(itemId, handle.sandbox);
  if (diff.diffText.trim().length === 0) {
    useAppStore.getState().actions.agentAsk.recordOutput({
      itemId,
      update: {
        block: createAgentToolBlock({
          phase: "end",
          summary: "No sandbox changes to add to context.",
          toolName: "git diff",
        }),
        kind: "append-block",
      },
    });
    return;
  }

  useAppStore.getState().actions.agentAsk.saveSandboxDiffToContext({
    agentItemId: itemId,
    diffText: diff.diffText,
    summary: diff.summary,
  });
  recordSessionRuntimeEvent({
    itemId,
    kind: "agent-session.sandbox-diff-saved",
    summary: diff.summary,
  });
}

async function runAgentPrompt(itemId: string, message: string) {
  const handle = agentAskSessions.get(itemId);
  if (handle === undefined) {
    return;
  }

  try {
    const wasStreaming = handle.session.isStreaming;
    recordSessionRuntimeEvent({
      followUp: wasStreaming,
      itemId,
      kind: "agent-session.prompt-started",
      messageLength: message.length,
    });
    if (wasStreaming) {
      await handle.session.followUp(message);
      return;
    }

    handle.outputFormatter.beginPrompt();
    await handle.session.prompt(message);
    recordFinalAgentOutput(itemId, handle);
    if (handle.sandbox !== undefined) {
      await refreshAgentSandboxDiff(itemId, handle.sandbox);
    }
    recordSessionRuntimeEvent({
      itemId,
      kind: "agent-session.prompt-finished",
    });
    useAppStore.getState().actions.agentAsk.finish({ itemId });
  } catch (error) {
    recordSessionRuntimeEvent({
      errorMessage: error instanceof Error ? error.message : String(error),
      itemId,
      kind: "agent-session.prompt-failed",
    });
    useAppStore.getState().actions.agentAsk.fail({
      errorMessage: error instanceof Error ? error.message : String(error),
      itemId,
    });
  }
}

function recordFinalAgentOutput(itemId: string, handle: AgentAskHandle) {
  const updates = handle.outputFormatter.formatFinalMessages(
    handle.session.messages,
  );
  if (updates.length === 0) {
    return;
  }

  recordSessionRuntimeEvent({
    itemId,
    kind: "agent-session.final-output-reconciled",
    messageLength: getLatestAssistantText(handle.session.messages)?.length ?? 0,
    updateCount: updates.length,
  });
  recordAgentOutputUpdates({ itemId, source: "final-state", updates });
}

function recordAgentOutputUpdates({
  itemId,
  source,
  updates,
}: {
  itemId: string;
  source: "event" | "final-state";
  updates: readonly AgentOutputUpdate[];
}) {
  for (const update of updates) {
    recordSessionRuntimeEvent({
      itemId,
      kind: "agent-session.output",
      source,
      updateKind: update.kind,
    });
    useAppStore.getState().actions.agentAsk.recordOutput({ itemId, update });
  }
}

async function refreshAgentSandboxDiff(itemId: string, sandbox: AgentSandbox) {
  try {
    const diff = await getAgentSandboxDiff(sandbox);
    useAppStore.getState().actions.agentAsk.updateSandboxDiff({
      itemId,
      sandbox: {
        baselineTree: sandbox.baselineTree,
        diffStatus: diff.diffText.trim().length === 0 ? "clean" : "dirty",
        path: sandbox.path,
        root: sandbox.root,
        summary: diff.summary,
      },
    });
    return diff;
  } catch (error) {
    useAppStore.getState().actions.agentAsk.updateSandboxDiff({
      itemId,
      sandbox: {
        baselineTree: sandbox.baselineTree,
        diffStatus: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
        path: sandbox.path,
        root: sandbox.root,
      },
    });
    throw error;
  }
}

function createStartupAbortHandle(parentSignal: AbortSignal | undefined): {
  abort: () => void;
  dispose: () => void;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };

  if (parentSignal?.aborted === true) {
    controller.abort();
  } else {
    parentSignal?.addEventListener("abort", abort, { once: true });
  }

  return {
    abort,
    dispose: () => {
      parentSignal?.removeEventListener("abort", abort);
    },
    signal: controller.signal,
  };
}

async function disposeAgentAskStartup(
  startup: AgentAskStartupHandle,
): Promise<void> {
  if (startup.registered) {
    return;
  }

  startup.unsubscribe?.();
  startup.session?.dispose();
  if (startup.sandbox !== undefined) {
    await removeAgentSandbox(startup.sandbox);
  }
  startup.sandbox = undefined;
  startup.session = undefined;
  startup.unsubscribe = undefined;
}
