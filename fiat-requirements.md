# fiat requirements: absorbing clutch's `directLlmClient`

## purpose

clutch carries a 943-line private llm client (`src/lib/llm/directLlmClient.ts`) plus a 258-line legalization shim (`src/lib/llm/requestOptions.ts`). fiat already owns the request/response schema and the translators; this document specifies what fiat must add so clutch's client collapses to a thin adapter. scope is fiat `v0.2`. evidence for every requirement is a line in clutch that exists only because fiat lacks it.

the escape hatch that motivates most of this: `onPayload` in `requestOptions.ts` exists solely to splice openrouter `reasoning` and `service_tier` into the body *after* `toBody()`, because fiat has no ops for them. `maxRetries` in `DirectLlmRequestOptions` is declared but never read — there is no retry logic in the current client.

## current division of labor

| concern | lives in | should live in |
|---|---|---|
| program schema, ops | fiat | fiat |
| body translation (openai chat/responses, gemini) | fiat | fiat |
| stream event → ops (`fromStreamResponse`) | fiat | fiat |
| url construction per api | clutch `requestBodyForModel`, `geminiUrl` | fiat |
| auth headers per provider | clutch `authHeaders` | fiat |
| sse parsing | clutch `parseSseData` (~50 lines) | fiat |
| ops → assistant message fold | clutch `createAssistantAccumulator` (~180 lines) | fiat |
| stop-reason mapping | clutch `stopReasonFromFiat` | fiat |
| usage merge incl. cache tokens | clutch `usageFromFiat`, `applyProviderUsage` | fiat |
| service tier, openrouter reasoning | clutch `requestOptions.ts` via `onPayload` splice | fiat (as ops) |
| model catalog, api keys, oauth, cost tables | clutch (`providerModels`, `clutchConfig`, pi-ai oauth) | clutch (non-goal) |

## R1 — new ops (close the `onPayload` escape hatch)

the escape hatch exists because these have no op representation:

1. **`llm.service_tier`** — value `"priority"` for now. lowered to `service_tier` on openai responses and openrouter chat-completions bodies; error in strict mode on dialects that can't express it (clutch already throws in `serviceTierForRequest` — keep that failure, move it into lint).
2. **`llm.thinking` must lower on every dialect that can express it.** today clutch sends thinking via the op only for openai-responses and gemini (`thinkingEffortForModel` returns `undefined` otherwise) and hand-builds `{reasoning: {effort, exclude: true}}` for openrouter chat-completions in `openRouterPayloadOptionsForRequest`. the openrouter/chat-completions lowering (including the `exclude` flag and gemini-3 / gpt-5 / o-series / grok effort vocabularies) becomes the openai-chat dialect's job, parameterized, not the caller's.
3. **thinking effort `"minimal"`** — clutch maps it to `undefined` because fiat's `ThinkingEffort` lacks it (`asFiatThinkingEffort`). add it; dialects that can't express it drop it under a documented rule, or lint in strict mode.
4. **transport flags** — clutch splices `stream: true` and `store: false` (openai responses) after `toBody`. `stream` should be a `toBody`/client option; `store` an op or dialect option.

**acceptance:** clutch's `onPayload` production usage is deletable; `requestOptions.ts` shrinks to mapping clutch config enums onto ops.

## R2 — response accumulator (ops → message fold)

fiat emits ops from stream events but offers no fold; clutch's `createAssistantAccumulator` is 180 lines of generic logic any consumer would rewrite. fiat provides an accumulator that consumes a sequence of `Program`s and maintains a canonical assistant message:

- text block lifecycle (open on first delta, close on tool call or finish)
- tool calls merged **by index and id** — providers disagree on which arrives first; clutch's dual-map rekeying logic (`ensureToolCall`) is the spec
- partial tool-call json accumulated as string, parsed once at finish; a parse failure at finish is an error, not a silent `{}`
- stop-reason normalization to a fixed vocabulary, including the inference clutch does: `stop` + tool calls present ⇒ `tool_use`
- emits lifecycle events (`text_start/delta/end`, `toolcall_start/delta/end`) so uis can render live — clutch's `AssistantMessageEventStream` vocabulary is the reference; clutch then keeps only an event-renaming adapter
- **non-streaming symmetry:** the same fold accepts `fromResponse` output, so complete and streaming paths share one code path (clutch already does this — keep it)

