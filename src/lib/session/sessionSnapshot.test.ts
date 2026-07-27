import { afterEach, test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AppState, AppTask } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import {
  createFileContextItem,
  createLiveLlmResponseContextItem,
  createPiAgentContextItem,
  createSavedLlmResponseContextItem,
} from "../context/contextItemFactories";
import type { PiAgentContextItem } from "../context/contextItemTypes";
import { decodeSchema } from "../schemaDecode";
import { CONTEXT_RECORDS_V1_SNAPSHOT } from "./contextRecordsV1.fixture";
import {
  CreateFileTaskSchema,
  FindFilesTaskSchema,
  ShellCommandTaskSchema,
  ShowContextTaskSchema,
} from "./sessionSnapshotSchemas";
import {
  parseAppSnapshot,
  restoreAppStateFromSnapshot,
  serializeAppSnapshot,
  serializeInterruptedAppSnapshot,
} from "./sessionSnapshot";
import {
  createSessionMetadata,
  initializeSession,
  loadSessionById,
  resolveWorkspaceRoot,
  writeSessionSnapshot,
} from "./sessionStorage";

test("literal v1 snapshot restores workspace and request records separately", () => {
  const restored = restoreAppStateFromSnapshot(
    parseAppSnapshot(CONTEXT_RECORDS_V1_SNAPSHOT as unknown),
  );

  expect(restored.workspace.contextItems.map((item) => item.type)).toEqual([
    "file",
    "llm-response",
    "shell-command-output",
    "user-text",
    "llm-response-live",
    "pi-agent",
    "diff",
    "agent-sandbox-diff",
  ]);
  expect(
    restored.activeTask?.kind === "response"
      ? restored.activeTask.request.contextItems.map((item) => item.id)
      : [],
  ).toEqual(["file:src/index.tsx", "request-context:20"]);
  expect(
    restored.activeTask?.kind === "response"
      ? restored.activeTask.request.patchProgress
      : undefined,
  ).toEqual({
    files: [{ operation: "update", path: "src/index.tsx" }],
    patchCharacterCount: 321,
  });
  expect(
    restored.workspace.automaticContextItems.map((item) => item.type),
  ).toEqual(["file", "automatic-unstaged-changes", "automatic-file-list"]);

  const encoded = serializeAppSnapshot({
    state: { ...restored, actions: {} as AppState["actions"] },
    workspaceRoot: "/repo",
  });
  expect(encoded.workspace.contextItems).toHaveLength(8);
  expect(encoded.activeTask?.kind).toBe("response");
  if (encoded.activeTask?.kind === "response") {
    expect(encoded.activeTask.request.contextItems).toHaveLength(2);
    expect(encoded.activeTask.request.patchProgress).toEqual({
      files: [{ operation: "update", path: "src/index.tsx" }],
      patchCharacterCount: 321,
    });
  }
});

test("restore normalizes searching find-files before render", () => {
  const initial = createInitialAppState();
  const state: AppState = {
    ...initial,
    actions: {} as AppState["actions"],
    activeTask: {
      agentOutput: [],
      goal: "Find parser",
      hints: [],
      kind: "find-files",
      status: "searching",
    },
  };

  const restored = restoreAppStateFromSnapshot(
    serializeAppSnapshot({ state, workspaceRoot: "/repo" }),
  );

  expect(restored.activeTask).toMatchObject({
    errorMessage: "Interrupted while searching for files.",
    kind: "find-files",
    status: "error",
  });
});

