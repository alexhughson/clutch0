import { getContextItemById } from "../lib/context/contextItems";
import type { ContextItem } from "../types";

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
      borderStyle="rounded"
      style={{ border: true, flexDirection: "column", padding: 1 }}
    >
      {contextItems.map((item) => {
        const isFocused = item.id === focusedContextItemId;

        return (
          <text
            key={item.id}
            style={isFocused ? { bg: "blue", fg: "white" } : undefined}
          >
            {isFocused
              ? `> ${item.getListLabel()}`
              : `  ${item.getListLabel()}`}
          </text>
        );
      })}
      {focusedActions.length === 0 ? null : (
        <text style={{ fg: "gray" }}>
          {`Actions: ${focusedActions.map(formatAction).join(" · ")}`}
        </text>
      )}
    </box>
  );
}

function formatAction(action: ReturnType<ContextItem["getActions"]>[number]) {
  return action.key === undefined
    ? action.label
    : `${action.key} ${action.label}`;
}
