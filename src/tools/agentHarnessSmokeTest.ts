#!/usr/bin/env bun
import { parseArgs } from "node:util";
import {
  assertCommandAvailable,
  runAgentHarnessSmokeTest,
} from "../lib/agent/agentHarnessSmokeTest";
import { getAgentHarness } from "../lib/agent/harnessRegistry";
import { registerBuiltinAgentHarnesses } from "../lib/agent/harnesses/registerBuiltinHarnesses";
import { resolveConfiguredAgentHarness } from "../lib/config/clutchConfig";

const { values } = parseArgs({
  options: {
    help: { type: "boolean", short: "h", default: false },
    kind: { type: "string" },
    prompt: { type: "string" },
    "timeout-ms": { type: "string", default: "120000" },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log(`Usage: bun run src/tools/agentHarnessSmokeTest.ts [options]

Options:
  --kind <id>         Harness id (default: configured / cursor)
  --prompt <text>     Prompt to send
  --timeout-ms <ms>   Timeout (default 120000)
`);
  process.exit(0);
}

registerBuiltinAgentHarnesses();
const configured = resolveConfiguredAgentHarness();
const kind = values.kind ?? configured.kind;
const definition = getAgentHarness(kind);
const config = definition.parseConfig(
  kind === configured.kind ? configured.config : definition.defaultConfig,
) as { command?: string };

if (typeof config.command === "string") {
  await assertCommandAvailable(config.command);
}

const result = await runAgentHarnessSmokeTest({
  harnessKind: kind,
  prompt: values.prompt,
  timeoutMs: Number(values["timeout-ms"]),
});

console.log(
  JSON.stringify(
    {
      ok: true,
      harnessKind: result.harnessKind,
      session: result.session,
      assistantText: result.assistantText.slice(0, 500),
    },
    null,
    2,
  ),
);
console.log("Agent harness smoke test passed.");
