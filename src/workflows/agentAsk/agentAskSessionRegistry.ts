import {
  createAgentSession,
  type AgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  createAgentToolBlock,
  formatPiAgentOutputUpdate,
} from "../../lib/agentOutput/piAgentOutputAdapter";
import { buildAgentPromptWithContext } from "../../lib/llm/agentContext";
import { useAppStore } from "../../store/appStore";
import type { AgentAskMode, ContextItem } from "../../types";
import {
  activateAgentAskTools,
  createAgentAskResourceLoader,
} from "./agentAskResources";
import {
  createAgentSandbox,
  getAgentSandboxDiff,
  removeAgentSandbox,
  type AgentSandbox,
} from "./agentSandbox";

type AgentAskHandle = {
  sandbox?: AgentSandbox;
  session: AgentSession;
  unsubscribe: () => void;
};

const agentAskSessions = new Map<string, AgentAskHandle>();

export async function startAgentAskSession({
  itemId,
  contextItems,
  focusedContextItemId,
  mode = "ask",
  prompt,
  root = process.cwd(),
}: {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  itemId: string;
  mode?: AgentAskMode;
  prompt: string;
  root?: string;
}) {
  let sandbox: AgentSandbox | undefined;

  try {
    const initialPrompt = await buildAgentPromptWithContext({
      contextItems,
      focusedContextItemId,
      prompt,
      root,
    });
    sandbox = mode === "edit" ? await createAgentSandbox({ root }) : undefined;
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
    }

    const resourceLoader = await createAgentAskResourceLoader({
      root: sessionRoot,
    });
    const { session } = await createAgentSession({
      cwd: sessionRoot,
      noTools: "builtin",
      resourceLoader,
      sessionManager: SessionManager.inMemory(sessionRoot),
    });
    activateAgentAskTools(session, mode);

    const unsubscribe = session.subscribe((event) => {
      const update = formatPiAgentOutputUpdate(event);
      if (update !== null) {
        useAppStore
          .getState()
          .actions.agentAsk.recordOutput({ itemId, update });
      }
    });

    agentAskSessions.set(itemId, { sandbox, session, unsubscribe });
    useAppStore.getState().actions.agentAsk.recordOutput({
      itemId,
      update: {
        block: createAgentToolBlock({
          phase: "start",
          summary:
            mode === "edit"
              ? "agent edit sandbox session"
              : "agent ask session",
          toolName: "pi",
        }),
        kind: "append-block",
      },
    });
    await runAgentPrompt(itemId, initialPrompt);
  } catch (error) {
    if (sandbox !== undefined) {
      await removeAgentSandbox(sandbox);
    }
    useAppStore.getState().actions.agentAsk.fail({
      errorMessage: error instanceof Error ? error.message : String(error),
      itemId,
    });
  }
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

export function disposeAgentAskSession(itemId: string) {
  const handle = agentAskSessions.get(itemId);
  if (handle === undefined) {
    return;
  }

  handle.unsubscribe();
  handle.session.dispose();
  if (handle.sandbox !== undefined) {
    void removeAgentSandbox(handle.sandbox);
  }
  agentAskSessions.delete(itemId);
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
}

async function runAgentPrompt(itemId: string, message: string) {
  const handle = agentAskSessions.get(itemId);
  if (handle === undefined) {
    return;
  }

  try {
    const wasStreaming = handle.session.isStreaming;
    if (wasStreaming) {
      await handle.session.followUp(message);
      return;
    }

    await handle.session.prompt(message);
    if (handle.sandbox !== undefined) {
      await refreshAgentSandboxDiff(itemId, handle.sandbox);
    }
    useAppStore.getState().actions.agentAsk.finish({ itemId });
  } catch (error) {
    useAppStore.getState().actions.agentAsk.fail({
      errorMessage: error instanceof Error ? error.message : String(error),
      itemId,
    });
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
