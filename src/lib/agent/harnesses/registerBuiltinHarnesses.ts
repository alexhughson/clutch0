import { registerAgentHarness, listAgentHarnessIds } from "../harnessRegistry";
import { cursorHarnessDefinition } from "./cursorHarness";
import { piHarnessDefinition } from "./piHarness";

/** Idempotent — safe to call from config load and agent session entrypoints. */
export function registerBuiltinAgentHarnesses(): void {
  if (!listAgentHarnessIds().includes(cursorHarnessDefinition.id)) {
    registerAgentHarness(cursorHarnessDefinition, { default: true });
  }
  if (!listAgentHarnessIds().includes(piHarnessDefinition.id)) {
    registerAgentHarness(piHarnessDefinition);
  }
}
