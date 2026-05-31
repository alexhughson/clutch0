import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import type { ContextItemViewerTaskState } from "../../app/appTypes";
import { AgentOutputLog } from "../../components/AgentOutputLog";
import {
  HighlightedCode,
  HighlightedDiff,
  HighlightedMarkdown,
} from "../../components/SyntaxHighlightedContent";
import {
  getContextItemById,
  PiAgentContextItem,
} from "../../lib/context/contextItems";
import { useAppStore } from "../../store/appStore";
import type { ContextItemAction, ContextItemDetailView } from "../../types";
import {
  disposeAgentAskSession,
  saveAgentSandboxDiffToContext,
  sendAgentAskMessage,
} from "../agentAsk/agentAskSessionRegistry";
import { startLlmRequest } from "../llmRequest/startLlmRequest";
import { startShellCommandRerun } from "../shellCommand/startShellCommandRequest";
import { applySavedDiffContextItem } from "./contextItemEffects";

export function ContextItemViewerScreen({
  screen,
}: {
  screen: ContextItemViewerTaskState;
}) {
  const actions = useAppStore((state) => state.actions);
  const item = useAppStore((state) =>
    getContextItemById(state.workspace.contextItems, screen.itemId),
  );
  const [detail, setDetail] = useState<ContextItemDetailView | null>(null);
  const liveAgentDetail =
    item instanceof PiAgentContextItem ? item.getLiveDetailView() : null;
  const visibleDetail = liveAgentDetail ?? detail;
  const canAct = screen.applyStatus !== "applying";
  const canRunItemActions = canAct && visibleDetail?.kind !== "agent-output";
  const itemActions = useMemo(
    () => item?.getActions().filter((action) => action.id !== "open") ?? [],
    [item],
  );

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    if (item === null || item instanceof PiAgentContextItem) {
      return;
    }

    void item.getDetailView({ root: process.cwd() }).then((nextDetail) => {
      if (!cancelled) {
        setDetail(nextDetail);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [item]);

  useKeyboard((event) => {
    if (!canAct) {
      return;
    }

    if (event.name === "escape") {
      event.preventDefault();
      event.stopPropagation();
      actions.navigation.showComposer();
      return;
    }

    if (!canRunItemActions) {
      return;
    }

    const action = getViewerActionForKey(event.name, itemActions);
    if (action === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    runContextItemAction(action);
  });

  return (
    <box
      title={detail?.title ?? item?.getListLabel() ?? "Context item"}
      bottomTitle={
        canRunItemActions
          ? getBottomTitle(itemActions)
          : canAct
            ? "Esc back"
            : undefined
      }
      bottomTitleAlignment="right"
      borderStyle="rounded"
      style={{
        border: true,
        flexDirection: "column",
        gap: 1,
        padding: 1,
        width: "100%",
      }}
    >
      {screen.applyStatus === "applying" ? (
        <text>Applying patch...</text>
      ) : null}
      {screen.applyErrorMessage === undefined ? null : (
        <text style={{ fg: "red" }}>{screen.applyErrorMessage}</text>
      )}
      {item === null ? (
        <text style={{ fg: "red" }}>Context item no longer exists.</text>
      ) : visibleDetail === null ? (
        <text>Loading...</text>
      ) : (
        <DetailView detail={visibleDetail} />
      )}
    </box>
  );
}

function DetailView({ detail }: { detail: ContextItemDetailView }) {
  if (detail.kind === "agent-output") {
    return <AgentDetailView detail={detail} />;
  }

  if (detail.kind === "code") {
    return (
      <scrollbox style={{ height: 40, width: "100%" }}>
        <HighlightedCode content={detail.content} filePath={detail.filePath} />
      </scrollbox>
    );
  }

  if (detail.kind === "markdown") {
    return (
      <scrollbox style={{ height: 40, width: "100%" }}>
        <HighlightedMarkdown content={detail.content} />
      </scrollbox>
    );
  }

  if (detail.kind === "diff") {
    return (
      <>
        <text>{detail.summary}</text>
        <scrollbox style={{ height: 38, width: "100%" }}>
          <HighlightedDiff diff={detail.diffText} />
        </scrollbox>
      </>
    );
  }

  return (
    <scrollbox style={{ height: 40, width: "100%" }}>
      <text>{detail.content}</text>
    </scrollbox>
  );
}

function AgentDetailView({
  detail,
}: {
  detail: Extract<ContextItemDetailView, { kind: "agent-output" }>;
}) {
  const [message, setMessage] = useState("");

  return (
    <box style={{ flexDirection: "column", gap: 1 }}>
      <text>{`Prompt: ${detail.prompt}`}</text>
      <text style={{ fg: detail.status === "error" ? "red" : "gray" }}>
        {detail.status === "running"
          ? "Agent running…"
          : detail.status === "error"
            ? `Agent error: ${detail.errorMessage ?? "unknown error"}`
            : "Agent idle"}
      </text>
      {detail.sandbox === undefined ? null : (
        <box style={{ flexDirection: "column" }}>
          <text>{`Sandbox: ${detail.sandbox.path}`}</text>
          <text>{`Sandbox diff: ${formatSandboxDiffStatus(detail.sandbox)}`}</text>
        </box>
      )}
      <AgentOutputLog blocks={detail.blocks} height={32} />
      <box
        title="Follow-up"
        borderStyle="rounded"
        style={{ border: true, height: 3 }}
      >
        <input
          value={message}
          placeholder="Send a follow-up to this agent session"
          focused
          onInput={setMessage}
          onKeyDown={(event: KeyEvent) => {
            if (event.ctrl && event.name === "d") {
              event.preventDefault();
              event.stopPropagation();
              void saveAgentSandboxDiffToContext(detail.itemId);
              return;
            }

            if (!isEnterKey(event.name)) {
              return;
            }

            const nextMessage = message.trim();
            if (nextMessage.length === 0) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            setMessage("");
            void sendAgentAskMessage({
              itemId: detail.itemId,
              message: nextMessage,
            });
          }}
          style={{ width: "100%" }}
        />
      </box>
    </box>
  );
}

function formatSandboxDiffStatus(
  sandbox: NonNullable<
    Extract<ContextItemDetailView, { kind: "agent-output" }>["sandbox"]
  >,
): string {
  if (sandbox.diffStatus === "error") {
    return `error: ${sandbox.errorMessage ?? "unknown error"}`;
  }

  if (sandbox.summary !== undefined && sandbox.summary.trim().length > 0) {
    return `${sandbox.diffStatus} — ${sandbox.summary.replace(/\s+/g, " ")}`;
  }

  return sandbox.diffStatus;
}

function isEnterKey(keyName: string): boolean {
  return (
    keyName === "return" || keyName === "kpenter" || keyName === "linefeed"
  );
}

function getViewerActionForKey(
  keyName: string,
  actions: readonly ContextItemAction[],
): ContextItemAction | null {
  const actionId =
    keyName === "a"
      ? "apply"
      : keyName === "r"
        ? "rerun"
        : keyName === "x"
          ? "remove"
          : null;

  if (actionId === null) {
    return null;
  }

  return actions.find((action) => action.id === actionId) ?? null;
}

function getBottomTitle(actions: readonly ContextItemAction[]): string {
  return [
    actions.some((action) => action.id === "apply") ? "a apply" : null,
    actions.some((action) => action.id === "rerun") ? "r rerun" : null,
    actions.some((action) => action.id === "remove") ? "x remove" : null,
    "Esc back",
  ]
    .filter((item): item is string => item !== null)
    .join(" · ");
}

function runContextItemAction(action: ContextItemAction) {
  void action.run({
    applyAgentSandboxDiff: (itemId) => {
      void applySavedDiffContextItem(itemId);
    },
    applySavedDiff: (itemId) => {
      void applySavedDiffContextItem(itemId);
    },
    openContextItem: (itemId) => {
      useAppStore.getState().actions.contextItems.openContextItem({ itemId });
    },
    removeContextItem: (itemId) => {
      disposeAgentAskSession(itemId);
      useAppStore.getState().actions.compose.removeContextItem({ itemId });
      useAppStore.getState().actions.navigation.showComposer();
    },
    rerunPrompt: ({ expectedResult, prompt, replaceContextItemId }) =>
      startLlmRequest(prompt, {
        replacement: {
          contextItemId: replaceContextItemId,
          expectedResult,
        },
      }),
    rerunShellCommand: ({ command, replaceContextItemId }) =>
      startShellCommandRerun({ command, replaceContextItemId }),
    saveAgentSandboxDiff: (itemId) => {
      void saveAgentSandboxDiffToContext(itemId);
    },
  });
}
