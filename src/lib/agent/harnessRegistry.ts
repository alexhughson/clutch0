import type { AgentHarnessDefinition } from "./harnessTypes";

const harnesses = new Map<string, AgentHarnessDefinition>();
let defaultHarnessId: string | null = null;

export function registerAgentHarness(
  definition: AgentHarnessDefinition,
  options: { default?: boolean } = {},
): void {
  if (harnesses.has(definition.id)) {
    throw new Error(`Duplicate agent harness id: ${definition.id}`);
  }
  if (definition.id.trim().length === 0) {
    throw new Error("Agent harness id must be a non-empty string.");
  }
  harnesses.set(definition.id, definition);
  if (options.default === true || defaultHarnessId === null) {
    defaultHarnessId = definition.id;
  }
}

export function getDefaultAgentHarness(): AgentHarnessDefinition {
  if (defaultHarnessId === null) {
    throw new Error("No agent harnesses are registered.");
  }
  return getAgentHarness(defaultHarnessId);
}

export function getAgentHarness(kind: string): AgentHarnessDefinition {
  const definition = harnesses.get(kind);
  if (definition === undefined) {
    throw new Error(
      `Unknown agent harness "${kind}". Registered: ${listAgentHarnessIds().join(", ") || "(none)"}.`,
    );
  }
  return definition;
}

export function listAgentHarnessDefinitions(): readonly AgentHarnessDefinition[] {
  return [...harnesses.values()];
}

export function listAgentHarnessIds(): readonly string[] {
  return [...harnesses.keys()];
}

/** Test helper — clears registry between isolated harness unit tests. */
export function clearAgentHarnessRegistryForTest(): void {
  harnesses.clear();
  defaultHarnessId = null;
}
