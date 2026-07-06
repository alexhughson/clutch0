import { expect, test } from "bun:test";
import { createInitialAppState } from "../app/appInitialState";
import type { AppState } from "../app/appTypes";
import type { SessionRecorder } from "../lib/session/sessionRecorder";
import { createAppStore } from "./appStore";

test("store factory wires recorder runtime per store", () => {
  const mutations: Array<{ actionName?: string; state: AppState }> = [];
  const recorder: SessionRecorder = {
    close: async () => {},
    flush: async () => {},
    recordRuntimeEvent: () => {},
    recordStateChange: ({ actionName, state }) => {
      mutations.push({ actionName, state });
    },
  };
  const store = createAppStore(createInitialAppState(), {
    getSessionRecorder: () => recorder,
  });

  store.getState().actions.compose.setComposerState({
    cursorPosition: 5,
    message: "hello",
  });

  expect(mutations[0]?.actionName).toBe("compose.setComposerState");
  expect(mutations[0]?.state.workspace.composer.message).toBe("hello");
});
