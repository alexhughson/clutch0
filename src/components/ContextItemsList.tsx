import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import {
  isClutchConfigured,
  peekClutchConfigRecoveryNotice,
} from "../lib/config/clutchConfig";
import {
  getInlineListDisplayContent,
  getContextItemDisplayEntries,
  getContextItemShortSummary,
  getListShortSummary,
  getWrapWidthForDepth,
} from "../lib/context/contextItemDisplay";
import { getContextItemById } from "../lib/context/contextItems";
import type { ContextItem, ContextItemSummaryView } from "../types";

type ContextItemsListProps = {
  columns?: 1 | 2;
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  wrapWidth: number;
};

export function ContextItemsList({
  columns = 1,
  contextItems,
  focusedContextItemId,
  wrapWidth,
}: ContextItemsListProps) {
  const configNotice = getConfigSetupNotice();

  if (contextItems.length === 0) {
    return (
      <box style={{ flexDirection: "column", width: "100%" }}>
        {configNotice}
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
      {configNotice}
      <text style={{ fg: "gray" }}>Context</text>
      {columns === 1 ? (
        <ContextEntryScroll
          entries={entryColumns[0] ?? []}
          focusedContextItemId={focusedContextItemId}
          width="100%"
          wrapWidth={wrapWidth}
        />
      ) : (
        <box
          style={{ flexDirection: "row", flexGrow: 1, gap: 2, width: "100%" }}
        >
          {entryColumns.map((entries, index) => (
            <ContextEntryScroll
              key={index}
              entries={entries}
              focusedContextItemId={focusedContextItemId}
              width="50%"
              wrapWidth={wrapWidth}
            />
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

function ContextEntryScroll({
  entries,
  focusedContextItemId,
  width,
  wrapWidth,
}: {
  entries: ReturnType<typeof getContextItemDisplayEntries>;
  focusedContextItemId: string | null;
  width: `${number}%` | "100%";
  wrapWidth: number;
}) {
  const scrollBoxRef = useRef<ScrollBoxRenderable | null>(null);
  const focusedInColumn =
    focusedContextItemId !== null &&
    entries.some(
      (entry) =>
        entry.kind === "item" && entry.item.id === focusedContextItemId,
    );

  useEffect(() => {
    if (!focusedInColumn || focusedContextItemId === null) {
      return;
    }
    scrollBoxRef.current?.scrollChildIntoView(
      getContextItemRowId(focusedContextItemId),
    );
  }, [focusedContextItemId, focusedInColumn]);

  return (
    <scrollbox
      ref={scrollBoxRef}
      style={{ flexGrow: 1, height: "100%", width }}
    >
      <ContextEntryColumn
        entries={entries}
        focusedContextItemId={focusedContextItemId}
        wrapWidth={wrapWidth}
      />
    </scrollbox>
  );
}

function ContextEntryColumn({
  entries,
  focusedContextItemId,
  wrapWidth,
}: {
  entries: ReturnType<typeof getContextItemDisplayEntries>;
  focusedContextItemId: string | null;
  wrapWidth: number;
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
        const regenStatus = entry.item.getRegenStatus?.();
        const rowWrapWidth = getWrapWidthForDepth(wrapWidth, entry.depth);
        const inlineContent =
          getInlineListDisplayContent(entry.item, rowWrapWidth)?.content ??
          null;

        return (
          <ContextItemRow
            key={entry.item.id}
            depth={entry.depth}
            focused={isFocused}
            id={getContextItemRowId(entry.item.id)}
            inlineContent={inlineContent}
            label={
              inlineContent === null
                ? (entry.label ?? summary.label)
                : undefined
            }
            pinned={entry.item.isPinned()}
            regenerating={regenStatus?.status === "running"}
            regenError={
              regenStatus?.status === "error"
                ? regenStatus.errorMessage
                : undefined
            }
            summary={summary}
            wrapWidth={rowWrapWidth}
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

export function ContextItemRow({
  depth,
  focused,
  id,
  inlineContent,
  label,
  pinned = false,
  regenError,
  regenerating = false,
  summary,
  wrapWidth,
}: {
  depth: number;
  focused: boolean;
  id?: string;
  inlineContent?: string | null;
  label?: string;
  pinned?: boolean;
  regenError?: string;
  regenerating?: boolean;
  summary: ContextItemSummaryView;
  wrapWidth: number;
}) {
  const shortSummary =
    inlineContent === null || inlineContent === undefined
      ? (getListShortSummary(summary, wrapWidth)?.content ?? null)
      : null;
  const indent = getIndent(depth);
  const marker = focused ? "> " : pinned ? "* " : "  ";
  const labelStyle = focused
    ? { bg: "blue", fg: "white" }
    : pinned
      ? { bg: "gray", fg: "white" }
      : undefined;
  const statusLine = regenerating
    ? "Regenerating…"
    : regenError === undefined
      ? null
      : `Regen failed: ${regenError}`;

  return (
    <box id={id} style={{ flexDirection: "column" }}>
      {inlineContent === null || inlineContent === undefined ? (
        <text truncate wrapMode="none" style={labelStyle}>
          {`${indent}${marker}${label ?? ""}`}
        </text>
      ) : (
        <text wrapMode="word" style={labelStyle}>
          {`${indent}${marker}${inlineContent}`}
        </text>
      )}
      {statusLine === null ? null : (
        <box style={{ paddingLeft: indent.length + 4, width: "100%" }}>
          <text wrapMode="none" style={{ fg: "yellow" }}>
            {statusLine}
          </text>
        </box>
      )}
      {shortSummary === null ? null : (
        <box style={{ paddingLeft: indent.length + 4, width: "100%" }}>
          <text wrapMode="word" style={{ fg: "gray" }}>
            {shortSummary}
          </text>
        </box>
      )}
    </box>
  );
}

function FocusedContextItemSummaryContent({ item }: { item: ContextItem }) {
  const summary = item.getSummaryView();
  const detail =
    summary.detail ?? getContextItemShortSummary(summary) ?? summary.label;

  return (
    <scrollbox style={{ flexGrow: 1, height: "100%", width: "100%" }}>
      <text>{detail}</text>
    </scrollbox>
  );
}

function getIndent(depth: number): string {
  return "  ".repeat(depth);
}

function getContextItemRowId(itemId: string): string {
  return `context-item-row-${itemId}`;
}

function getConfigSetupNotice() {
  if (isClutchConfigured()) {
    return null;
  }

  return (
    <text style={{ fg: "yellow" }}>
      {peekClutchConfigRecoveryNotice() ?? "LLM not configured. Run /config."}
    </text>
  );
}
