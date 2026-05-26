import type { LlmSlashCommand } from "../workflows/llmTools/types";

type FilteredCommandsListProps = {
  commandSelector: string;
  highlightedCommandName: string | null;
  visibleCommands: readonly LlmSlashCommand[];
};

export function FilteredCommandsList({
  commandSelector,
  highlightedCommandName,
  visibleCommands,
}: FilteredCommandsListProps) {
  return (
    <box
      title={`Commands matching /${commandSelector}`}
      borderStyle="rounded"
      style={{ border: true, flexDirection: "column", padding: 1 }}
    >
      {visibleCommands.map((command) => {
        const isHighlighted = command.name === highlightedCommandName;

        return (
          <text
            key={command.name}
            style={isHighlighted ? { bg: "blue", fg: "white" } : undefined}
          >
            {`${isHighlighted ? ">" : " "} /${command.name} — ${command.title}: ${command.description}`}
          </text>
        );
      })}
      {visibleCommands.length === 0 ? <text>No matching commands.</text> : null}
    </box>
  );
}
