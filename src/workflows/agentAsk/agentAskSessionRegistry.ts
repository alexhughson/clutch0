import {
  createAcpAgentSessionDriver,
  type CreateAcpAgentSessionDriverOptions,
  type AgentSessionDriver,
} from "../../lib/agent/acpAgentSessionDriver";
import { createAgentToolBlock } from "../../lib/agentOutput/acpAgentOutputAdapter";
import type { AgentOutputUpdate } from "../../lib/agentOutput/agentOutputTypes";
import { resolveConfiguredAgentBackend } from "../../lib/config/clutchConfig";
import { buildAgentPromptWithContext } from "../../lib/llm/agentContext";
import { recordSessionRuntimeEvent, useAppStore } from "../../store/appStore";
import type { AgentAskMode, ContextItem } from "../../types";
import {
  createAgentSandbox,
  getAgentSandboxDiff,
  removeAgentSandbox,
  type AgentSandbox,
} from "./agentSandbox";

type AgentAskHandle = {
  activePromptCount: number;
  driver: AgentSessionDriver;
  sandbox?: AgentSandbox;
};

type AgentAskStartupHandle = {
  abort: () => void;
  done: Promise<void>;
  driver?: AgentSessionDriver;
  sandbox?: AgentSandbox;
  registered: boolean;
};

const agentAskSessions = new Map<string, AgentAskHandle>();
const agentAskStartups = new Map<string, AgentAskStartupHandle>();
let createAgentSessionDriver = createAcpAgentSessionDriver;

export function setCreateAgentSessionDriverForTest(
  factory: (
    options: CreateAcpAgentSessionDriverOptions,
  ) => Promise<AgentSessionDriver>,
) {
  const previous = createAgentSessionDriver;
  createAgentSessionDriver = factory;
  return () => {
    createAgentSessionDriver = previous;
  };
}

export async function startAgentAskSession({
  itemId,
  contextItems,
  focusedContextItemId,
  mode = "ask",
  prompt,
  root = process.cwd(),
  signal,
}: {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  itemId: string;
  mode?: AgentAskMode;
  prompt: string;
  root?: string;
  signal?: AbortSignal;
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
  startup,
}: {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  itemId: string;
  mode: AgentAskMode;
  prompt: string;
  root: string;
  signal: AbortSignal;
  startup: AgentAskStartupHandle;
}) {
  recordSessionRuntimeEvent({
    contextItemIds: contextItems.map((item) => item.id),
    focusedContextItemId,
    itemId,
    kind: "agent-session.started",
    mode,
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

    const initialPrompt = await buildInitialAgentPrompt({
      contextItems,
      focusedContextItemId,
      prompt,
      root: sessionRoot,
    });
    throwIfAgentSessionAborted(signal);
    const backend = resolveConfiguredAgentBackend();
    const driver = await createAgentSessionDriverWithAbort({
      create: () =>
        createAgentSessionDriver({
          backend,
          cwd: sessionRoot,
          onOutputUpdate: (update) => {
            recordAgentOutputUpdates({
              itemId,
              source: "event",
              updates: [update],
            });
          },
          signal,
        }),
      signal,
    });
    startup.driver = driver;
    throwIfAgentSessionAborted(signal);

    agentAskSessions.set(itemId, {
      activePromptCount: 0,
      driver,
      sandbox,
    });
    startup.registered = true;
    startup.sandbox = undefined;
    startup.driver = undefined;
    agentAskStartups.delete(itemId);
    useAppStore.getState().actions.agentAsk.recordOutput({
      itemId,
      update: {
        block: createAgentToolBlock({
          phase: "start",
          summary:
            mode === "edit"
              ? "agent edit sandbox session"
              : "agent ask session",
          toolName: "agent",
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
  root,
}: {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  prompt: string;
  root: string;
}) {
  return await buildAgentPromptWithContext({
    contextItems,
    focusedContextItemId,
    prompt,
    root,
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

  try {
    await handle.driver.dispose();
    recordSessionRuntimeEvent({
      itemId,
      kind: "agent-session.disposed",
      sandboxPath: handle.sandbox?.path,
    });
  } finally {
    agentAskSessions.delete(itemId);
    if (handle.sandbox !== undefined) {
      await removeAgentSandbox(handle.sandbox);
    }
  }
}

export async function disposeAllAgentAskSessions(): Promise<void> {
  const startups = [...agentAskStartups.values()];
  for (const startup of startups) {
    startup.abort();
  }

  await Promise.all([
    ...[...agentAskSessions.keys()].map((itemId) =>
      disposeAgentAskSession(itemId),
    ),
    ...startups.map((startup) => startup.done),
  ]);
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

  handle.activePromptCount += 1;
  try {
    recordSessionRuntimeEvent({
      followUp: handle.activePromptCount > 1,
      itemId,
      kind: "agent-session.prompt-started",
      messageLength: message.length,
    });

    await handle.driver.prompt(message);
    recordFinalAgentOutput(itemId, handle);
    if (handle.sandbox !== undefined) {
      await refreshAgentSandboxDiff(itemId, handle.sandbox);
    }
    recordSessionRuntimeEvent({
      itemId,
      kind: "agent-session.prompt-finished",
    });
    handle.activePromptCount -= 1;
    if (handle.activePromptCount === 0) {
      useAppStore.getState().actions.agentAsk.finish({ itemId });
    }
  } catch (error) {
    handle.activePromptCount = Math.max(0, handle.activePromptCount - 1);
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
  const latestAssistantText = handle.driver.latestAssistantText();
  if (latestAssistantText === null || latestAssistantText.trim().length === 0) {
    throw new Error("ACP agent did not produce assistant text.");
  }

  recordSessionRuntimeEvent({
    itemId,
    kind: "agent-session.final-output-reconciled",
    messageLength: latestAssistantText.length,
    updateCount: 0,
  });
}

function recordAgentOutputUpdates({
  itemId,
  source,
  updates,
}: {
  itemId: string;
  source: "event";
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

  try {
    await startup.driver?.dispose();
  } finally {
    if (startup.sandbox !== undefined) {
      await removeAgentSandbox(startup.sandbox);
    }
    startup.sandbox = undefined;
    startup.driver = undefined;
  }
}

async function createAgentSessionDriverWithAbort({
  create,
  signal,
}: {
  create: () => Promise<AgentSessionDriver>;
  signal: AbortSignal;
}): Promise<AgentSessionDriver> {
  const driverPromise = create();
  if (!signal.aborted) {
    const abortPromise = new Promise<never>((_, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new Error("Agent session was aborted.")),
        { once: true },
      );
    });
    try {
      return await Promise.race([driverPromise, abortPromise]);
    } catch (error) {
      void driverPromise.then((driver) => driver.dispose()).catch(() => {});
      throw error;
    }
  }

  void driverPromise.then((driver) => driver.dispose()).catch(() => {});
  throw new Error("Agent session was aborted.");
}
