import { afterEach, beforeEach, expect, test } from "bun:test";
import { createInitialAppState } from "../app/appInitialState";
import type { SessionRecorder } from "../lib/session/sessionRecorder";
import { createUserTextContextItem } from "../lib/context/contextItemFactories";
import {
  hydrateAppStore,
  setSessionRecorder,
  useAppStore,
} from "../store/appStore";
import { startAgentAskSession } from "./agentAsk/agentAskSessionRegistry";
import { startFindFilesSearch } from "./findFiles/findFilesSearchController";
import {
  setStartLlmRequestStreamForTest,
  startLlmRequest,
} from "./llmRequest/startLlmRequest";
import { startShellCommandRerun } from "./shellCommand/startShellCommandRequest";

beforeEach(() => {
  hydrateQuietAppStore();
});

afterEach(() => {
  setSessionRecorder(null);
  hydrateQuietAppStore();
});

test("LLM requests record start, delta, and finish runtime events", async () => {
  const events = captureRuntimeEvents();
  const resetStream = setStartLlmRequestStreamForTest(async ({ onDelta }) => {
    onDelta?.("chunk");
    return { kind: "text", responseText: "done" };
  });

  try {
    startLlmRequest("Explain this");
    await waitForRuntimeEvent(events, "llm.finished");
  } finally {
    resetStream();
  }

  expect(eventKinds(events)).toEqual([
    "llm.started",
    "llm.delta",
    "llm.finished",
  ]);
});

test("LLM requests store completion latency stats", async () => {
  const events = captureRuntimeEvents();
  const resetStream = setStartLlmRequestStreamForTest(
    async ({ onCompletionLatency }) => {
      onCompletionLatency?.({ totalMs: 95, ttftMs: 20 });
      return { kind: "text", responseText: "done" };
    },
  );

  try {
    startLlmRequest("Explain this");
    await waitForRuntimeEvent(events, "llm.finished");
  } finally {
    resetStream();
  }

  const activeTask = useAppStore.getState().activeTask;
  expect(
    activeTask?.kind === "response"
      ? activeTask.request.latencyStats
      : undefined,
  ).toEqual({ totalMs: 95, ttftMs: 20 });
});

test("LLM requests record patch progress runtime events", async () => {
  const events = captureRuntimeEvents();
  const resetStream = setStartLlmRequestStreamForTest(
    async ({ onPatchProgress }) => {
      onPatchProgress?.({
        files: [{ operation: "update", path: "README.md" }],
        patchCharacterCount: 80,
      });
      return { kind: "text", responseText: "done" };
    },
  );

  try {
    startLlmRequest("Edit the README");
    await waitForRuntimeEvent(events, "llm.finished");
  } finally {
    resetStream();
  }

  expect(eventKinds(events)).toEqual([
    "llm.started",
    "llm.patch-progress",
    "llm.finished",
  ]);
  expect(events[1]).toMatchObject({
    fileCount: 1,
    kind: "llm.patch-progress",
    patchCharacterCount: 80,
    requestId: 1,
  });
});

test("LLM requests forward patch apply mode and request id to the streamer", async () => {
  const events = captureRuntimeEvents();
  const streamedOptions: unknown[] = [];
  const resetStream = setStartLlmRequestStreamForTest(async (options) => {
    streamedOptions.push({
      patchToolMode: options.patchToolMode,
      requestId: options.requestId,
    });
    return { kind: "text", responseText: "done" };
  });

  try {
    startLlmRequest("Edit the README", { patchToolMode: "apply" });
    await waitForRuntimeEvent(events, "llm.finished");
  } finally {
    resetStream();
  }

  expect(streamedOptions).toEqual([
    {
      patchToolMode: "apply",
      requestId: 1,
    },
  ]);
});

test("shell reruns record start and finish runtime events", async () => {
  const events = captureRuntimeEvents();

  startShellCommandRerun({
    command: "printf runtime-shell",
    replaceContextItemId: "shell:missing",
  });
  await waitForRuntimeEvent(events, "shell-command.finished");

  expect(eventKinds(events)).toEqual([
    "shell-command.started",
    "shell-command.finished",
  ]);
});

