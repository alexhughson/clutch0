import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { ShowContextTaskState } from "../../app/appTypes";
import { isEnterKey } from "../../lib/keymap";
import { useAppStore } from "../../store/appStore";

type ShowContextScreenProps = {
  task: ShowContextTaskState;
};

type AppActions = ReturnType<typeof useAppStore.getState>["actions"];

export function ShowContextScreen({ task }: ShowContextScreenProps) {
  const actions = useAppStore((state) => state.actions);

  useKeyboard((event) => {
    handleShowContextKey({ actions, event, task });
  });

  return (
    <box
      title={`Rendered LLM context (${task.status})`}
      bottomTitle={
        task.status === "loading" ? undefined : "Enter clear · Esc edit prompt"
      }
      bottomTitleAlignment="right"
      borderStyle="rounded"
      style={{
        border: true,
        flexDirection: "column",
        flexGrow: 1,
        gap: 1,
        height: "100%",
        padding: 1,
        width: "100%",
      }}
    >
      <text style={{ fg: "gray" }}>Request</text>
      <text>
        {task.question.length === 0 ? "(no question)" : task.question}
      </text>
      <box style={{ flexDirection: "column", flexGrow: 1 }}>
        {task.status === "loading" ? <text>Building context...</text> : null}
        {task.status === "error" ? (
          <text style={{ fg: "red" }}>{task.errorMessage}</text>
        ) : null}
        {task.status === "done" ? (
          <scrollbox style={{ flexGrow: 1, height: "100%", width: "100%" }}>
            <text>{task.content ?? ""}</text>
          </scrollbox>
        ) : null}
      </box>
    </box>
  );
}

function handleShowContextKey({
  actions,
  event,
  task,
}: {
  actions: AppActions;
  event: KeyEvent;
  task: ShowContextTaskState;
}) {
  if (task.status === "loading") {
    return;
  }

  if (event.name === "escape") {
    event.preventDefault();
    event.stopPropagation();
    actions.navigation.rejectToEdit();
    return;
  }

  if (isEnterKey(event.name)) {
    event.preventDefault();
    event.stopPropagation();
    actions.navigation.acceptAndClose();
  }
}