test("restore normalizes interrupted active task variants before render", () => {
  const base = {
    ...createInitialAppState(),
    actions: {} as AppState["actions"],
  };
  const cases: Array<{
    activeTask: AppState["activeTask"];
    expected: Record<string, unknown>;
    name: string;
  }> = [
    {
      activeTask: {
        applyStatus: "applying",
        itemId: "diff:1",
        kind: "context-item-viewer",
      },
      expected: {
        applyErrorMessage: "Interrupted while applying changes.",
        applyStatus: "apply-error",
      },
      name: "context-item-viewer applying",
    },
    {
      activeTask: {
        applyStatus: "applying",
        id: 2,
        kind: "create-file",
        prompt: "create",
        validation: {
          proposal: {
            content: "export const value = 1;\n",
            path: "src/new.ts",
            summary: "Create helper",
          },
          status: "valid",
        },
      },
      expected: {
        applyErrorMessage: "Interrupted while creating file.",
        applyStatus: "apply-error",
      },
      name: "create-file applying",
    },
    {
      activeTask: {
        id: 3,
        kind: "shell-command",
        prompt: "run tests",
        status: "running",
      },
      expected: {
        errorMessage: "Interrupted while running shell command.",
        status: "error",
      },
      name: "shell-command running",
    },
    {
      activeTask: {
        id: 4,
        kind: "show-context",
        question: "show context",
        status: "loading",
      },
      expected: {
        errorMessage: "Interrupted while rendering context.",
        status: "error",
      },
      name: "show-context loading",
    },
    {
      activeTask: {
        kind: "response",
        request: {
          contextItems: [],
          focusedContextItemId: null,
          id: 5,
          patch: {
            applyStatus: "applying",
            diffText: "diff --git a/a.ts b/a.ts\n",
            proposal: {
              patch:
                "*** Begin Patch\n*** Update File: a.ts\n@@\n-old\n+new\n*** End Patch",
              summary: "No-op",
            },
            status: "valid",
          },
          question: "apply",
          responseText: "",
          status: "done",
        },
      },
      expected: {
        request: {
          patch: {
            applyErrorMessage: "Interrupted while applying patch.",
            applyStatus: "apply-error",
          },
        },
      },
      name: "response patch applying",
    },
  ];

  for (const testCase of cases) {
    const restored = restoreAppStateFromSnapshot(
      serializeAppSnapshot({
        state: { ...base, activeTask: testCase.activeTask },
        workspaceRoot: "/repo",
      }),
    );

    expect(restored.activeTask, testCase.name).toMatchObject(testCase.expected);
  }
});

test("restore detaches legacy agent sessions and marks running agents interrupted", () => {
  const initial = createInitialAppState();
  const agent = createPiAgentContextItem({
    createdAt: 1,
    id: "agent:9",
    mode: "edit",
    prompt: "fix",
  });
  const state: AppState = {
    ...initial,
    actions: {} as AppState["actions"],
    workspace: {
      ...initial.workspace,
      contextItems: [agent],
      focusedContextItemId: agent.id,
    },
  };

  const restored = restoreAppStateFromSnapshot(
    serializeAppSnapshot({ state, workspaceRoot: "/repo" }),
  );
  const restoredAgent = restored.workspace.contextItems[0];

  expect(restoredAgent).toMatchObject({ type: "pi-agent" });
  expect((restoredAgent as PiAgentContextItem).sessionAvailability).toBe(
    "detached",
  );
  expect((restoredAgent as PiAgentContextItem).status).toBe("error");
  expect((restoredAgent as PiAgentContextItem).errorMessage).toContain(
    "Interrupted",
  );
});

test("interrupted snapshot serializes live items as terminal states", () => {
  const initial = createInitialAppState();
  const live = createLiveLlmResponseContextItem({
    createdAt: 1,
    id: "saved:4",
    output: "partial",
    prompt: "answer",
    sourceRequestId: 2,
  });
  const state: AppState = {
    ...initial,
    actions: {} as AppState["actions"],
    activeTask: {
      kind: "response",
      request: {
        contextItems: [live],
        focusedContextItemId: live.id,
        id: 2,
        question: "answer",
        responseText: "partial",
        status: "streaming",
      },
    },
    workspace: {
      ...initial.workspace,
      contextItems: [live],
      focusedContextItemId: live.id,
    },
  };

  const snapshot = serializeInterruptedAppSnapshot({
    state,
    workspaceRoot: "/repo",
  });

  expect(snapshot.activeTask?.kind).toBe("response");
  if (snapshot.activeTask?.kind === "response") {
    expect(snapshot.activeTask.request.status).toBe("error");
  }
  expect(snapshot.workspace.contextItems[0]).toMatchObject({
    errorMessage: "Interrupted while waiting for model response.",
    status: "error",
  });
});

