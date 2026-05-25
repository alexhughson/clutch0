import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import type { ContextItemViewerTaskState } from "../../app/appTypes";
import { useAppStore } from "../../store/appStore";
import type { ContextItemAction, ContextItemDetailView } from "../../types";
import { startLlmRequest } from "../llmRequest/startLlmRequest";
import { applySavedDiffContextItem } from "./contextItemEffects";

export function ContextItemViewerScreen({
  screen,
}: {
  screen: ContextItemViewerTaskState;
}) {
  const actions = useAppStore((state) => state.actions);
  const [detail, setDetail] = useState<ContextItemDetailView | null>(null);
  const canAct = screen.applyStatus !== "applying";
  const itemActions = useMemo(
    () => screen.item.getActions().filter((action) => action.id !== "open"),
    [screen.item],
  );

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    void screen.item
      .getDetailView({ root: process.cwd() })
      .then((nextDetail) => {
        if (!cancelled) {
          setDetail(nextDetail);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [screen.item]);

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
      title={detail?.title ?? screen.item.getListLabel()}
      bottomTitle={canAct ? getBottomTitle(itemActions) : undefined}
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
      {detail === null ? (
        <text>Loading...</text>
      ) : (
        <DetailView detail={detail} />
      )}
    </box>
  );
}

function DetailView({ detail }: { detail: ContextItemDetailView }) {
  if (detail.kind === "diff") {
    return (
      <>
        <text>{detail.summary}</text>
        <scrollbox style={{ height: 38, width: "100%" }}>
          <diff
            diff={detail.diffText}
            view="unified"
            showLineNumbers
            wrapMode="none"
            addedBg="#12351f"
            removedBg="#3a1717"
            addedSignColor="#4ade80"
            removedSignColor="#f87171"
            lineNumberFg="#666666"
            style={{ width: "100%" }}
          />
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
    applySavedDiff: (itemId) => {
      void applySavedDiffContextItem(itemId);
    },
    openContextItem: (itemId) => {
      useAppStore.getState().actions.contextItems.openContextItem({ itemId });
    },
    removeContextItem: (itemId) => {
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
  });
}
