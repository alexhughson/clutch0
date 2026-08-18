import { afterEach, expect, test } from "bun:test";
import { createInitialAppState } from "../../app/appInitialState";
import {
  createSavedDiffContextItem,
  createSavedLlmResponseContextItem,
  createShellCommandOutputContextItem,
  SavedDiffContextItem,
  SavedLlmResponseContextItem,
  ShellCommandOutputContextItem,
} from "../../lib/context/contextItems";
import type { SessionRecorder } from "../../lib/session/sessionRecorder";
import {
  hydrateAppStore,
  recordSessionRuntimeEvent,
  setSessionRecorder,
  setWorkspaceEditListener,
  useAppStore,
} from "../../store/appStore";
import {
  markContextItemRerunStarted,
  registerAutoRegenTrigger,
  resetAutoRegenSchedulerForTest,
  setRegenRunnerForTest,
  setRegenShellForTest,
  setRegenStreamForTest,
} from "./regenerateContextItem";

afterEach(() => {
  resetAutoRegenSchedulerForTest();
  setSessionRecorder(null);
  hydrateQuietStore();
});

test("sequences auto-regen items one at a time", async () => {
  const ask = savedAsk("saved:ask").withAutoRegenerate(true);
  const command = savedCommand("saved:cmd").withAutoRegenerate(true);
  hydrateWithItems([ask, command]);
  registerAutoRegenTrigger();

  const started: string[] = [];
  const finished: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolve) => {
    setRegenRunnerForTest(async (itemId) => {
      started.push(itemId);
      if (itemId === ask.id) {
        resolve();
        await new Promise<void>((release) => {
          releaseFirst = release;
        });
      }
      finished.push(itemId);
    });
  });

  recordSessionRuntimeEvent({ kind: "patch-apply.end", success: true });
  await firstStarted;

  expect(started).toEqual([ask.id]);
  expect(finished).toEqual([]);

  releaseFirst?.();
  await waitUntil(() => finished.length === 2);

  expect(started).toEqual([ask.id, command.id]);
  expect(finished).toEqual([ask.id, command.id]);
});

test("a new edit resets the queue instead of finishing the old wave", async () => {
  const ask = savedAsk("saved:ask").withAutoRegenerate(true);
  const command = savedCommand("saved:cmd").withAutoRegenerate(true);
  hydrateWithItems([ask, command]);
  registerAutoRegenTrigger();

  const started: string[] = [];
  const finished: string[] = [];
  let firstAskSignal: AbortSignal | undefined;
  const firstAskStarted = new Promise<void>((resolve) => {
    setRegenRunnerForTest(async (itemId, signal) => {
      started.push(itemId);
      if (started.length === 1) {
        firstAskSignal = signal;
        resolve();
        await waitForAbort(signal);
        return;
      }
      finished.push(itemId);
    });
  });

  recordSessionRuntimeEvent({ kind: "patch-apply.end", success: true });
  await firstAskStarted;
  expect(started).toEqual([ask.id]);

  recordSessionRuntimeEvent({ kind: "patch-apply.end", success: true });
  await waitUntil(() => firstAskSignal?.aborted === true);
  await waitUntil(() => finished.length === 2);

  expect(started).toEqual([ask.id, ask.id, command.id]);
  expect(finished).toEqual([ask.id, command.id]);
});

test("apply events from regen itself do not reset the queue", async () => {
  const ask = savedAsk("saved:ask").withAutoRegenerate(true);
  const command = savedCommand("saved:cmd").withAutoRegenerate(true);
  hydrateWithItems([ask, command]);
  registerAutoRegenTrigger();

  const started: string[] = [];
  setRegenRunnerForTest(async (itemId) => {
    started.push(itemId);
    recordSessionRuntimeEvent({ kind: "patch-apply.end", success: true });
  });

  recordSessionRuntimeEvent({ kind: "patch-apply.end", success: true });
  await waitUntil(() => started.length === 2);
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(started).toEqual([ask.id, command.id]);
});

test("manual rerun does not mark the saved item as regenerating", () => {
  const ask = savedAsk("saved:ask").withAutoRegenerate(true);
  hydrateWithItems([ask]);

  markContextItemRerunStarted(ask.id);

  expect(
    useAppStore.getState().workspace.contextItems[0]?.getRegenStatus?.(),
  ).toEqual({ status: "idle" });
});

