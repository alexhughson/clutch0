import { getContextItemDisplayEntries } from "../lib/context/contextItemDisplay";
import { getContextItemById } from "../lib/context/contextItems";
import type { ContextItem, ContextItemSummaryView } from "../types";

type ContextItemsListProps = {
  columns?: 1 | 2;
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
};

export function ContextItemsList({
  columns = 1,
  contextItems,
  focusedContextItemId,
}: ContextItemsListProps) {
  if (contextItems.length === 0) {
    return (
      <box style={{ flexDirection: "column", width: "100%" }}>
        <text style={{ fg: "gray" }}>Context</text>
        <text style={{ fg: "gray" }}>No context items.</text>
      </box>
    );
  }

  const displayEntries = getContextItemDisplayEntries(contextItems);
  const splitIndex = Math.ceil(displayEntries.length / 2);
  const entryColumns =
    columns === 1
      ? [displayEntries]
      : [displayEntries.slice(0, splitIndex), displayEntries.slice(splitIndex)];

  return (
    <box
      style={{
        flexDirection: "column",
        flexGrow: 1,
        flexShrink: 1,
        minHeight: 1,
        width: "100%",
      }}
    >
      <text style={{ fg: "gray" }}>Context</text>
      {columns === 1 ? (
        <scrollbox style={{ flexGrow: 1, height: "100%", width: "100%" }}>
          <ContextEntryColumn
            entries={entryColumns[0] ?? []}
            focusedContextItemId={focusedContextItemId}
          />
        </scrollbox>
      ) : (
        <box
          style={{ flexDirection: "row", flexGrow: 1, gap: 2, width: "100%" }}
        >
          {entryColumns.map((entries, index) => (
            <scrollbox
              key={index}
              style={{ flexGrow: 1, height: "100%", width: "50%" }}
            >
              <ContextEntryColumn
                entries={entries}
                focusedContextItemId={focusedContextItemId}
              />
            </scrollbox>
          ))}
        </box>
      )}
    </box>
  );
}

export function FocusedContextItemSummary({
  contextItems,
  focusedContextItemId,
}: {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
}) {
  const focusedItem = getContextItemById(contextItems, focusedContextItemId);

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, width: "100%" }}>
      <text style={{ fg: "gray" }}>Summary</text>
      {focusedItem === null ? (
        <text style={{ fg: "gray" }}>No focused context item.</text>
      ) : (
        <FocusedContextItemSummaryContent item={focusedItem} />
      )}
    </box>
  );
}

function ContextEntryColumn({
  entries,
  focusedContextItemId,
}: {
  entries: ReturnType<typeof getContextItemDisplayEntries>;
  focusedContextItemId: string | null;
}) {
  return (
    <box style={{ flexDirection: "column", width: "100%" }}>
      {entries.map((entry) => {
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

function FocusedContextItemSummaryContent({ item }: { item: ContextItem }) {
  const summary = item.getSummaryView();
  const detail = summary.detail ?? getShortSummary(summary) ?? summary.label;

  return (
    <scrollbox style={{ flexGrow: 1, height: "100%", width: "100%" }}>
      <text>{detail}</text>
    </scrollbox>
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
