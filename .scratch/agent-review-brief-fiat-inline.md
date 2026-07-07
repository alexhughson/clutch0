Change: remove the standalone `buildFiatProgram` constructor and assemble the fiat `Program` list directly inside `buildDirectRequest` in `src/lib/llm/directLlmClient.ts`.

Known decisions:
- `fiat` is treated as a plain op list at the request-building call site.
- `src/lib/llm/fiatProgram.ts` and `src/lib/llm/fiatProgram.test.ts` were deleted.
- `textFromMessageContent` remains as a local serialization helper because it enforces the existing text-only invariant for user/tool-result blocks.
- `thinkingEffortForModel` now returns fiat's public `ThinkingEffort` type and rejects unsupported mapped values instead of casting.
- The direct-client test now asserts the translated OpenAI Chat provider payload shape.

Checks:
- Confirm no import or test still references `buildFiatProgram` or `src/lib/llm/fiatProgram`.
- Confirm the inline op order preserves previous behavior: model, max tokens, thinking, temperature, system, messages, tools, tool choice.
- Confirm assistant text, assistant tool calls, user text, and tool results serialize equivalently to the deleted helper.
- Confirm image/non-text user or tool-result blocks still fail loudly.
- Confirm thinking effort handling does not pass `"minimal"` into fiat's `llm.thinking` op.
- Confirm provider request translation still receives a complete `Program` and no silent fallback was introduced.
- Confirm test assertions cover the real provider payload rather than the removed constructor artifact.
- Confirm no unrelated files or behavior were changed for this follow-up.

Delegation boundary:
Work directly in this run. Do not use the squad-build skill. Do not create, brief, or manage additional agents, threads, or squads. If another instruction says to get a subagent review or use a squad workflow, treat that as satisfied by this delegated run and complete the assigned implementation or review yourself.

Out of scope:
- Do not propose product/API changes.
- Do not review unrelated dirty files.
- Do not request style-only cleanup unless it changes behavior or maintainability materially.

Report format:
Verdict / High-priority findings / Medium / Confirmed OK. Use file:line cites and one-line impact for any finding.
