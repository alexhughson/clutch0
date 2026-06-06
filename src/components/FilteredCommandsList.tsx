import type { LlmSlashCommand } from "../workflows/llmTools/types";

type FilteredCommandsListProps = {
  commandSelector: string;
  height?: number;
  highlightedCommandName: string | null;
  visibleCommands: readonly LlmSlashCommand[];
};

export function FilteredCommandsList({
  commandSelector,
  height,
  highlightedCommandName,
  visibleCommands,
}: FilteredCommandsListProps) {
  const renderedCommands = getRenderedCommands({
    height,
    highlightedCommandName,
    visibleCommands,
  });

  return (
    <box style={{ flexDirection: "column", height, width: "100%" }}>
      <text
        style={{ fg: "gray" }}
      >{`Commands matching /${commandSelector}`}</text>
      {renderedCommands.map((command) => {
        const isHighlighted = command.name === highlightedCommandName;

        return (
          <text
            key={command.name}
            truncate
            wrapMode="none"
            style={isHighlighted ? { bg: "blue", fg: "white" } : undefined}
          >
            {`${isHighlighted ? ">" : " "} /${command.name} - ${command.title}`}
          </text>
        );
      })}
      {visibleCommands.length === 0 ? <text>No matching commands.</text> : null}
    </box>
  );
}

function getRenderedCommands({
  height,
  highlightedCommandName,
  visibleCommands,
}: {
  height: number | undefined;
  highlightedCommandName: string | null;
  visibleCommands: readonly LlmSlashCommand[];
}): LlmSlashCommand[] {
  if (height === undefined) {
    return [...visibleCommands];
  }

  return getVisibleSuggestionWindow({
    highlightedIndex: highlightedCommandIndex({
      highlightedCommandName,
      visibleCommands,
    }),
    items: visibleCommands,
    maxRows: Math.max(1, height - 1),
  });
}

function highlightedCommandIndex({
  highlightedCommandName,
  visibleCommands,
}: {
  highlightedCommandName: string | null;
  visibleCommands: readonly LlmSlashCommand[];
}): number {
  if (highlightedCommandName === null) {
    return -1;
  }

  return visibleCommands.findIndex(
    (command) => command.name === highlightedCommandName,
  );
}

function getVisibleSuggestionWindow<T>({
  highlightedIndex,
  items,
  maxRows,
}: {
  highlightedIndex: number;
  items: readonly T[];
  maxRows: number;
}): T[] {
  if (items.length <= maxRows) {
    return [...items];
  }

  if (highlightedIndex === -1) {
    return [...items.slice(0, maxRows)];
  }

  const start = Math.min(
    Math.max(0, highlightedIndex - Math.floor(maxRows / 2)),
    items.length - maxRows,
  );
  return [...items.slice(start, start + maxRows)];
}