test("manual rerun pulls that item out of the current wave", async () => {
  const ask = savedAsk("saved:ask").withAutoRegenerate(true);
  const command = savedCommand("saved:cmd").withAutoRegenerate(true);
  hydrateWithItems([ask, command]);
  registerAutoRegenTrigger();

  const started: string[] = [];
  const finished: string[] = [];
  const firstAskStarted = new Promise<void>((resolve) => {
    setRegenRunnerForTest(async (itemId, signal) => {
      started.push(itemId);
      if (itemId === ask.id) {
        resolve();
        await waitForAbort(signal);
        return;
      }
      finished.push(itemId);
    });
  });

  recordSessionRuntimeEvent({ kind: "patch-apply.end", success: true });
  await firstAskStarted;
  markContextItemRerunStarted(ask.id);
  await waitUntil(() => finished.includes(command.id));

  expect(started).toEqual([ask.id, command.id]);
  expect(finished).toEqual([command.id]);
  expect(
    useAppStore.getState().workspace.contextItems.find(
      (item) => item.id === ask.id,
    )?.getRegenStatus?.(),
  ).toEqual({ status: "idle" });
});

test("the applied item is left out of the wave that it triggered", async () => {
  const applied = savedDiff("saved:applied").withAutoRegenerate(true);
  const ask = savedAsk("saved:ask").withAutoRegenerate(true);
  hydrateWithItems([applied, ask]);
  registerAutoRegenTrigger();

  const started: string[] = [];
  setRegenRunnerForTest(async (itemId) => {
    started.push(itemId);
  });

  recordSessionRuntimeEvent({
    contextItemId: applied.id,
    kind: "patch-apply.end",
    success: true,
  });
  await waitUntil(() => started.length === 1);

  expect(started).toEqual([ask.id]);
});

test("listener errors do not throw back to the apply caller", () => {
  const events: Record<string, unknown>[] = [];
  const recorder: SessionRecorder = {
    close: async () => {},
    flush: async () => {},
    recordRuntimeEvent: (event) => {
      events.push(event);
    },
    recordStateChange: () => {},
  };
  setSessionRecorder(recorder);
  setWorkspaceEditListener(() => {
    throw new Error("listener failed");
  });

  expect(() =>
    recordSessionRuntimeEvent({ kind: "patch-apply.end", success: true }),
  ).not.toThrow();
  expect(events).toEqual([
    { kind: "patch-apply.end", success: true },
    {
      errorMessage: "listener failed",
      kind: "auto-regen.listener-failed",
    },
  ]);
});

test("failed applies and shell finishes do not start regen", async () => {
  const ask = savedAsk("saved:ask").withAutoRegenerate(true);
  hydrateWithItems([ask]);
  registerAutoRegenTrigger();

  const started: string[] = [];
  setRegenRunnerForTest(async (itemId) => {
    started.push(itemId);
  });

  recordSessionRuntimeEvent({ kind: "patch-apply.end", success: false });
  recordSessionRuntimeEvent({ kind: "shell-command.finished" });
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(started).toEqual([]);
});

test("headless text regen updates the same id and leaves the composer free", async () => {
  const ask = savedAsk("saved:ask").withPinned(true).withAutoRegenerate(true);
  hydrateWithItems([ask]);
  registerAutoRegenTrigger();
  const resetStream = setRegenStreamForTest(async () => ({
    kind: "text",
    responseText: "updated answer",
  }));

  try {
    recordSessionRuntimeEvent({ kind: "patch-apply.end", success: true });
    await waitUntil(() => {
      const item = useAppStore.getState().workspace.contextItems[0];
      return (
        item instanceof SavedLlmResponseContextItem &&
        item.output === "updated answer"
      );
    });
  } finally {
    resetStream();
  }

  const item = useAppStore.getState().workspace.contextItems[0];
  expect(item).toBeInstanceOf(SavedLlmResponseContextItem);
  expect((item as SavedLlmResponseContextItem).output).toBe("updated answer");
  expect(item?.id).toBe(ask.id);
  expect(item?.isPinned()).toBe(true);
  expect(item?.getAutoRegenerate?.()).toBe(true);
  expect(item?.getRegenStatus?.()).toEqual({ status: "idle" });
  expect(useAppStore.getState().activeTask).toBeNull();
});

