import { expect, test } from "bun:test";
import { createSessionShutdownController } from "./sessionShutdown";

test("shutdown always restores terminal resources even when cleanup hangs", async () => {
  const events: string[] = [];
  const controller = createSessionShutdownController({
    resources: {
      abortRuntimeWork: () => events.push("abort"),
      closeRecorder: async ({ status }) => {
        await new Promise(() => {});
        events.push(`recorder:${status}`);
      },
      destroyRenderer: () => events.push("destroy"),
      disposeAgentSessions: async () => {
        events.push("agents");
      },
      reportCleanupFailure: (error) => events.push(`report:${error.message}`),
      unmountRoot: () => events.push("unmount"),
    },
    timeoutMs: 1,
  });

  await expect(controller.shutdown("interrupted")).rejects.toThrow(
    "cleanup timed out",
  );
  await expect(controller.shutdown("interrupted")).rejects.toThrow(
    "cleanup timed out",
  );

  expect(events).toEqual([
    "abort",
    "agents",
    "report:Session shutdown cleanup timed out after 1ms.",
    "unmount",
    "destroy",
  ]);
});

test("shutdown reports cleanup failures after restoring terminal resources", async () => {
  const events: string[] = [];
  const controller = createSessionShutdownController({
    resources: {
      abortRuntimeWork: () => events.push("abort"),
      closeRecorder: async () => {
        events.push("recorder");
        throw new Error("recorder close failed");
      },
      destroyRenderer: () => events.push("destroy"),
      disposeAgentSessions: async () => {
        events.push("agents");
      },
      reportCleanupFailure: (error) => events.push(`report:${error.message}`),
      unmountRoot: () => events.push("unmount"),
    },
  });

  await expect(controller.shutdown("interrupted")).rejects.toThrow(
    "recorder close failed",
  );
  expect(events).toEqual([
    "abort",
    "agents",
    "recorder",
    "report:Session shutdown cleanup failed: recorder close failed",
    "unmount",
    "destroy",
  ]);
});
