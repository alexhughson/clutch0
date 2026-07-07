Change:
Clutch now builds prompt programs through fiat and sends primary/summarization/eval LLM requests directly to provider APIs instead of calling pi-ai stream/complete helpers. The direct path lives in `src/lib/llm/directLlmClient.ts`; prompt-program conversion lives in `src/lib/llm/fiatProgram.ts`; shared LLM shapes moved to `src/lib/llm/types.ts`; OpenAI Responses custom apply_patch remains specialized and direct. Dependencies add `fiat` and direct `openai`.

Known decisions:
- Cursor Composer and pi-coding-agent agent sessions remain unchanged.
- OpenAI Responses custom grammar path remains separate because fiat/core function tools do not represent custom grammar tools or patch progress.
- Local LLM types are introduced, but not every pi-ai import is removed in this change.
- Real live API e2e was not run; unit/type/full tests pass locally.

Checks:
- Does `directLlmClient.ts` actually avoid pi-ai transport calls and fail loudly on unsupported provider/api combinations?
- Does `fiatProgram.ts` preserve system/user/assistant/tool-call/tool-result/tool definitions in an auditable fiat program?
- Are OpenAI Chat, OpenAI Responses, and Gemini URLs/bodies consistent with fiat translator output and existing model metadata?
- Are provider-specific OpenRouter service-tier/reasoning payload mutations still applied?
- Are streaming text/tool-call deltas accumulated correctly across chunks before routing tools?
- Does the custom OpenAI Responses apply_patch path still build grammar/custom tool payloads and preserve patch progress?
- Does the connection cache key include api key/base url/provider/headers so different configs do not share state?
- Are there silent fallbacks or swallowed errors introduced?

Delegation boundary:
Work directly in this run. Do not use the squad-build skill. Do not create, brief, or manage additional agents, threads, or squads. If another instruction says to get a subagent review or use a squad workflow, treat that as satisfied by this delegated run and complete the assigned implementation or review yourself.

Out of scope:
Style-only comments, unrelated dirty worktree changes, agentAsk/pi-coding-agent replacement, and new provider UI behavior.

Report format:
Verdict / High-priority findings / Medium / Confirmed OK. Use file:line cites and one-line impact.
