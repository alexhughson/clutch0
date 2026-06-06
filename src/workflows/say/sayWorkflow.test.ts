import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialComposeScreen } from "../../app/appInitialState";
import { UserTextContextItem } from "../../lib/context/contextItems";
import { createSayActions } from "./sayWorkflow";

function createHarness(initialState: AppState) {
  let state = initialState;
  const say = createSayActions({
    set: (partial) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    },
  });

  return {
    say,
    get state() {
      return state;
    },
  };
}

test("say adds editable user text to context and opens it", () => {
  const harness = createHarness({
    actions: {} as AppActions,
    activeTask: null,
    nextContextItemId: 1,
    nextLlmRequestId: 1,
    workspace: {
      ...createInitialComposeScreen(),
      composer: {
        cursorPosition: 10,
        message: "/say remember this",
      },
    },
  });

  harness.say.addToContext({ text: "remember this" });

  const [item] = harness.state.workspace.contextItems;
  expect(item).toBeInstanceOf(UserTextContextItem);
  expect(item?.id).toBe("say:1");
  expect((item as UserTextContextItem).text).toBe("remember this");
  expect(harness.state.workspace.focusedContextItemId).toBe("say:1");
  expect(harness.state.activeTask).toEqual({
    applyStatus: "idle",
    itemId: "say:1",
    kind: "context-item-viewer",
  });
  expect(harness.state.nextContextItemId).toBe(2);
  expect(harness.state.workspace.composer).toEqual({
    cursorPosition: 0,
    message: "",
  });
});

test("say updates editable user text context items", () => {
  const harness = createHarness({
    actions: {} as AppActions,
    activeTask: null,
    nextContextItemId: 1,
    nextLlmRequestId: 1,
    workspace: createInitialComposeScreen(),
  });

  harness.say.addToContext({ text: "before" });
  harness.say.updateText({ itemId: "say:1", text: "after" });

  const [item] = harness.state.workspace.contextItems;
  expect(item).toBeInstanceOf(UserTextContextItem);
  expect((item as UserTextContextItem).text).toBe("after");
});

test("say update fails for non-user-text context items", () => {
  const harness = createHarness({
    actions: {} as AppActions,
    activeTask: null,
    nextContextItemId: 1,
    nextLlmRequestId: 1,
    workspace: createInitialComposeScreen(),
  });

  expect(() =>
    harness.say.updateText({ itemId: "missing", text: "after" }),
  ).toThrow("Expected editable user text context item: missing");
});
