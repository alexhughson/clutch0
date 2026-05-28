import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import { createShowContextActions } from "./showContextWorkflow";

function createHarness() {
  let state: AppState = {
    ...createInitialAppState(),
    actions: {} as AppActions,
  };
  const showContext = createShowContextActions({
    get: () => state,
    set: (partial) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    },
  });

  return {
    get state() {
      return state;
    },
    showContext,
  };
}

test("show context starts and finishes a context preview task", () => {
  const harness = createHarness();

  const requestId = harness.showContext.start({ question: "debug context" });
  expect(requestId).toBe(1);
  expect(harness.state.activeTask).toMatchObject({
    id: 1,
    kind: "show-context",
    question: "debug context",
    status: "loading",
  });

  harness.showContext.finish({ content: "rendered context", requestId: 1 });
  expect(harness.state.activeTask).toMatchObject({
    content: "rendered context",
    kind: "show-context",
    status: "done",
  });
});
