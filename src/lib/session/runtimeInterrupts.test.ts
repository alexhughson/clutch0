import { expect, test } from "bun:test";
import { abortRuntimeWork, createRuntimeAbortHandle } from "./runtimeInterrupts";

test("runtime abort handles are aborted together and removed after abort", () => {
  const first = createRuntimeAbortHandle();
  const second = createRuntimeAbortHandle();

  abortRuntimeWork();

  expect(first.signal.aborted).toBe(true);
  expect(second.signal.aborted).toBe(true);

  const third = createRuntimeAbortHandle();
  expect(third.signal.aborted).toBe(false);
  third.dispose();
});

test("disposed runtime abort handles are not aborted later", () => {
  const handle = createRuntimeAbortHandle();
  handle.dispose();

  abortRuntimeWork();

  expect(handle.signal.aborted).toBe(false);
});
