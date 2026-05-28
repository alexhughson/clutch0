import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { ShellCommandTaskState } from "../../app/appTypes";
import type { ShellCommandResult } from "../../lib/shell/shellCommand";
import { useAppStore } from "../../store/appStore";

type ShellCommandScreenProps = {
  task: ShellCommandTaskState;
};

type AppActions = ReturnType<typeof useAppStore.getState>["actions"];

export function ShellCommandScreen({ task }: ShellCommandScreenProps) {
  const actions = useAppStore((state) => state.actions);

  useKeyboard((event) => {
    handleShellCommandKey({ actions, event, task });
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
        title="Command request"
        borderStyle="rounded"
        style={{ border: true, flexDirection: "column", padding: 1 }}
      >
        <text>{task.prompt}</text>
      </box>
      <box
        title={`Shell command (${formatStatus(task.status)})`}
        bottomTitle={getShellCommandHotkeys(task)}
        bottomTitleAlignment="right"
        borderStyle="rounded"
        style={{ border: true, flexDirection: "column", padding: 1 }}
      >
        {task.status === "running" ? (
          <text>Asking the model to choose and run a shell command...</text>
        ) : null}
        {task.status === "error" ? (
          <text style={{ fg: "red" }}>{task.errorMessage}</text>
        ) : null}
        {task.result === undefined ? null : (
          <ShellCommandResultView result={task.result} />
        )}
        {task.savedContextItemId === undefined ? null : (
          <text style={{ fg: "green" }}>Saved to context.</text>
        )}
      </box>
    </box>
  );
}

function ShellCommandResultView({ result }: { result: ShellCommandResult }) {
  return (
    <box style={{ flexDirection: "column", gap: 1 }}>
      <text>{`$ ${result.command}`}</text>
      <text>{`exit code: ${result.exitCode ?? "signal"} · duration: ${result.durationMs}ms${result.signal === undefined ? "" : ` · signal: ${result.signal}`}${result.timedOut ? " · timed out" : ""}${result.truncated ? " · truncated" : ""}`}</text>
      <scrollbox style={{ height: 30, width: "100%" }}>
        <box style={{ flexDirection: "column" }}>
          <text style={{ fg: "gray" }}>stdout:</text>
          <text>{result.stdout.length > 0 ? result.stdout : "<empty>"}</text>
          <text style={{ fg: "gray" }}>stderr:</text>
          <text>{result.stderr.length > 0 ? result.stderr : "<empty>"}</text>
        </box>
      </scrollbox>
    </box>
  );
}

function handleShellCommandKey({
  actions,
  event,
  task,
}: {
  actions: AppActions;
  event: KeyEvent;
  task: ShellCommandTaskState;
}) {
  if (task.status === "running") {
    return;
  }

  if (
    task.status === "done" &&
    task.savedContextItemId === undefined &&
    event.name === "s"
  ) {
    event.preventDefault();
    event.stopPropagation();
    actions.shellCommand.saveOutputToContext({ requestId: task.id });
    return;
  }

  if (event.name === "escape") {
    event.preventDefault();
    event.stopPropagation();
    actions.navigation.showComposer();
    return;
  }

  if (isEnterKey(event.name)) {
    event.preventDefault();
    event.stopPropagation();
    actions.navigation.clearResponseAndMessage();
  }
}

function getShellCommandHotkeys(
  task: ShellCommandTaskState,
): string | undefined {
  if (task.status === "running") {
    return undefined;
  }

  if (task.status === "error") {
    return "Enter clear · Esc return";
  }

  return task.savedContextItemId === undefined
    ? "s save output to context · Enter clear · Esc return"
    : "Enter clear · Esc return";
}

function formatStatus(status: ShellCommandTaskState["status"]): string {
  if (status === "done") {
    return "complete";
  }

  return status;
}

function isEnterKey(keyName: string): boolean {
  return (
    keyName === "return" || keyName === "kpenter" || keyName === "linefeed"
  );
}