test("headless text regen keeps the old body when the model returns a tool", async () => {
  const ask = savedAsk("saved:ask").withAutoRegenerate(true);
  hydrateWithItems([ask]);
  registerAutoRegenTrigger();
  const resetStream = setRegenStreamForTest(async () => ({
    kind: "add-files",
    paths: ["src/a.ts"],
    responseText: "",
  }));

  try {
    recordSessionRuntimeEvent({ kind: "patch-apply.end", success: true });
    await waitUntil(() => {
      const item = useAppStore.getState().workspace.contextItems[0];
      return item?.getRegenStatus?.()?.status === "error";
    });
  } finally {
    resetStream();
  }

  const item = useAppStore.getState().workspace.contextItems[0];
  expect(item).toBeInstanceOf(SavedLlmResponseContextItem);
  expect((item as SavedLlmResponseContextItem).output).toBe("old answer");
  expect(item?.getRegenStatus?.()).toEqual({
    errorMessage: "Auto-regen expected text and got a tool result.",
    status: "error",
  });
});

test("headless shell regen updates command output in place", async () => {
  const command = savedCommand("saved:cmd").withAutoRegenerate(true);
  hydrateWithItems([command]);
  registerAutoRegenTrigger();
  const resetShell = setRegenShellForTest(async ({ command: nextCommand }) => ({
    command: nextCommand,
    durationMs: 2,
    exitCode: 0,
    stderr: "",
    stdout: "ok",
    timedOut: false,
    truncated: false,
  }));

  try {
    recordSessionRuntimeEvent({ kind: "create-file.apply.end", success: true });
    await waitUntil(() => {
      const item = useAppStore.getState().workspace.contextItems[0];
      return (
        item instanceof ShellCommandOutputContextItem &&
        item.result.stdout === "ok"
      );
    });
  } finally {
    resetShell();
  }

  expect(useAppStore.getState().activeTask).toBeNull();
});

test("headless diff regen replaces the proposal and does not apply it", async () => {
  const diff = savedDiff("saved:diff").withAutoRegenerate(true);
  hydrateWithItems([diff]);
  registerAutoRegenTrigger();
  const resetStream = setRegenStreamForTest(async () => ({
    kind: "patch" as const,
    patch: {
      diffText: "diff --git a/a b/a\n+new",
      proposal: {
        patch: "*** Begin Patch\n*** End Patch",
        summary: "next edit",
      },
      status: "valid" as const,
    },
    responseText: "",
  }));

  try {
    recordSessionRuntimeEvent({
      kind: "agent-session.sandbox-diff-applied",
      itemId: "agent:1",
    });
    await waitUntil(() => {
      const item = useAppStore.getState().workspace.contextItems[0];
      return item instanceof SavedDiffContextItem && item.summary === "next edit";
    });
  } finally {
    resetStream();
  }

  const item = useAppStore.getState().workspace.contextItems[0];
  expect(item).toBeInstanceOf(SavedDiffContextItem);
  const saved = item as SavedDiffContextItem;
  expect(saved.diffText).toBe("diff --git a/a b/a\n+new");
  expect(saved.getAutoRegenerate()).toBe(true);
  expect(useAppStore.getState().activeTask).toBeNull();
});

function savedAsk(id: string) {
  return createSavedLlmResponseContextItem({
    createdAt: 1,
    id,
    output: "old answer",
    prompt: "what next",
    sourceRequestId: 1,
  });
}

function savedCommand(id: string) {
  return createShellCommandOutputContextItem({
    createdAt: 1,
    id,
    result: {
      command: "printf hi",
      durationMs: 1,
      exitCode: 0,
      stderr: "",
      stdout: "hi",
      timedOut: false,
      truncated: false,
    },
    sourceRequestId: 1,
  });
}

function savedDiff(id: string) {
  return createSavedDiffContextItem({
    createdAt: 1,
    diffText: "diff --git a/a b/a",
    id,
    prompt: "edit a",
    proposal: {
      patch: "*** Begin Patch\n*** End Patch",
      summary: "old",
    },
    sourceRequestId: 1,
    summary: "old",
  });
}

function hydrateWithItems(
  contextItems: Array<
    | ReturnType<typeof savedAsk>
    | ReturnType<typeof savedCommand>
    | ReturnType<typeof savedDiff>
  >,
) {
  const state = createInitialAppState();
  hydrateAppStore({
    ...state,
    workspace: {
      ...state.workspace,
      automaticContextItems: [],
      contextItems,
      focusedContextItemId: contextItems[0]?.id ?? null,
    },
  });
}

function hydrateQuietStore() {
  const state = createInitialAppState();
  hydrateAppStore({
    ...state,
    workspace: {
      ...state.workspace,
      automaticContextItems: [],
    },
  });
}

async function waitUntil(predicate: () => boolean) {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for condition.");
}

function waitForAbort(signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
