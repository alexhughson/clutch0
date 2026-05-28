import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import { PiAgentContextItem } from "../../lib/context/contextItems";
import { createAgentAskActions } from "./agentAskWorkflow";

function createHarness() {
  let state: AppState = {
    ...createInitialAppState(),
    actions: {} as AppActions,
  };

  const agentAsk = createAgentAskActions({
    get: () => state,
    set: (partial) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    },
  });

  return {
    agentAsk,
    get state() {
      return state;
    },
  };
}

test("agent ask creates a live context item and opens it", () => {
  const harness = createHarness();

  const itemId = harness.agentAsk.start({ prompt: "Investigate routing" });

  expect(itemId).toBe("agent:1");
  expect(harness.state.activeTask).toEqual({
    applyStatus: "idle",
    itemId: "agent:1",
    kind: "context-item-viewer",
  });
  expect(harness.state.workspace.contextItems[0]).toBeInstanceOf(
    PiAgentContextItem,
  );
});

test("agent ask output updates the same context item", () => {
  const harness = createHarness();
  const itemId = harness.agentAsk.start({ prompt: "Investigate routing" });
  expect(itemId).toBe("agent:1");

  harness.agentAsk.recordOutput({
    itemId: "agent:1",
    update: {
      delta: "hello",
      id: "block:1",
      kind: "append-stream-delta",
      streamKind: "assistant",
      timestamp: 1,
    },
  });
  harness.agentAsk.finish({ itemId: "agent:1" });

  const item = harness.state.workspace.contextItems[0];
  expect(item).toBeInstanceOf(PiAgentContextItem);
  expect((item as PiAgentContextItem).blocks).toHaveLength(1);
  expect((item as PiAgentContextItem).status).toBe("idle");
});