test("restore bumps next ids beyond restored item and request ids", () => {
  const initial = createInitialAppState();
  const file = createFileContextItem("src/a.ts");
  const live = createLiveLlmResponseContextItem({
    createdAt: 1,
    id: "saved:12",
    prompt: "answer",
    sourceRequestId: 8,
  });
  const state: AppState = {
    ...initial,
    actions: {} as AppState["actions"],
    nextContextItemId: 1,
    nextLlmRequestId: 1,
    workspace: {
      ...initial.workspace,
      contextItems: [file, live],
      focusedContextItemId: live.id,
    },
  };

  const restored = restoreAppStateFromSnapshot(
    serializeAppSnapshot({ state, workspaceRoot: "/repo" }),
  );

  expect(restored.nextContextItemId).toBeGreaterThan(12);
  expect(restored.nextLlmRequestId).toBeGreaterThan(8);
});

test("restore bumps ids using active response context items", () => {
  const initial = createInitialAppState();
  const saved = createSavedLlmResponseContextItem({
    createdAt: 1,
    id: "saved:42",
    output: "historical answer",
    prompt: "answer",
    sourceRequestId: 17,
  });
  const state: AppState = {
    ...initial,
    actions: {} as AppState["actions"],
    activeTask: {
      kind: "response",
      request: {
        contextItems: [saved],
        focusedContextItemId: saved.id,
        id: 3,
        question: "continue",
        responseText: "",
        status: "done",
      },
    },
    nextContextItemId: 1,
    nextLlmRequestId: 1,
  };

  const restored = restoreAppStateFromSnapshot(
    serializeAppSnapshot({ state, workspaceRoot: "/repo" }),
  );

  expect(restored.nextContextItemId).toBeGreaterThan(42);
  expect(restored.nextLlmRequestId).toBeGreaterThan(17);
});

test("snapshot parser rejects config and unknown active tasks", () => {
  const baseSnapshot = serializeAppSnapshot({
    state: { ...createInitialAppState(), actions: {} as AppState["actions"] },
    workspaceRoot: "/repo",
  });

  expect(() =>
    parseAppSnapshot({
      ...baseSnapshot,
      activeTask: { kind: "config" },
    }),
  ).toThrow("Config tasks are not valid session snapshot tasks");

  expect(() =>
    parseAppSnapshot({
      ...baseSnapshot,
      activeTask: { kind: "mystery" },
    }),
  ).toThrow("Unknown active task kind");
});

