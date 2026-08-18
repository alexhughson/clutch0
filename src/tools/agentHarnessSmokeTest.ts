#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { runAgentHarnessSmokeTest } from "../lib/agent/agentHarnessSmokeTest";
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

Requires CURSOR_API_KEY when using the cursor harness.
`);
  process.exit(0);
}

const configured = resolveConfiguredAgentHarness();
const kind = values.kind ?? configured.kind;

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
