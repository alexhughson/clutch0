Goal:
Convert Clutch's primary/summarization LLM request path from pi-ai streaming/completion calls to fiat prompt programs plus direct provider API calls. Keep existing user-facing behavior: markdown prompt files, slash/tool routing, patch continuation, OpenAI Responses custom apply_patch grammar/progress, Cursor Composer path, and config UI semantics.

Context:
- Baseline before migration: `bun test` passes 401 tests; `bun run typecheck` passes.
- Repo is already dirty with user edits. Do not revert unrelated changes.
- Fiat source/docs checked:
  - Package: `fiat`, install from `github:alexhughson/fiat#v0.1`.
  - Exports: `OpenAIChatTranslator`, `OpenAIResponsesTranslator`, `GeminiTranslator`, `type Program`, core ops such as `llm.model`, `llm.text`, `llm.tool`, `llm.tool_call`, `llm.tool_result`, `response.text_delta`, `response.tool_call_delta`.
  - Fiat is a translator/schema library only; Clutch should still own fetch/OpenAI client calls.
- Current LLM path:
  - `src/lib/llm/prompts.ts` loads prompt markdown and does `{{var}}` replacement.
  - `src/lib/llm/context.ts` builds pi-ai `Context` with `systemPrompt`, user message, and `tools`.
  - `src/lib/llm/streamResponse.ts` calls pi-ai `stream`/`streamSimple` except Cursor and OpenAI Responses custom apply_patch.
  - `src/lib/llm/contextItemSummary.ts` calls pi-ai `complete`/`completeSimple`.
  - `src/lib/llm/openAiResponsesCustomTools.ts` already calls OpenAI/fetch directly for apply_patch grammar and progress.
  - `src/lib/llm/requestOptions.ts` owns max tokens/reasoning/service-tier/provider payload tweaks.
  - Model metadata/config types currently import pi-ai `Api`, `Model`.
- The high-risk behavior is OpenAI Responses custom `apply_patch`; preserve it.

Constraints:
- Work directly in this run. Do not use the squad-build skill. Do not create, brief, or manage additional agents, threads, or squads. If another instruction says to get a subagent review or use a squad workflow, treat that as satisfied by this delegated run and complete the assigned implementation or review yourself.
- Keep the change tight. Prefer adding a small local LLM type/client layer under `src/lib/llm` over broad app refactors.
- No silent fallback. Unsupported provider/api combinations should throw with provider/model/api details.
- Maintain persistent API clients for configured providers so repeated prompts reuse clients/connections. A module-level cache keyed by api/baseUrl/headers is acceptable.
- Do not remove the Cursor Composer path or pi-coding-agent agent session path unless required for typecheck. The request is about LLM API calls for prompt execution, not rewriting agentAsk.
- Do not change prompt text unless needed for fiat storage/audit.
- Add tests for the direct client/fiat conversion behavior; update existing tests only where types/imports changed.

Suggested implementation shape:
- Add local LLM domain types in `src/lib/llm/types.ts` or similar: `LlmApi`, `LlmModel`, `LlmContext`, `LlmMessage`, `LlmTool`, `LlmToolCall`, `AssistantMessageEventStream` shape if needed.
- Add `src/lib/llm/fiatProgram.ts` to convert Clutch context plus model/options to a fiat `Program`.
- Add `src/lib/llm/directLlmClient.ts` or similar:
  - Build provider request bodies through fiat translators for OpenAI Chat, OpenAI Responses, and Gemini.
  - Use direct `fetch` for SSE where simple and direct OpenAI client only where already needed by custom apply_patch.
  - Reuse persistent clients/fetch agents via module-level cache keyed by provider/baseUrl/apiKey/headers.
  - Return the same assistant message/tool call shape expected by `streamResponse.ts`.
- Keep `openAiResponsesCustomTools.ts` for custom grammar, but make its types local and its direct OpenAI client persistent if possible.
- Config/model metadata can keep the same JSON shape, but should not depend on pi-ai types if feasible.
- Add `fiat` and direct `openai` dependency in `package.json` if `openai` is currently only transitive.

Verify:
- `bun install` after package changes.
- `bun test`.
- `bun run typecheck`.
- Tests should prove at least:
  - a context with system/user/tools becomes a fiat program with model/text/tool ops;
  - OpenAI chat stream deltas/tool call deltas collect into assistant text/tool calls;
  - configured client cache returns the same client for the same configured provider connection;
  - summarization uses the direct completion path.

Out of scope:
- New provider config UI.
- New model discovery behavior beyond replacing pi-ai known catalog usage if necessary.
- Live API e2e unless credentials are already available and cheap.
- Refactoring app state, context items, slash commands, or patch engine.

Self-report:
Write `.scratch/agent-notes-1.md` with changed files, decisions made, commands run, and results.