test("snapshot parser rejects malformed known active tasks and counters", () => {
  const baseSnapshot = serializeAppSnapshot({
    state: { ...createInitialAppState(), actions: {} as AppState["actions"] },
    workspaceRoot: "/repo",
  });

  expect(() =>
    parseAppSnapshot({
      ...baseSnapshot,
      nextLlmRequestId: 0,
    }),
  ).toThrow("nextLlmRequestId must be a positive safe integer");

  expect(() =>
    parseAppSnapshot({
      ...baseSnapshot,
      nextLlmRequestId: 9007199254740992,
    }),
  ).toThrow("nextLlmRequestId must be a positive safe integer");

  expect(() =>
    parseAppSnapshot({
      ...baseSnapshot,
      activeTask: {
        id: 0,
        kind: "show-context",
        question: "show",
        status: "loading",
      },
    }),
  ).toThrow("activeTask.id must be a positive safe integer");

  expect(() =>
    parseAppSnapshot({
      ...baseSnapshot,
      activeTask: {
        agentOutput: [{ kind: "stream" }],
        goal: "find",
        hints: [],
        kind: "find-files",
        status: "searching",
      },
    }),
  ).toThrow("activeTask.agentOutput[0].id must be a string");

  const file = createFileContextItem("src/a.ts");
  const serializedFile = serializeAppSnapshot({
    state: {
      ...createInitialAppState(),
      actions: {} as AppState["actions"],
      workspace: {
        ...createInitialAppState().workspace,
        contextItems: [file],
        focusedContextItemId: file.id,
      },
    },
    workspaceRoot: "/repo",
  }).workspace.contextItems[0]!;

  expect(() =>
    parseAppSnapshot({
      ...baseSnapshot,
      workspace: {
        ...baseSnapshot.workspace,
        contextItems: [serializedFile, serializedFile],
      },
    }),
  ).toThrow("workspace.contextItems[1].id duplicates");

  expect(() =>
    parseAppSnapshot({
      ...baseSnapshot,
      activeTask: {
        kind: "response",
        request: {
          contextItems: [serializedFile, serializedFile],
          focusedContextItemId: null,
          id: 1,
          question: "answer",
          responseText: "",
          status: "done",
        },
      },
    }),
  ).toThrow("activeTask.request.contextItems[1].id duplicates");

  const agent = createPiAgentContextItem({
    createdAt: 1,
    id: "agent:1",
    mode: "ask",
    prompt: "work",
  });
  const serializedAgent = serializeAppSnapshot({
    state: {
      ...createInitialAppState(),
      actions: {} as AppState["actions"],
      workspace: {
        ...createInitialAppState().workspace,
        contextItems: [agent],
        focusedContextItemId: agent.id,
      },
    },
    workspaceRoot: "/repo",
  }).workspace.contextItems[0]! as PiAgentContextItem;
  const { sessionAvailability, ...agentWithoutAvailability } = serializedAgent;

  expect(sessionAvailability).toBeDefined();
  expect(() =>
    parseAppSnapshot({
      ...baseSnapshot,
      workspace: {
        ...baseSnapshot.workspace,
        contextItems: [agentWithoutAvailability],
      },
    }),
  ).toThrow("pi-agent.sessionAvailability");

  expect(() =>
    parseAppSnapshot({
      ...baseSnapshot,
      activeTask: {
        applyStatus: "pending",
        id: 1,
        kind: "create-file",
        prompt: "create",
        validation: {
          proposal: { content: "", path: "src/new.ts" },
          status: "valid",
        },
      },
    }),
  ).toThrow("activeTask.validation.proposal.summary must be a string");
});

