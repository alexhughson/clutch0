Change: remove the custom OpenAI Responses tool path. `apply_patch` now goes through the generic direct fiat path as a normal function tool until a fiat extension supports custom/freeform grammar tools.

Known decisions:
- `src/lib/llm/openAiResponsesCustomTools.ts` and its test file were deleted.
- `streamResponse.ts` no longer branches to a custom Responses streamer when `apply_patch` is present.
- `directLlmClient.ts` no longer branches to the deleted custom path for `openai-codex-responses`; unsupported API profiles fail through the existing unsupported-provider error.
- `package.json` no longer has a direct `openai` dependency. The lockfile still contains `openai` transitively through `pi-ai`.
- `onPatchProgress` remains in the public stream options because UI/runtime plumbing still passes it, but generic Responses no longer emits patch-progress deltas until the fiat extension exists.

Checks:
- Confirm no code imports or references `openAiResponsesCustomTools`.
- Confirm `streamResponse.ts` always uses `streamDirectLlmResponse` for non-Cursor LLM requests.
- Confirm `directLlmClient.ts` has no `openai-codex-responses` special branch and fails loudly for unsupported APIs.
- Confirm `apply_patch` remains available as a normal workflow tool through existing tool registry and fiat translation.
- Confirm dependency metadata removed only the direct `openai` dependency, not transitive `pi-ai` requirements.
- Confirm there is no silent fallback or swallowed unsupported-provider path.
- Confirm tests cover the unsupported `openai-codex-responses` behavior.

Delegation boundary:
Work directly in this run. Do not use the squad-build skill. Do not create, brief, or manage additional agents, threads, or squads. If another instruction says to get a subagent review or use a squad workflow, treat that as satisfied by this delegated run and complete the assigned implementation or review yourself.

Out of scope:
- Do not ask to reintroduce custom grammar tools.
- Do not propose a fiat extension design.
- Do not review unrelated dirty files outside this change.

Report format:
Verdict / High-priority findings / Medium / Confirmed OK. Use file:line cites and one-line impact for any finding.