test("find-files workflow records runtime event payloads", async () => {
  const events = captureRuntimeEvents();
  const item = createUserTextContextItem({
    createdAt: 1,
    id: "say:selected",
    text: "Look near routing.",
  });
  hydrateStoreWithContextItem(item);
  const finishedCandidates: unknown[] = [];
  const failures: string[] = [];

  startFindFilesSearch({
    actions: {
      fail: ({ errorMessage }) => failures.push(errorMessage),
      finish: ({ candidates }) => finishedCandidates.push(candidates),
      recordAgentOutput: () => {},
    },
    runSearch: async () => [
      { path: "src/router.ts", reason: "Routes requests" },
    ],
    screen: searchingFindFilesScreen(),
  });
  await waitForRuntimeEvent(events, "find-files.finished");
  startFindFilesSearch({
    actions: {
      fail: ({ errorMessage }) => failures.push(errorMessage),
      finish: ({ candidates }) => finishedCandidates.push(candidates),
      recordAgentOutput: () => {},
    },
    runSearch: async () => {
      throw new Error("boom");
    },
    screen: searchingFindFilesScreen(),
  });
  await waitForRuntimeEvent(events, "find-files.failed");

  expect(finishedCandidates).toEqual([
    [{ path: "src/router.ts", reason: "Routes requests" }],
  ]);
  expect(failures).toEqual(["boom"]);
  expect(events).toEqual([
    {
      contextItemIds: [item.id],
      focusedContextItemId: item.id,
      goal: "Find routing code",
      hintCount: 1,
      kind: "find-files.started",
    },
    {
      candidateCount: 1,
      goal: "Find routing code",
      kind: "find-files.finished",
    },
    {
      contextItemIds: [item.id],
      focusedContextItemId: item.id,
      goal: "Find routing code",
      hintCount: 1,
      kind: "find-files.started",
    },
    {
      errorMessage: "boom",
      goal: "Find routing code",
      kind: "find-files.failed",
    },
  ]);
});

test("find-files workflow aborts on cleanup", () => {
  const item = createUserTextContextItem({
    createdAt: 1,
    id: "say:selected",
    text: "Look near routing.",
  });
  hydrateStoreWithContextItem(item);
  const controller = new AbortController();
  const cleanup = startFindFilesSearch({
    actions: {
      fail: () => {},
      finish: () => {},
      recordAgentOutput: () => {},
    },
    createAbortHandle: () => ({
      abort: () => controller.abort(),
      dispose: () => {},
      signal: controller.signal,
    }),
    runSearch: async () => new Promise(() => {}),
    screen: searchingFindFilesScreen(),
  });

  cleanup();

  expect(controller.signal.aborted).toBe(true);
});

test("aborted agent startup records start and failure runtime events", async () => {
  const events = captureRuntimeEvents();
  const itemId = useAppStore.getState().actions.agentAsk.start({
    mode: "ask",
    prompt: "Summarize the selected file",
  });
  if (itemId === null) {
    throw new Error("Could not start test agent item.");
  }

  const controller = new AbortController();
  controller.abort();
  await startAgentAskSession({
    contextItems: [],
    focusedContextItemId: null,
    itemId,
    mode: "ask",
    prompt: "Summarize the selected file",
    signal: controller.signal,
  });

  expect(eventKinds(events)).toEqual([
    "agent-session.started",
    "agent-session.failed",
  ]);
  expect(events[1]?.errorMessage).toBe("Agent session was aborted.");
});

function captureRuntimeEvents(): Record<string, unknown>[] {
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
  return events;
}

function eventKinds(events: readonly Record<string, unknown>[]): unknown[] {
  return events.map((event) => event.kind);
}

function hydrateStoreWithContextItem(
  item: ReturnType<typeof createUserTextContextItem>,
) {
  const state = createInitialAppState();
  hydrateAppStore({
    ...state,
    workspace: {
      ...state.workspace,
      automaticContextItems: [],
      contextItems: [item],
      focusedContextItemId: item.id,
    },
  });
}

function searchingFindFilesScreen() {
  return {
    agentOutput: [],
    candidates: [],
    goal: "Find routing code",
    hints: ["router"],
    kind: "find-files" as const,
    selectedIndex: 0,
    status: "searching" as const,
  };
}

async function waitForRuntimeEvent(
  events: readonly Record<string, unknown>[],
  kind: string,
): Promise<Record<string, unknown>> {
  for (let index = 0; index < 50; index += 1) {
    const event = events.find((candidate) => candidate.kind === kind);
    if (event !== undefined) {
      return event;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for runtime event ${kind}.`);
}

function hydrateQuietAppStore() {
  const state = createInitialAppState();
  hydrateAppStore({
    ...state,
    workspace: {
      ...state.workspace,
      automaticContextItems: [],
    },
  });
}
