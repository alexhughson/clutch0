import {
  createAgentSession,
  type AgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  createAgentToolBlock,
  formatPiAgentOutputUpdate,
} from "../../lib/agentOutput/piAgentOutputAdapter";
import { useAppStore } from "../../store/appStore";
import {
  activateAgentAskTools,
  createAgentAskResourceLoader,
} from "./agentAskResources";

type AgentAskHandle = {
  session: AgentSession;
  unsubscribe: () => void;
};

const agentAskSessions = new Map<string, AgentAskHandle>();

export async function startAgentAskSession({
  itemId,
  prompt,
  root = process.cwd(),
}: {
  itemId: string;
  prompt: string;
  root?: string;
}) {
  try {
    const resourceLoader = await createAgentAskResourceLoader({ root });
    const { session } = await createAgentSession({
      cwd: root,
      noTools: "builtin",
      resourceLoader,
      sessionManager: SessionManager.inMemory(root),
    });
    activateAgentAskTools(session);

    const unsubscribe = session.subscribe((event) => {
      const update = formatPiAgentOutputUpdate(event);
      if (update !== null) {
        useAppStore
          .getState()
          .actions.agentAsk.recordOutput({ itemId, update });
      }
    });

    agentAskSessions.set(itemId, { session, unsubscribe });
    useAppStore.getState().actions.agentAsk.recordOutput({
      itemId,
      update: {
        block: createAgentToolBlock({
          phase: "start",
          summary: "agent ask session",
          toolName: "pi",
        }),
        kind: "append-block",
      },
    });
    await runAgentPrompt(itemId, prompt);
  } catch (error) {
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
  agentAskSessions.delete(itemId);
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
    useAppStore.getState().actions.agentAsk.finish({ itemId });
  } catch (error) {
    useAppStore.getState().actions.agentAsk.fail({
      errorMessage: error instanceof Error ? error.message : String(error),
      itemId,
    });
  }
}
