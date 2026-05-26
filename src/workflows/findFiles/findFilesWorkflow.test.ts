import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import { createFindFilesActions } from "./findFilesWorkflow";

function createHarness() {
  let state: AppState = {
    ...createInitialAppState(),
    actions: {} as AppActions,
  };

  const findFiles = createFindFilesActions({
    set: (partial) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    },
  });

  return {
    findFiles,
    get state() {
      return state;
    },
  };
}

test("adding a selected candidate keeps the find files task open", () => {
  const harness = createHarness();

  harness.findFiles.showSearch({ goal: "Find app files", hints: [] });
  harness.findFiles.finish({
    candidates: [
      { path: "src/App.tsx", reason: "App routing" },
      { path: "src/index.tsx", reason: "Entry point" },
    ],
  });
  harness.findFiles.addSelectedCandidate();

  expect(harness.state.activeTask?.kind).toBe("find-files");
  expect(harness.state.workspace.contextItems).toHaveLength(1);
  expect(harness.state.workspace.contextItems[0]?.id).toBe("file:src/App.tsx");
});

test("adding all candidates keeps the find files task open and avoids duplicates", () => {
  const harness = createHarness();

  harness.findFiles.showSearch({ goal: "Find app files", hints: [] });
  harness.findFiles.finish({
    candidates: [
      { path: "src/App.tsx", reason: "App routing" },
      { path: "src/index.tsx", reason: "Entry point" },
    ],
  });
  harness.findFiles.addSelectedCandidate();
  harness.findFiles.addAllCandidates();

  expect(harness.state.activeTask?.kind).toBe("find-files");
  expect(harness.state.workspace.contextItems.map((item) => item.id)).toEqual([
    "file:src/App.tsx",
    "file:src/index.tsx",
  ]);
});

test("find files search activity is capped", () => {
  const harness = createHarness();

  harness.findFiles.showSearch({ goal: "Find app files", hints: [] });
  for (let index = 0; index < 205; index += 1) {
    harness.findFiles.recordAgentOutput({
      update: {
        block: {
          id: `status:${index}`,
          kind: "status",
          message: `line ${index}`,
          timestamp: index,
        },
        kind: "append-block",
      },
    });
  }

  expect(harness.state.activeTask?.kind).toBe("find-files");
  if (harness.state.activeTask?.kind !== "find-files") {
    return;
  }

  expect(harness.state.activeTask.agentOutput).toHaveLength(200);
  expect(harness.state.activeTask.agentOutput[0]).toMatchObject({
    message: "line 5",
  });
});
