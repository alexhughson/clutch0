import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createInitialAppState } from "../app/appInitialState";
import type { AgentSessionDriver } from "../lib/agent/agentSessionDriver";
import {
  CLUTCH_CONFIG_DIR_ENV,
} from "../lib/config/clutchConfig";
import { CURSOR_AUTH_PROVIDER_ID } from "../lib/config/clutchConfig";
import type { SessionRecorder } from "../lib/session/sessionRecorder";
import { createUserTextContextItem } from "../lib/context/contextItems";
import {
  hydrateAppStore,
  setSessionRecorder,
  useAppStore,
} from "../store/appStore";
import {
  setAgentHarnessFactoriesForTest,
  startAgentSession,
} from "./agentAsk/agentAskSessionRegistry";
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

  expect(eventKinds(events)).toContain("llm.started");
  expect(eventKinds(events)).toContain("llm.delta");
  expect(eventKinds(events)).toContain("llm.finished");
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

  expect(eventKinds(events)).toContain("llm.started");
  expect(eventKinds(events)).toContain("llm.patch-progress");
  expect(eventKinds(events)).toContain("llm.finished");
  expect(events.find((event) => event.kind === "llm.patch-progress")).toMatchObject(
    {
    fileCount: 1,
    kind: "llm.patch-progress",
    patchCharacterCount: 80,
    requestId: 1,
    },
  );
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

test("shell reruns record selection and execution runtime events", async () => {
  const events = captureRuntimeEvents();

  startShellCommandRerun({
    command: "printf runtime-shell",
    replaceContextItemId: "shell:missing",
  });
  await waitForRuntimeEvent(events, "shell-command.selection-finished");
  const activeTask = useAppStore.getState().activeTask;
  if (activeTask?.kind !== "shell-command") {
    throw new Error("Expected active shell command task.");
  }
  useAppStore.getState().actions.shellCommand.confirmRun({
    requestId: activeTask.id,
  });
  await waitForRuntimeEvent(events, "shell-command.finished");

  expect(eventKinds(events)).toContain("shell-command.selection-finished");
  expect(eventKinds(events)).toContain("shell-command.started");
  expect(eventKinds(events)).toContain("shell-command.finished");
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
  const startedEvent = events.find((event) => event.kind === "find-files.started");
  expect(startedEvent).toMatchObject({
    goal: "Find routing code",
    kind: "find-files.started",
  });
  const finishedEvent = events.find(
    (event) => event.kind === "find-files.finished",
  );
  expect(finishedEvent).toMatchObject({
    candidateCount: 1,
    kind: "find-files.finished",
  });
  const failedEvent = events.find((event) => event.kind === "find-files.failed");
  expect(failedEvent).toMatchObject({
    errorMessage: "boom",
    kind: "find-files.failed",
  });
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
  await configureAgentHarnessForRuntimeEventsTest();
  const resetFactories = setAgentHarnessFactoriesForTest({
    createSession: async () => ({ agentId: "agent-abort" }),
    createSessionDriver: async () =>
      ({
        async dispose() {},
        latestAssistantText() {
          return null;
        },
        async prompt() {},
      }) satisfies AgentSessionDriver,
  });

  const itemId = useAppStore.getState().actions.agentAsk.start({
    prompt: "Summarize the selected file",
  });
  if (itemId === null) {
    throw new Error("Could not start test agent item.");
  }

  const controller = new AbortController();
  controller.abort();
  try {
    await startAgentSession({
      contextItems: [],
      focusedContextItemId: null,
      itemId,
      prompt: "Summarize the selected file",
      root: process.cwd(),
      signal: controller.signal,
    });
  } finally {
    resetFactories();
  }

  expect(eventKinds(events)).toContain("agent-session.started");
  expect(eventKinds(events)).toContain("agent-session.failed");
  const failedEvent = events.find((event) => event.kind === "agent-session.failed");
  expect(failedEvent?.errorMessage).toBe("Agent session was aborted.");
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

async function configureAgentHarnessForRuntimeEventsTest() {
  const configDir = await mkdtemp(join(tmpdir(), "clutch-runtime-events-"));
  process.env[CLUTCH_CONFIG_DIR_ENV] = configDir;
  await writeFile(
    join(configDir, "settings.json"),
    JSON.stringify({
      agentHarness: {
        kind: "cursor",
        config: { model: "composer-2.5" },
      },
    }),
  );
  await writeFile(
    join(configDir, "auth.json"),
    JSON.stringify({
      [CURSOR_AUTH_PROVIDER_ID]: { key: "cursor_test_key", type: "api_key" },
    }),
  );
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
