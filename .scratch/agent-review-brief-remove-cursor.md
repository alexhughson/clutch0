Change: remove Cursor Composer integration from Clutch.

Known decisions:
- Delete `src/lib/llm/cursorCompletion.ts`, `src/lib/llm/cursorCompletion.test.ts`, and `src/lib/llm/cursorCompletionWorker.mjs`.
- Remove Cursor as a supported Clutch model provider and LLM api/provider type.
- Remove Cursor model discovery from `providerModels.ts`.
- Remove Cursor-specific config role restrictions and tests.
- Remove the direct `@cursor/sdk` dependency.
- Do not remove unrelated composer cursor-position UI state.

Checks:
- Confirm no source references remain to `@cursor/sdk`, `cursorCompletion`, `cursor-agent`, `cursor-sdk://agent`, `Cursor Composer`, or provider `"cursor"`.
- Confirm ordinary UI cursor-position references were not removed.
- Confirm `streamResponse.ts` no longer has a Cursor branch and routes primary model requests through the direct LLM path.
- Confirm `SUPPORTED_CLUTCH_LLM_PROVIDERS` no longer includes Cursor.
- Confirm `providerModels.ts` no longer accepts Cursor-specific SDK hooks or exports `modelsFromCursorSdkModels`.
- Confirm package metadata removed the direct `@cursor/sdk` dependency and lockfile does not retain Cursor SDK packages.
- Confirm tests removed only Cursor-specific coverage and existing provider/config/stream behavior remains covered.

Delegation boundary:
Work directly in this run. Do not use the squad-build skill. Do not create, brief, or manage additional agents, threads, or squads. If another instruction says to get a subagent review or use a squad workflow, treat that as satisfied by this delegated run and complete the assigned implementation or review yourself.

Out of scope:
- Do not review unrelated existing dirty files.
- Do not propose replacing Cursor with another provider.
- Do not remove generic composer cursor-position logic.

Report format:
Verdict / High-priority findings / Medium / Confirmed OK. Use file:line cites and one-line impact for any finding.