## R3 — usage and response metadata ops

fiat's `response.usage` carries only input/output tokens. clutch recovers the rest by reading raw provider fields (`applyProviderUsage`, `applyCacheReadTokens`, `applyResponseId` — ~70 lines of `nestedRecord` digging). extend:

- `response.usage` gains `cacheReadTokens`, `cacheWriteTokens` (nullable) — every dialect's `fromResponse`/`fromStreamResponse` populates them from its native fields
- a `response.id` op (or field on `response.stop`)
- the actual model id echoed by the provider (clutch tracks `responseModel` when it differs from the requested id — matters for openrouter rerouting)
- cost stays out of fiat: it's a pricing-table concern, clutch keeps `calculateCost`

## R4 — stream-event tolerance

`fromStreamResponse` throws on benign lifecycle events; clutch maintains an allowlist (`isIgnorableStreamEvent`: `response.created`, `response.in_progress`, `response.content_part.*`, `response.output_text.done`) and swallows the throw. wrong side of the boundary — each dialect must know its own no-op events and return `[]`. unknown events still throw in strict mode. clutch's try/catch/allowlist is deletable.

## R5 — client (transport)

fiat gains an optional client layer over the translators (separate entry point is fine; schema-only consumers unaffected):

- **endpoints:** each dialect owns url construction — `chat/completions`, `responses`, gemini's `models/{id}:{streamGenerateContent|generateContent}?alt=sse&key=` including model-in-url-not-body (clutch's `geminiUrl` + `delete body.model` today)
- **auth:** per-dialect header/query auth given an api key; arbitrary extra headers pass through (clutch merges `model.headers` — needed for openrouter attribution and subscription auth)
- **sse:** dialect-agnostic sse parsing (clutch's `parseSseData`), `[DONE]` handling, abort via `AbortSignal`
- **hooks:** `onPayload` (inspect/replace final body — still wanted for debugging even after R1 removes its production use) and `onResponse` (status + headers — clutch reads rate-limit headers). keep both; they're cheap and they're the pressure valve that prevents the next fork.
- **errors:** non-2xx produces a structured error carrying status, provider, and body excerpt (clutch's `formatErrorResponse` is the floor). no retries in v0.2 — clutch's `maxRetries` is dead code today, so there's no behavior to preserve; adding retry policy untested would violate the no-speculative-features rule. record as future work.

**acceptance:** clutch's `streamDirectLlmResponse` / `completeDirectLlmResponse` become adapters that (a) build a `Program` from `LlmContext`, (b) call fiat's client, (c) rename accumulator events into clutch's stream types. target ≤150 lines total, no `fetch`, no sse, no per-provider branching left in clutch.

## non-goals

- model catalog / capability metadata (`providerModels.ts`, `thinkingLevelMap`) — stays in clutch; fiat receives resolved values
- api-key storage, chatgpt-subscription oauth (pi-ai's oauth module), cerebras max-token caps — clutch config concerns; the cap arrives as an ordinary `llm.max_output_tokens` op
- anthropic-native transport — clutch routes anthropic via openrouter today; `AnthropicTranslator` exists in fiat, but wiring a native client path is new scope, not a port requirement. decide separately.
- retry/backoff policy (see R5)

## migration and proof

1. land R1–R4 in fiat with translator round-trip tests; clutch deletes the escape-hatch usages first — smallest diff, immediately proves the ops are sufficient
2. land R5; port clutch's streaming path behind the existing `streamLlmInteractionForStart` seam (already swappable for tests)
3. **baseline first:** capture request bodies and accumulated messages from the current client for one real session per api (openai responses, openrouter chat, gemini, cerebras); byte-diff bodies and message structures against the fiat-backed path before deleting `directLlmClient.ts`
4. pin fiat by commit hash, not `#v0.1` branch tag, until it has a release process — it currently sits unpinned under the entire llm path

## open questions

- does the acp/agent path (`acpAgentSessionDriver` references serviceTier) issue its own llm calls, and should it route through the same fiat client?
- does pi-ai keep any role beyond oauth + the typebox `Type` re-export once fiat owns transport?
