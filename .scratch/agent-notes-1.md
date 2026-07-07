Changed files:
- `package.json`, `bun.lock`: added `fiat` from `github:alexhughson/fiat#v0.1`, direct `openai`, and trusted `fiat` so Bun can use the git package cleanly.
- `src/lib/llm/types.ts`: added local structural LLM model/context/message/tool/event-stream types.
- `src/lib/llm/fiatProgram.ts`: converts Clutch LLM context into fiat core prompt ops.
- `src/lib/llm/directLlmClient.ts`: added direct fetch-based OpenAI chat, OpenAI Responses, Gemini streaming/completion client using fiat translators; added provider connection cache; delegates OpenAI Codex Responses to the existing direct Codex SSE path.
- `src/lib/llm/streamResponse.ts`: replaced pi-ai `stream`/`streamSimple` calls with the direct client; preserved Cursor Composer and custom OpenAI Responses apply_patch routing.
- `src/lib/llm/contextItemSummary.ts`: replaced pi-ai `complete`/`completeSimple` with direct non-stream completion.
- `src/lib/llm/requestOptions.ts`: made request options local structural types while preserving max-token, reasoning, service-tier, and OpenRouter payload behavior.
- `src/lib/llm/openAiResponsesCustomTools.ts`: moved custom apply_patch path onto local types and cached the direct OpenAI client by provider/base URL/API key/headers.
- `src/lib/llm/cursorCompletion.ts`: moved Cursor completion adapter onto local structural LLM types.
- `src/lib/llm/fiatProgram.test.ts`, `src/lib/llm/directLlmClient.test.ts`: added migration coverage for fiat program conversion, streamed chat deltas/tool-call deltas, connection cache reuse, direct completion, and summarization using direct completion.
- `src/lib/llm/openAiResponsesCustomTools.test.ts`: updated fixtures to use local event/message/model types.

Decisions:
- Kept model discovery, OAuth, pi-coding-agent, and agent session behavior on existing code paths. This migration only changes primary/summarization prompt execution.
- Kept `@earendil-works/pi-ai` in the repo because other owned paths still use its catalog/OAuth/Typebox utilities and pi agent session code.
- Did not put fiat `request.stream` in the common program because OpenAI Responses and Gemini translators do not serialize that op. The direct client sets each endpoint's stream flag after lowering.
- OpenRouter chat reasoning and priority still flow through the existing `onPayload` hook instead of adding generic fiat thinking ops to chat-completions payloads.
- OpenAI Codex Responses still uses the existing direct Codex SSE/custom-tool code path, now also for no-tool prompts so `/ask` with a Codex model does not become unsupported.
- I left unrelated dirty-worktree edits alone. `src/lib/llm/context.ts` already had concurrent automatic-context changes; this run only changed its LLM type imports/options.

Commands run:
- `bun add github:alexhughson/fiat#v0.1 openai` (first sandbox attempt failed on tempdir permissions; reran with approval and succeeded).
- Baseline after dependency install, before source migration: `bun test` passed 401/401; `bun run typecheck` passed.
- Focused verification during migration:
  - `bun test src/lib/llm/fiatProgram.test.ts src/lib/llm/directLlmClient.test.ts src/lib/llm/openAiResponsesCustomTools.test.ts src/lib/llm/streamResponse.test.ts src/lib/llm/requestOptions.test.ts` passed 39/39.
  - `bun test src/lib/llm/cursorCompletion.test.ts src/lib/llm/directLlmClient.test.ts src/lib/llm/streamResponse.test.ts` passed 19/19.
  - `bun test src/lib/llm/directLlmClient.test.ts src/lib/llm/openAiResponsesCustomTools.test.ts src/lib/llm/cursorCompletion.test.ts src/lib/llm/streamResponse.test.ts` passed 31/31.
- Final verification:
  - `bun run typecheck` passed.
  - `bun test` passed 406/406.
