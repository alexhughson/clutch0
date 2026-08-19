import { runShellCommand } from "../../lib/shell/shellCommand";
import { createRuntimeAbortHandle } from "../../lib/session/runtimeInterrupts";
import { recordSessionRuntimeEvent, useAppStore } from "../../store/appStore";
import {
  registerShellCommandSessionInput,
  unregisterShellCommandSessionInput,
} from "./shellCommandSessionRegistry";

export function runApprovedShellCommand({
  command,
  outputContextItemId,
  replacementContextItemId,
  requestId,
  root,
}: {
  command: string;
  outputContextItemId: string;
  replacementContextItemId?: string;
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
    onSpawn: (inputHandle) => {
      registerShellCommandSessionInput({
        inputHandle,
        requestId,
      });
    },
    root,
    signal: abortHandle.signal,
    stdinMode: "pipe",
    onOutput: ({ chunk, stream }) => {
      useAppStore.getState().actions.shellCommand.appendOutput({
        chunk,
        outputContextItemId,
        requestId,
        stream,
      });
    },
  }).then(
    (result) => {
      abortHandle.dispose();
      unregisterShellCommandSessionInput(requestId);
      recordSessionRuntimeEvent({
        command: result.command,
        exitCode: result.exitCode,
        kind: "shell-command.finished",
        requestId,
        signal: result.signal,
        timedOut: result.timedOut,
      });
      useAppStore.getState().actions.shellCommand.finish({
        outputContextItemId,
        requestId,
        replacementContextItemId,
        result,
      });
    },
    (error: unknown) => {
      abortHandle.dispose();
      unregisterShellCommandSessionInput(requestId);
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