test("snapshot round-trips every task kind byte-identically through parse", () => {
  const base = {
    ...createInitialAppState(),
    actions: {} as AppState["actions"],
    nextContextItemId: 12,
    nextLlmRequestId: 9,
    workspace: {
      ...createInitialAppState().workspace,
      composer: { cursorPosition: 4, message: "draft" },
      contextItems: [createFileContextItem("src/a.ts")],
      focusedContextItemId: "file:src/a.ts",
    },
  };
  const workspaceRoot = "/repo";
  const patchProposal = {
    patch:
      "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch",
    summary: "Update helper",
  };
  const responseBase = {
    contextItems: [
      createSavedLlmResponseContextItem({
        createdAt: 1,
        id: "saved:3",
        output: "prior answer",
        prompt: "prior",
        sourceRequestId: 3,
      }),
    ],
    focusedContextItemId: "saved:3",
    id: 4,
    latencyStats: { totalMs: 120, ttftMs: 40 },
    patch: {
      applyStatus: "pending" as const,
      diffText: "diff --git a/src/a.ts b/src/a.ts\n",
      proposal: patchProposal,
      status: "valid" as const,
    },
    patchProgress: {
      files: [{ operation: "update" as const, path: "src/a.ts" }],
      patchCharacterCount: 88,
    },
    question: "continue",
    replacement: {
      contextItemId: "saved:3",
      expectedResult: "text" as const,
    },
    responseText: "answer",
    savedContextItemId: "saved:3",
  };
  const tasks: NonNullable<AppState["activeTask"]>[] = [
    {
      applyStatus: "idle",
      itemId: "file:src/a.ts",
      kind: "context-item-viewer",
      rejectComposer: { cursorPosition: 1, message: "reject" },
    },
    {
      applyStatus: "pending",
      id: 5,
      kind: "create-file",
      prompt: "add helper",
      validation: {
        proposal: {
          content: "export const value = 1;\n",
          path: "src/new.ts",
          summary: "Create helper",
        },
        status: "valid",
      },
    },
    {
      agentOutput: [
        {
          id: "status:1",
          kind: "status",
          message: "searching",
          timestamp: 1,
        },
        {
          id: "stream:1",
          kind: "stream",
          streamKind: "assistant",
          text: "candidate path",
          timestamp: 2,
        },
      ],
      candidates: [
        {
          confidence: "high",
          path: "src/a.ts",
          reason: "matches goal",
        },
      ],
      goal: "find parser",
      hints: ["src"],
      kind: "find-files",
      selectedIndex: 0,
      status: "results",
    },
    {
      id: 6,
      kind: "shell-command",
      prompt: "bun test",
      replacement: { contextItemId: "saved:3" },
      result: {
        command: "bun test",
        durationMs: 10,
        exitCode: 0,
        stderr: "",
        stdout: "ok",
        timedOut: false,
        truncated: false,
      },
      savedContextItemId: "shell:6",
      status: "done",
    },
    {
      content: "rendered context",
      id: 7,
      kind: "show-context",
      question: "show files",
      status: "done",
    },
    {
      kind: "response",
      rejectComposer: { cursorPosition: 0, message: "" },
      request: { ...responseBase, status: "loading" },
    },
    {
      kind: "response",
      request: {
        ...responseBase,
        responseText: "streaming",
        status: "streaming",
      },
    },
    {
      kind: "response",
      request: { ...responseBase, status: "done" },
    },
    {
      kind: "response",
      request: {
        ...responseBase,
        errorMessage: "model failed",
        status: "error",
      },
    },
  ];

  for (const activeTask of tasks) {
    const snapshot = serializeAppSnapshot({
      state: { ...base, activeTask },
      workspaceRoot,
    });
    const roundTripped = parseAppSnapshot(
      JSON.parse(JSON.stringify(snapshot)) as unknown,
    );

    expect(roundTripped, activeTask.kind).toEqual(snapshot);
  }
});

const originalConfigDir = process.env.CLUTCH_CONFIG_DIR;
const tempRoots: string[] = [];

