import { afterEach, expect, test } from "bun:test";
import {
  clearAgentHarnessRegistryForTest,
  getAgentHarness,
  getDefaultAgentHarness,
  listAgentHarnessIds,
  registerAgentHarness,
} from "./harnessRegistry";
import { registerBuiltinAgentHarnesses } from "./harnesses/registerBuiltinHarnesses";
import type { AgentHarnessDefinition } from "./harnessTypes";

afterEach(() => {
  clearAgentHarnessRegistryForTest();
});

test("builtin harnesses register distinct cursor and pi modules", () => {
  registerBuiltinAgentHarnesses();
  expect(listAgentHarnessIds()).toEqual(["cursor", "pi"]);
  expect(getAgentHarness("cursor").label).toContain("Cursor");
  expect(getAgentHarness("pi").label).toBe("Pi");
  expect(getAgentHarness("cursor").parseConfig({})).toEqual(
    expect.objectContaining({ command: "cursor-agent" }),
  );
  expect(getAgentHarness("pi").parseConfig({})).toEqual(
    expect.objectContaining({ command: "pi" }),
  );
  expect(getDefaultAgentHarness().id).toBe("cursor");
});

test("unknown harness kind fails loud", () => {
  registerBuiltinAgentHarnesses();
  expect(() => getAgentHarness("codex")).toThrow(/Unknown agent harness/);
});

test("duplicate harness registration fails loud", () => {
  registerBuiltinAgentHarnesses();
  const fake: AgentHarnessDefinition = {
    ...getAgentHarness("cursor"),
    id: "cursor",
  };
  expect(() => registerAgentHarness(fake)).toThrow(/Duplicate/);
});
