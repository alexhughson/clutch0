import { runShellCommand } from "../../lib/shell/shellCommand";
import { createRuntimeAbortHandle } from "../../lib/session/runtimeInterrupts";
import { recordSessionRuntimeEvent, useAppStore } from "../../store/appStore";

export function runApprovedShellCommand({
  command,
  requestId,
  root,
}: {
  command: string;
  requestId: number;
  root?: string;
}) {
  const abortHandle = createRuntimeAbortHandle();
  recordSessionRuntimeEvent({
    command,
    kind: "shell-command.started",
    requestId,
  });

  void runShellCommand({
    command,
    root,
    signal: abortHandle.signal,
    onOutput: ({ chunk, stream }) => {
      useAppStore.getState().actions.shellCommand.appendOutput({
        chunk,
        requestId,
        stream,
      });
    },
  }).then(
    (result) => {
      abortHandle.dispose();
      recordSessionRuntimeEvent({
        command: result.command,
        exitCode: result.exitCode,
        kind: "shell-command.finished",
        requestId,
        signal: result.signal,
        timedOut: result.timedOut,
      });
      useAppStore.getState().actions.shellCommand.finish({
        requestId,
        result,
      });
    },
    (error: unknown) => {
      abortHandle.dispose();
      recordSessionRuntimeEvent({
        errorMessage: error instanceof Error ? error.message : String(error),
        kind: "shell-command.failed",
        requestId,
      });
      useAppStore.getState().actions.shellCommand.fail({
        errorMessage: error instanceof Error ? error.message : String(error),
        requestId,
      });
    },
  );
}