afterEach(async () => {
  if (originalConfigDir === undefined) {
    delete process.env.CLUTCH_CONFIG_DIR;
  } else {
    process.env.CLUTCH_CONFIG_DIR = originalConfigDir;
  }

  await Promise.all(
    tempRoots
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

test("every persisted task variant round-trips through serialize, parse, and restore", () => {
  const base = snapshotRoundTripBaseState();
  const workspaceRoot = "/repo";
  const shellResult = {
    command: "bun test",
    durationMs: 10,
    exitCode: 0,
    stderr: "",
    stdout: "ok",
    timedOut: false,
    truncated: false,
  };
  const createFileValidation = {
    proposal: {
      content: "export const value = 1;\n",
      path: "src/new.ts",
      summary: "Create helper",
    },
    status: "valid" as const,
  };
  const findFilesAgentOutput = [
    {
      id: "status:1",
      kind: "status" as const,
      message: "searching",
      timestamp: 1,
    },
  ];
  const responseRequestBase = snapshotResponseRequestBase();
  const patchProposal = {
    patch:
      "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch",
    summary: "Update helper",
  };

  const cases: Array<{
    activeTask: NonNullable<AppState["activeTask"]>;
    expectedActiveTask?: NonNullable<AppState["activeTask"]>;
    name: string;
  }> = [
    {
      name: "show-context loading",
      activeTask: {
        id: 1,
        kind: "show-context",
        question: "show files",
        status: "loading",
      },
      expectedActiveTask: {
        errorMessage: "Interrupted while rendering context.",
        id: 1,
        kind: "show-context",
        question: "show files",
        status: "error",
      },
    },
    {
      name: "show-context done",
      activeTask: {
        content: "rendered context",
        id: 2,
        kind: "show-context",
        question: "show files",
        status: "done",
      },
    },
    {
      name: "show-context error",
      activeTask: {
        errorMessage: "render failed",
        id: 3,
        kind: "show-context",
        question: "show files",
        status: "error",
      },
    },
    {
      name: "shell-command running",
      activeTask: {
        id: 4,
        kind: "shell-command",
        prompt: "bun test",
        status: "running",
      },
      expectedActiveTask: {
        errorMessage: "Interrupted while running shell command.",
        id: 4,
        kind: "shell-command",
        prompt: "bun test",
        status: "error",
      },
    },
    {
      name: "shell-command done without savedContextItemId",
      activeTask: {
        id: 5,
        kind: "shell-command",
        prompt: "bun test",
        result: shellResult,
        status: "done",
      },
    },
    {
      name: "shell-command done with savedContextItemId",
      activeTask: {
        id: 6,
        kind: "shell-command",
        prompt: "bun test",
        replacement: { contextItemId: "saved:3" },
        result: shellResult,
        savedContextItemId: "shell:6",
        status: "done",
      },
    },
    {
      name: "shell-command error",
      activeTask: {
        errorMessage: "command failed",
        id: 7,
        kind: "shell-command",
        prompt: "bun test",
        status: "error",
      },
    },
    {
      name: "find-files searching",
      activeTask: {
        agentOutput: findFilesAgentOutput,
        goal: "find parser",
        hints: ["src"],
        kind: "find-files",
        status: "searching",
      },
      expectedActiveTask: {
        agentOutput: findFilesAgentOutput,
        errorMessage: "Interrupted while searching for files.",
        goal: "find parser",
        hints: ["src"],
        kind: "find-files",
        status: "error",
      },
    },
    {
      name: "find-files results",
      activeTask: {
        agentOutput: findFilesAgentOutput,
        candidates: [
          {
            confidence: "high",
            path: "src/a.ts",
            reason: "matches goal",
          },
        ],
        goal: "find parser",
        hints: ["src"],
        kind: "find-files",
        selectedIndex: 0,
        status: "results",
      },
    },
    {
      name: "find-files error",
      activeTask: {
        agentOutput: findFilesAgentOutput,
        errorMessage: "search failed",
        goal: "find parser",
        hints: ["src"],
        kind: "find-files",
        status: "error",
      },
    },
    {
      name: "create-file pending",
      activeTask: {
        applyStatus: "pending",
        id: 8,
        kind: "create-file",
        prompt: "add helper",
        validation: createFileValidation,
      },
    },
    {
      name: "create-file applying",
      activeTask: {
        applyStatus: "applying",
        id: 9,
        kind: "create-file",
        prompt: "add helper",
        validation: createFileValidation,
      },
      expectedActiveTask: {
        applyErrorMessage: "Interrupted while creating file.",
        applyStatus: "apply-error",
        id: 9,
        kind: "create-file",
        prompt: "add helper",
        validation: createFileValidation,
      },
    },
    {
      name: "create-file apply-error",
      activeTask: {
        applyErrorMessage: "write failed",
        applyStatus: "apply-error",
        id: 10,
        kind: "create-file",
        prompt: "add helper",
        validation: createFileValidation,
      },
    },
    {
      name: "context-item-viewer idle",
      activeTask: {
        applyStatus: "idle",
        itemId: "file:src/a.ts",
        kind: "context-item-viewer",
      },
    },
    {
      name: "context-item-viewer applying",
      activeTask: {
        applyStatus: "applying",
        itemId: "file:src/a.ts",
        kind: "context-item-viewer",
      },
      expectedActiveTask: {
        applyErrorMessage: "Interrupted while applying changes.",
        applyStatus: "apply-error",
        itemId: "file:src/a.ts",
        kind: "context-item-viewer",
      },
    },
    {
      name: "context-item-viewer apply-error",
      activeTask: {
        applyErrorMessage: "apply failed",
        applyStatus: "apply-error",
        itemId: "file:src/a.ts",
        kind: "context-item-viewer",
      },
    },
    {
      name: "response loading",
      activeTask: {
        kind: "response",
        request: { ...responseRequestBase, status: "loading" },
      },
      expectedActiveTask: {
        kind: "response",
        request: {
          ...responseRequestBase,
          errorMessage: "Interrupted while waiting for model response.",
          status: "error",
        },
      },
    },
    {
      name: "response streaming",
      activeTask: {
        kind: "response",
        request: {
          ...responseRequestBase,
          responseText: "streaming",
          status: "streaming",
        },
      },
      expectedActiveTask: {
        kind: "response",
        request: {
          ...responseRequestBase,
          errorMessage: "Interrupted while waiting for model response.",
          responseText: "streaming",
          status: "error",
        },
      },
    },
    {
      name: "response done",
      activeTask: {
        kind: "response",
        request: { ...responseRequestBase, status: "done" },
      },
    },
    {
      name: "response done with invalid patch validation errors",
      activeTask: {
        kind: "response",
        request: {
          ...responseRequestBase,
          patch: {
            applyStatus: "pending",
            errors: [
              { editIndex: 0, message: "bad hunk" },
              { editIndex: 1, message: "bad path", path: "src/a.ts" },
            ],
            proposal: patchProposal,
            status: "invalid",
          },
          status: "done",
        },
      },
    },
  ];

  for (const testCase of cases) {
    const snapshot = serializeAppSnapshot({
      state: { ...base, activeTask: testCase.activeTask },
      workspaceRoot,
    });
    const parsed = parseAppSnapshot(
      JSON.parse(JSON.stringify(snapshot)) as unknown,
    );
    const restored = restoreAppStateFromSnapshot(parsed);

    expect(restored.activeTask, testCase.name).toEqual(
      testCase.expectedActiveTask ?? testCase.activeTask,
    );
  }
});

test("disk round-trip preserves one terminal variant per persisted task kind", async () => {
  const configDir = await tempDir("clutch-snapshot-config-");
  const workspaceRoot = await resolveWorkspaceRoot(
    await tempDir("clutch-snapshot-root-"),
  );
  process.env.CLUTCH_CONFIG_DIR = configDir;

  const base = snapshotRoundTripBaseState();
  const createFileValidation = {
    proposal: {
      content: "export const value = 1;\n",
      path: "src/new.ts",
      summary: "Create helper",
    },
    status: "valid" as const,
  };
  const responseRequestBase = snapshotResponseRequestBase();
  const cases: Array<{
    activeTask: NonNullable<AppState["activeTask"]>;
    name: string;
  }> = [
    {
      name: "show-context done",
      activeTask: {
        content: "rendered context",
        id: 1,
        kind: "show-context",
        question: "show files",
        status: "done",
      },
    },
    {
      name: "shell-command done",
      activeTask: {
        id: 2,
        kind: "shell-command",
        prompt: "bun test",
        result: {
          command: "bun test",
          durationMs: 10,
          exitCode: 0,
          stderr: "",
          stdout: "ok",
          timedOut: false,
          truncated: false,
        },
        savedContextItemId: "shell:2",
        status: "done",
      },
    },
    {
      name: "find-files results",
      activeTask: {
        agentOutput: [],
        candidates: [{ path: "src/a.ts", reason: "match" }],
        goal: "find parser",
        hints: [],
        kind: "find-files",
        selectedIndex: 0,
        status: "results",
      },
    },
    {
      name: "create-file apply-error",
      activeTask: {
        applyErrorMessage: "write failed",
        applyStatus: "apply-error",
        id: 3,
        kind: "create-file",
        prompt: "add helper",
        validation: createFileValidation,
      },
    },
    {
      name: "context-item-viewer apply-error",
      activeTask: {
        applyErrorMessage: "apply failed",
        applyStatus: "apply-error",
        itemId: "file:src/a.ts",
        kind: "context-item-viewer",
      },
    },
    {
      name: "response done with invalid patch",
      activeTask: {
        kind: "response",
        request: {
          ...responseRequestBase,
          patch: {
            applyStatus: "pending",
            errors: [
              { editIndex: 0, message: "bad hunk" },
              { editIndex: 1, message: "bad path", path: "src/a.ts" },
            ],
            proposal: {
              patch:
                "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch",
              summary: "Update helper",
            },
            status: "invalid",
          },
          status: "done",
        },
      },
    },
  ];

  for (const testCase of cases) {
    const metadata = await createSessionMetadata({ workspaceRoot });
    await initializeSession(metadata);
    const inputTask = testCase.activeTask;

    await writeSessionSnapshot({
      metadata,
      snapshot: serializeAppSnapshot({
        state: { ...base, activeTask: inputTask },
        workspaceRoot,
      }),
    });

    const loaded = await loadSessionById({
      sessionId: metadata.id,
      workspaceRoot,
    });
    const restored = restoreAppStateFromSnapshot(loaded.snapshot);

    expect(restored.activeTask, testCase.name).toEqual(inputTask);
  }
});

test("task schemas reject invalid status payload combinations", () => {
  expect(() =>
    decodeSchema(
      ShowContextTaskSchema,
      {
        id: 1,
        kind: "show-context",
        question: "show",
        status: "done",
      },
      "activeTask",
    ),
  ).toThrow();

  expect(() =>
    decodeSchema(
      ShellCommandTaskSchema,
      {
        id: 1,
        kind: "shell-command",
        prompt: "run",
        status: "done",
      },
      "activeTask",
    ),
  ).toThrow();

  expect(() =>
    decodeSchema(
      CreateFileTaskSchema,
      {
        applyStatus: "apply-error",
        id: 1,
        kind: "create-file",
        prompt: "create",
      },
      "activeTask",
    ),
  ).toThrow();

  expect(() =>
    decodeSchema(
      FindFilesTaskSchema,
      {
        goal: "find",
        hints: [],
        kind: "find-files",
        selectedIndex: 0,
        status: "results",
      },
      "activeTask",
    ),
  ).toThrow();

  const baseSnapshot = serializeAppSnapshot({
    state: { ...createInitialAppState(), actions: {} as AppState["actions"] },
    workspaceRoot: "/repo",
  });

  expect(() =>
    parseAppSnapshot({
      ...baseSnapshot,
      activeTask: {
        id: 1,
        kind: "show-context",
        question: "show",
        status: "done",
      },
    }),
  ).toThrow();

  expect(() =>
    parseAppSnapshot({
      ...baseSnapshot,
      activeTask: {
        id: 1,
        kind: "shell-command",
        prompt: "run",
        status: "done",
      },
    }),
  ).toThrow();
});

function snapshotRoundTripBaseState(): AppState {
  return {
    ...createInitialAppState(),
    actions: {} as AppState["actions"],
    nextContextItemId: 12,
    nextLlmRequestId: 9,
    workspace: {
      ...createInitialAppState().workspace,
      composer: { cursorPosition: 4, message: "draft" },
      contextItems: [createFileContextItem("src/a.ts")],
      focusedContextItemId: "file:src/a.ts",
    },
  };
}

function snapshotResponseRequestBase(): Omit<
  Extract<AppTask, { kind: "response" }>["request"],
  "status" | "errorMessage"
> {
  return {
    contextItems: [
      createSavedLlmResponseContextItem({
        createdAt: 1,
        id: "saved:3",
        output: "prior answer",
        prompt: "prior",
        sourceRequestId: 3,
      }),
    ],
    focusedContextItemId: "saved:3",
    id: 4,
    latencyStats: { totalMs: 120, ttftMs: 40 },
    patch: {
      applyStatus: "pending",
      diffText: "diff --git a/src/a.ts b/src/a.ts\n",
      proposal: {
        patch:
          "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch",
        summary: "Update helper",
      },
      status: "valid",
    },
    patchProgress: {
      files: [{ operation: "update", path: "src/a.ts" }],
      patchCharacterCount: 88,
    },
    question: "continue",
    replacement: {
      contextItemId: "saved:3",
      expectedResult: "text",
    },
    responseText: "answer",
    savedContextItemId: "saved:3",
  };
}

async function tempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(path);
  return path;
}
