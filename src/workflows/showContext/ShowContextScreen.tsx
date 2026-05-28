import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { ShowContextTaskState } from "../../app/appTypes";
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
      borderStyle="rounded"
      style={{
        border: true,
        flexDirection: "column",
        gap: 1,
        padding: 1,
        width: "100%",
      }}
    >
      <box
        title="Context preview request"
        borderStyle="rounded"
        style={{ border: true, flexDirection: "column", padding: 1 }}
      >
        <text>
          {task.question.length === 0 ? "(no question)" : task.question}
        </text>
      </box>
      <box
        title={`Rendered LLM context (${task.status})`}
        bottomTitle={task.status === "loading" ? undefined : "Esc return"}
        bottomTitleAlignment="right"
        borderStyle="rounded"
        style={{ border: true, flexDirection: "column", padding: 1 }}
      >
        {task.status === "loading" ? <text>Building context...</text> : null}
        {task.status === "error" ? (
          <text style={{ fg: "red" }}>{task.errorMessage}</text>
        ) : null}
        {task.status === "done" ? (
          <scrollbox style={{ height: 36, width: "100%" }}>
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
    actions.navigation.showComposer();
  }
}
