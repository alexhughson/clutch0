import { useTerminalDimensions } from "@opentui/react";
import { getContextItemById } from "../lib/context/contextItems";
import type { ContextItem, ContextItemSummaryView } from "../types";

type ContextItemsListProps = {
  contextItems: ContextItem[];
  focusedContextItemId: string | null;
};

const WIDE_CONTEXT_LAYOUT_COLUMNS = 100;

export function ContextItemsList({
  contextItems,
  focusedContextItemId,
}: ContextItemsListProps) {
  const { width } = useTerminalDimensions();
  if (contextItems.length === 0) {
    return null;
  }

  const focusedItem = getContextItemById(contextItems, focusedContextItemId);
  const focusedActions = focusedItem?.getActions() ?? [];
  const useSidePane = width >= WIDE_CONTEXT_LAYOUT_COLUMNS;

  return (
    <box
      style={{ flexDirection: "column", gap: 1, paddingLeft: 1, width: "100%" }}
    >
      <text style={{ fg: "gray" }}>
        {focusedActions.length === 0
          ? "Context"
          : `Context  ${focusedActions.map(formatAction).join(" · ")}`}
      </text>
      <box
        style={{
          flexDirection: useSidePane ? "row" : "column",
          gap: 2,
          width: "100%",
        }}
      >
        <box
          style={{
            flexDirection: "column",
            width: useSidePane ? "58%" : "100%",
          }}
        >
          {contextItems.map((item) => {
            const isFocused = item.id === focusedContextItemId;
            const summary = item.getSummaryView();

            return (
              <ContextItemRow
                key={item.id}
                focused={isFocused}
                summary={summary}
              />
            );
          })}
        </box>
        {focusedItem === null ? null : (
          <FocusedContextItemSummary
            item={focusedItem}
            sidePane={useSidePane}
          />
        )}
      </box>
    </box>
  );
}

function ContextItemRow({
  focused,
  summary,
}: {
  focused: boolean;
  summary: ContextItemSummaryView;
}) {
  const shortSummary = getShortSummary(summary);

  return (
    <box style={{ flexDirection: "column" }}>
      <text
        truncate
        wrapMode="none"
        style={focused ? { bg: "blue", fg: "white" } : undefined}
      >
        {focused ? `> ${summary.label}` : `  ${summary.label}`}
      </text>
      {shortSummary === null ? null : (
        <text truncate wrapMode="none" style={{ fg: "gray" }}>
          {`    ${shortSummary}`}
        </text>
      )}
    </box>
  );
}

function FocusedContextItemSummary({
  item,
  sidePane,
}: {
  item: ContextItem;
  sidePane: boolean;
}) {
  const summary = item.getSummaryView();
  if (summary.detail === undefined) {
    return null;
  }

  return (
    <box
      style={{
        flexDirection: "column",
        marginTop: sidePane ? 0 : 1,
        width: sidePane ? "40%" : "100%",
      }}
    >
      <text style={{ fg: "gray" }}>Summary</text>
      <text>{summary.detail}</text>
    </box>
  );
}

function getShortSummary(summary: ContextItemSummaryView): string | null {
  if (summary.status === "ready" && summary.title !== summary.label) {
    return summary.title;
  }

  if (summary.status === "pending") {
    return "Summarizing…";
  }

  return null;
}

function formatAction(action: ReturnType<ContextItem["getActions"]>[number]) {
  return action.key === undefined
    ? action.label
    : `${action.key} ${action.label}`;
}
