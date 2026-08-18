import { test, expect } from "bun:test";
import type { AppState } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import {
  PiAgentContextItem,
  type PiAgentContextItemState,
  createFileContextItem,
  createLiveLlmResponseContextItem,
  createPiAgentContextItem,
  createSavedLlmResponseContextItem,
} from "../context/contextItems";
import {
  parseAppSnapshot,
  restoreAppStateFromSnapshot,
  serializeAppSnapshot,
  serializeInterruptedAppSnapshot,
} from "./sessionSnapshot";

test("snapshot round-trips workspace and active request context separately", () => {
  const initial = createInitialAppState();
  const selectedFile = createFileContextItem("src/index.tsx");
  const automaticAgents = createFileContextItem("AGENTS.md");
  const state: AppState = {
    ...initial,
    actions: {} as AppState["actions"],
    activeTask: {
      kind: "response",
      request: {
        contextItems: [automaticAgents, selectedFile],
        focusedContextItemId: selectedFile.id,
        id: 3,
        patchProgress: {
          files: [{ operation: "update", path: "src/index.tsx" }],
          patchCharacterCount: 100,
        },
        question: "explain",
        responseText: "partial",
        status: "done",
      },
    },
    workspace: {
      ...initial.workspace,
      contextItems: [selectedFile],
      focusedContextItemId: selectedFile.id,
    },
  };

  const restored = restoreAppStateFromSnapshot(
    serializeAppSnapshot({ state, workspaceRoot: "/repo" }),
  );

  expect(restored.workspace.contextItems.map((item) => item.id)).toEqual([
    selectedFile.id,
  ]);
  expect(
    restored.activeTask?.kind === "response"
      ? restored.activeTask.request.contextItems.map((item) => item.id)
      : [],
  ).toEqual([automaticAgents.id, selectedFile.id]);
  expect(
    restored.activeTask?.kind === "response"
      ? restored.activeTask.request.patchProgress
      : undefined,
  ).toEqual({
    files: [{ operation: "update", path: "src/index.tsx" }],
    patchCharacterCount: 100,
  });
});

test("restore normalizes searching find-files before render", () => {
  const initial = createInitialAppState();
  const state: AppState = {
    ...initial,
    actions: {} as AppState["actions"],
    activeTask: {
      agentOutput: [],
      candidates: [],
      goal: "Find parser",
      hints: [],
      kind: "find-files",
      selectedIndex: 0,
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

  expect(restoredAgent).toBeInstanceOf(PiAgentContextItem);
  expect((restoredAgent as PiAgentContextItem).sessionAvailability).toBe(
    "detached",
  );
  expect((restoredAgent as PiAgentContextItem).status).toBe("error");
  expect((restoredAgent as PiAgentContextItem).errorMessage).toContain(
    "Interrupted",
  );
});

test("restore keeps harness-backed agent sessions live when sandbox exists", () => {
  const initial = createInitialAppState();
  const agent = createPiAgentContextItem({
    createdAt: 1,
    id: "agent:10",
    prompt: "research",
  })
    .withHarness({ kind: "cursor", session: { agentId: "agent-resume" } })
    .withSandbox({
      baselineTree: "abc",
      diffStatus: "unknown",
      path: process.cwd(),
      root: process.cwd(),
    })
    .withStatus("idle");
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

  expect(restoredAgent).toBeInstanceOf(PiAgentContextItem);
  expect((restoredAgent as PiAgentContextItem).sessionAvailability).toBe(
    "live",
  );
  expect((restoredAgent as PiAgentContextItem).status).toBe("idle");
  expect((restoredAgent as PiAgentContextItem).harness).toEqual({
    kind: "cursor",
    session: { agentId: "agent-resume" },
  });
});

test("restore marks running harness sessions without assistant text as interrupted", () => {
  const initial = createInitialAppState();
  const agent = createPiAgentContextItem({
    createdAt: 1,
    id: "agent:11",
    prompt: "research",
  })
    .withHarness({ kind: "cursor", session: { agentId: "agent-partial" } })
    .withSandbox({
      baselineTree: "abc",
      diffStatus: "unknown",
      path: process.cwd(),
      root: process.cwd(),
    });
  expect(agent.status).toBe("running");

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
  const restoredAgent = restored.workspace.contextItems[0] as PiAgentContextItem;

  expect(restoredAgent.sessionAvailability).toBe("live");
  expect(restoredAgent.status).toBe("error");
  expect(restoredAgent.errorMessage).toContain("Interrupted before");
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
        candidates: [],
        goal: "find",
        hints: [],
        kind: "find-files",
        selectedIndex: 0,
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
  }).workspace.contextItems[0]! as PiAgentContextItemState;
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
