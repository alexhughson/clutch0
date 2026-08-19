import type { ShellCommandInputHandle } from "../../lib/shell/shellCommand";

const sessionInputs = new Map<number, ShellCommandInputHandle>();

export function registerShellCommandSessionInput({
  inputHandle,
  requestId,
}: {
  inputHandle: ShellCommandInputHandle;
  requestId: number;
}) {
  sessionInputs.set(requestId, inputHandle);
}

export function unregisterShellCommandSessionInput(requestId: number) {
  sessionInputs.delete(requestId);
}

export function sendShellCommandInput({
  input,
  requestId,
}: {
  input: string;
  requestId: number;
}) {
  const inputHandle = sessionInputs.get(requestId);
  if (inputHandle === undefined) {
    throw new Error(`Shell command ${requestId} is not running.`);
  }

  inputHandle.writeInput(input);
}

export function endShellCommandInput(requestId: number) {
  const inputHandle = sessionInputs.get(requestId);
  if (inputHandle === undefined) {
    throw new Error(`Shell command ${requestId} is not running.`);
  }

  inputHandle.endInput();
}
