import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialComposeScreen } from "../../app/appInitialState";
import { FileContextItem } from "../../lib/context/contextItems";
import { createAddFilesActions } from "./addFilesWorkflow";

function createHarness(initialState: AppState) {
  let state = initialState;
  const addFiles = createAddFilesActions({
    set: (partial) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    },
  });

  return {
    addFiles,
    get state() {
      return state;
    },
  };
}

test("adds multiple files to context and focuses the last requested file", () => {
  const harness = createHarness({
    actions: {} as AppActions,
    activeTask: null,
    nextContextItemId: 1,
    nextLlmRequestId: 1,
    workspace: createInitialComposeScreen(),
  });

  harness.addFiles.addToContext({ paths: ["src/a.ts", "src/b.ts"] });
  harness.addFiles.addToContext({ paths: ["src/a.ts"] });

  expect(harness.state.workspace.contextItems).toHaveLength(2);
  expect(harness.state.workspace.contextItems[0]).toBeInstanceOf(
    FileContextItem,
  );
  expect(harness.state.workspace.contextItems.map((item) => item.id)).toEqual([
    "file:src/a.ts",
    "file:src/b.ts",
  ]);
  expect(harness.state.workspace.focusedContextItemId).toBe("file:src/a.ts");
});
