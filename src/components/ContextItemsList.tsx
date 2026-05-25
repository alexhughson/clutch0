import { useEffect, useState } from "react";
import { getContextItemById } from "../lib/context/contextItems";
import type { ContextItem, ContextItemDetailView } from "../types";

type ContextItemsListProps = {
  contextItems: ContextItem[];
  focusedContextItemId: string | null;
};

export function ContextItemsList({
  contextItems,
  focusedContextItemId,
}: ContextItemsListProps) {
  if (contextItems.length === 0) {
    return null;
  }

  const focusedItem = getContextItemById(contextItems, focusedContextItemId);
  const focusedActions = focusedItem?.getActions() ?? [];

  return (
    <box
      title="Context"
      bottomTitle={
        focusedActions.length === 0
          ? undefined
          : focusedActions.map(formatAction).join(" · ")
      }
      bottomTitleAlignment="right"
      borderStyle="rounded"
      style={{ border: true, flexDirection: "column", padding: 1 }}
    >
      {contextItems.map((item) => {
        const isFocused = item.id === focusedContextItemId;
        const summary = item.getSummaryView();

        return (
          <box key={item.id} style={{ flexDirection: "column" }}>
            <text style={isFocused ? { bg: "blue", fg: "white" } : undefined}>
              {isFocused ? `> ${summary.title}` : `  ${summary.title}`}
            </text>
            {summary.detail === undefined ? null : (
              <text style={{ fg: "gray" }}>{`    ${summary.detail}`}</text>
            )}
          </box>
        );
      })}
      {focusedItem === null ? null : <ContextItemDetail item={focusedItem} />}
    </box>
  );
}

function ContextItemDetail({ item }: { item: ContextItem }) {
  const [detail, setDetail] = useState<ContextItemDetailView | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    void item.getDetailView({ root: process.cwd() }).then((nextDetail) => {
      if (!cancelled) {
        setDetail(nextDetail);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [item]);

  if (detail === null) {
    return null;
  }

  return (
    <box
      title={detail.title}
      borderStyle="rounded"
      style={{
        border: true,
        flexDirection: "column",
        marginTop: 1,
        padding: 1,
      }}
    >
      {detail.kind === "diff" ? (
        <scrollbox style={{ height: 12, width: "100%" }}>
          <text>{detail.summary}</text>
          <diff
            diff={detail.diffText}
            view="unified"
            showLineNumbers
            wrapMode="none"
            style={{ width: "100%" }}
          />
        </scrollbox>
      ) : (
        <scrollbox style={{ height: 12, width: "100%" }}>
          <text>{detail.content}</text>
        </scrollbox>
      )}
    </box>
  );
}

function formatAction(action: ReturnType<ContextItem["getActions"]>[number]) {
  return action.key === undefined
    ? action.label
    : `${action.key} ${action.label}`;
}
