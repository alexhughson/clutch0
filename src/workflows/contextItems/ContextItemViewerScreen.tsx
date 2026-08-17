import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ContextItemViewerTaskState } from "../../app/appTypes";
import { isOpenFocusedContextItemKey } from "../../lib/keymap";
import { AgentOutputLog } from "../../components/AgentOutputLog";
import {
  HighlightedCode,
  HighlightedDiff,
  HighlightedMarkdown,
} from "../../components/SyntaxHighlightedContent";
import { getVisibleContextItemById } from "../../lib/context/automaticContextItems";
import {
  formatContextItemAction,
  formatPaneActionHints,
  getContextItemActionForKeyEvent,
  getContextItemActionForPaneKeyEvent,
} from "../../lib/context/contextItemActions";
import { useAppStore } from "../../store/appStore";
import type { ContextItemAction, ContextItemDetailView } from "../../types";
import { AgentSessionFollowUp } from "../agentAsk/AgentSessionFollowUp";
import { runContextItemAction } from "./contextItemActionRunner";

export function ContextItemViewerScreen({
  screen,
}: {
  screen: ContextItemViewerTaskState;
}) {
  const actions = useAppStore((state) => state.actions);
  const item = useAppStore((state) =>
    getVisibleContextItemById(
      state.workspace.contextItems,
      screen.itemId,
      state.workspace.automaticContextItems,
    ),
  );
  const [staticDetail, setStaticDetail] = useState<ContextItemDetailView | null>(
    null,
  );
  const liveDetail = item?.getLiveDetailView?.() ?? null;
  const detail = liveDetail ?? staticDetail;
  const isAgentDetail = detail?.kind === "agent-output";
  const canAct = screen.applyStatus !== "applying";
  const itemActions = useMemo(
    () => item?.getActions().filter((action) => action.id !== "open") ?? [],
    [item],
  );
  const canRunShortcutActions =
    canAct && detail !== null && detail.kind !== "editable-text";
  const canRunPaneActions =
    canRunShortcutActions && detail.kind !== "agent-output";
  const title = isAgentDetail
    ? undefined
    : (detail?.title ?? item?.getListLabel() ?? "Context item");
  const bottomTitle = isAgentDetail
    ? [
        formatAgentShortcutHints(itemActions),
        screen.rejectComposer === undefined ? "Esc back" : "Esc edit prompt",
      ]
        .filter((part): part is string => part !== undefined && part.length > 0)
        .join(" · ")
    : canRunPaneActions
      ? [
          formatPaneActionHints(itemActions),
          screen.rejectComposer === undefined ? "Esc back" : "Esc edit prompt",
        ]
          .filter((part) => part.length > 0)
          .join(" · ")
      : canAct
        ? screen.rejectComposer === undefined
          ? "Esc back"
          : "Esc edit prompt"
        : undefined;

  useEffect(() => {
    if (item === null || item.getLiveDetailView !== undefined) {
      return;
    }

    let cancelled = false;
    setStaticDetail(null);
    void item.getDetailView({ root: process.cwd() }).then((nextDetail) => {
      if (!cancelled) {
        setStaticDetail(nextDetail);
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
      if (screen.rejectComposer === undefined) {
        actions.navigation.dismissPane();
      } else {
        actions.navigation.rejectToEdit();
      }
      return;
    }

    if (isOpenFocusedContextItemKey(event)) {
      const state = useAppStore.getState();
      const focusedItem = getVisibleContextItemById(
        state.workspace.contextItems,
        state.workspace.focusedContextItemId,
        state.workspace.automaticContextItems,
      );
      if (focusedItem !== null) {
        event.preventDefault();
        event.stopPropagation();
        actions.contextItems.openContextItem({ itemId: focusedItem.id });
      }
      return;
    }

    if (canRunShortcutActions) {
      const shortcutAction = getContextItemActionForKeyEvent({
        actions: itemActions,
        event,
      });
      if (shortcutAction !== null) {
        event.preventDefault();
        event.stopPropagation();
        runContextItemAction({
          action: shortcutAction,
          closeAfterRemove: true,
        });
        return;
      }
    }

    if (!canRunPaneActions) {
      return;
    }

    const paneAction = getContextItemActionForPaneKeyEvent({
      actions: itemActions,
      event,
    });
    if (paneAction === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    runContextItemAction({ action: paneAction, closeAfterRemove: true });
  });

  return (
    <box
      title={title}
      bottomTitle={bottomTitle}
      bottomTitleAlignment="right"
      borderStyle="rounded"
      style={{
        border: true,
        borderColor: isAgentDetail ? "#374151" : undefined,
        flexDirection: "column",
        flexGrow: 1,
        gap: 1,
        height: "100%",
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
      ) : detail === null ? (
        <text>Loading...</text>
      ) : (
        <ContextItemDetailViewRenderer detail={detail} />
      )}
    </box>
  );
}

function ContextItemDetailViewRenderer({
  detail,
}: {
  detail: ContextItemDetailView;
}) {
  if (detail.kind === "agent-output") {
    return <AgentDetailView detail={detail} />;
  }

  if (detail.kind === "code") {
    return (
      <scrollbox style={{ flexGrow: 1, height: "100%", width: "100%" }}>
        <HighlightedCode content={detail.content} filePath={detail.filePath} />
      </scrollbox>
    );
  }

  if (detail.kind === "markdown") {
    return (
      <scrollbox style={{ flexGrow: 1, height: "100%", width: "100%" }}>
        <HighlightedMarkdown content={detail.content} />
      </scrollbox>
    );
  }

  if (detail.kind === "editable-text") {
    return <EditableTextDetailView detail={detail} />;
  }

  if (detail.kind === "diff") {
    return (
      <>
        <text>{detail.summary}</text>
        <scrollbox style={{ flexGrow: 1, height: "100%", width: "100%" }}>
          <HighlightedDiff diff={detail.diffText} />
        </scrollbox>
      </>
    );
  }

  return (
    <scrollbox style={{ flexGrow: 1, height: "100%", width: "100%" }}>
      <text>{detail.content}</text>
    </scrollbox>
  );
}

function EditableTextDetailView({
  detail,
}: {
  detail: Extract<ContextItemDetailView, { kind: "editable-text" }>;
}) {
  const actions = useAppStore((state) => state.actions);
  const textareaRef = useRef<TextareaRenderable | null>(null);
  const initializedItemId = useRef<string | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }

    if (textarea.plainText !== detail.content) {
      textarea.replaceText(detail.content);
    }

    if (initializedItemId.current !== detail.itemId) {
      textarea.cursorOffset = detail.content.length;
      initializedItemId.current = detail.itemId;
    }
  }, [detail.content, detail.itemId]);

  return (
    <box
      style={{
        backgroundColor: "#1f2937",
        flexGrow: 1,
        height: "100%",
        paddingX: 1,
        width: "100%",
      }}
    >
      <textarea
        ref={textareaRef}
        focused
        initialValue={detail.content}
        onContentChange={() => {
          const text = textareaRef.current?.plainText;
          if (text === undefined) {
            return;
          }

          actions.say.updateText({ itemId: detail.itemId, text });
        }}
        onKeyDown={(event: KeyEvent) => {
          if (event.name !== "escape") {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          actions.navigation.dismissPane();
        }}
        placeholder="Add context text"
        style={{ height: "100%", width: "100%", wrapMode: "word" }}
      />
    </box>
  );
}

function AgentDetailView({
  detail,
}: {
  detail: Extract<ContextItemDetailView, { kind: "agent-output" }>;
}) {
  return (
    <box
      style={{
        flexDirection: "column",
        flexGrow: 1,
        gap: 1,
        height: "100%",
        minHeight: 0,
      }}
    >
      <AgentMetadataPanel detail={detail} />
      <box style={{ flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
        <AgentOutputLog blocks={detail.blocks} />
      </box>
      {detail.sessionAvailability === "live" ? (
        <box style={{ flexShrink: 0 }}>
          <AgentSessionFollowUp itemId={detail.itemId} />
        </box>
      ) : null}
    </box>
  );
}

function AgentMetadataPanel({
  detail,
}: {
  detail: Extract<ContextItemDetailView, { kind: "agent-output" }>;
}) {
  const canActOnDiff =
    detail.sandbox?.diffStatus === "dirty" && detail.status !== "running";
  return (
    <box
      style={{
        backgroundColor: "#111827",
        flexDirection: "column",
        flexShrink: 0,
        gap: 0,
        paddingX: 1,
        paddingY: 1,
      }}
    >
      <text truncate wrapMode="none">
        {detail.prompt}
      </text>
      <text
        truncate
        wrapMode="none"
        style={{ fg: detail.status === "error" ? "red" : "#94a3b8" }}
      >
        {getAgentStatusText(detail)}
      </text>
      {detail.sandbox === undefined ? null : canActOnDiff ? (
        <text truncate wrapMode="none" style={{ fg: "#fbbf24" }}>
          {`diff ready · ${formatDirtyDiffSummary(detail.sandbox)} · Ctrl+y apply · Ctrl+d add to context`}
        </text>
      ) : detail.sandbox.diffStatus === "dirty" ? (
        <text truncate wrapMode="none" style={{ fg: "#fbbf24" }}>
          {`diff pending · ${formatDirtyDiffSummary(detail.sandbox)}`}
        </text>
      ) : (
        <text truncate wrapMode="none" style={{ fg: "#64748b" }}>
          {`sandbox ${formatSandboxDiffStatus(detail.sandbox)}`}
        </text>
      )}
    </box>
  );
}

function getAgentStatusText(
  detail: Extract<ContextItemDetailView, { kind: "agent-output" }>,
): string {
  if (detail.status === "running") {
    return "running";
  }

  if (detail.sessionAvailability === "detached") {
    return detail.status === "error"
      ? `detached: ${detail.errorMessage ?? "interrupted"}`
      : "detached";
  }

  if (detail.status === "error") {
    return `error: ${detail.errorMessage ?? "unknown error"}`;
  }

  return "idle";
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

function formatDirtyDiffSummary(
  sandbox: NonNullable<
    Extract<ContextItemDetailView, { kind: "agent-output" }>["sandbox"]
  >,
): string {
  if (sandbox.summary !== undefined && sandbox.summary.trim().length > 0) {
    return sandbox.summary.replace(/\s+/g, " ");
  }
  return "sandbox has changes";
}

function formatAgentShortcutHints(
  actions: readonly ContextItemAction[],
): string | undefined {
  const hints = actions
    .filter((action) => action.shortcut !== undefined)
    .map(formatContextItemAction);
  return hints.length === 0 ? undefined : hints.join(" · ");
}
