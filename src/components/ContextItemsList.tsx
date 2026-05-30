import { useTerminalDimensions } from "@opentui/react";
import { getContextItemDisplayEntries } from "../lib/context/contextItemDisplay";
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
  const useSidePane = width >= WIDE_CONTEXT_LAYOUT_COLUMNS;
  const displayEntries = getContextItemDisplayEntries(contextItems);

  return (
    <box
      style={{ flexDirection: "column", gap: 1, paddingLeft: 1, width: "100%" }}
    >
      <text style={{ fg: "gray" }}>Context</text>
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
          {displayEntries.map((entry) => {
            if (entry.kind === "folder") {
              return (
                <ContextFolderHeader
                  key={entry.key}
                  depth={entry.depth}
                  label={entry.label}
                />
              );
            }

            const isFocused = entry.item.id === focusedContextItemId;
            const summary = entry.item.getSummaryView();

            return (
              <ContextItemRow
                key={entry.item.id}
                depth={entry.depth}
                focused={isFocused}
                label={entry.label ?? summary.label}
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

function ContextFolderHeader({
  depth,
  label,
}: {
  depth: number;
  label: string;
}) {
  return (
    <text truncate wrapMode="none" style={{ fg: "gray" }}>
      {`${getIndent(depth)}${label}`}
    </text>
  );
}

function ContextItemRow({
  depth,
  focused,
  label,
  summary,
}: {
  depth: number;
  focused: boolean;
  label: string;
  summary: ContextItemSummaryView;
}) {
  const shortSummary = getShortSummary(summary);
  const indent = getIndent(depth);
  const marker = focused ? "> " : "  ";

  return (
    <box style={{ flexDirection: "column" }}>
      <text
        truncate
        wrapMode="none"
        style={focused ? { bg: "blue", fg: "white" } : undefined}
      >
        {`${indent}${marker}${label}`}
      </text>
      {shortSummary === null ? null : (
        <text truncate wrapMode="none" style={{ fg: "gray" }}>
          {`${indent}    ${shortSummary}`}
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

function getIndent(depth: number): string {
  return "  ".repeat(depth);
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
