# clutch rebuild plan

what we'd do differently if we rebuilt it. companion to `fiat-requirements.md`, which specs item 3 in full.

## the one-sentence thesis

the app's state shapes are each defined three times (typescript type, hand-written serializer, hand-written parser), and its llm layer is a private reimplementation of libraries it already depends on — a rebuild that makes **schemas the single source of truth** and **commits to (or extracts) its libraries** deletes roughly a quarter of the codebase.

these findings were verified against the code by an independent review pass; corrections from that review are folded in below.

---

## 1. schemas as the single source of truth (biggest win)

### the problem

every persistent shape is written by hand three times — the typescript type, the serializer, and a parser full of `assertString`/`assertRecord`/`assertOneOf` calls:

- `src/lib/context/contextItems.ts:1654-2147` — ~500 lines: a `static restore` per class, `parseContextItemStateBase`, and one copy of the assert-helper trio (lines 1940-1990)
- `src/lib/session/sessionSnapshot.ts` — 1077 lines: 19 `parse*` functions mirroring the `AppTask` union, plus a **second, independent copy** of the assert helpers (lines 1000-1075)
- `src/lib/config/clutchConfig.ts:466-930` — a third parsing layer with its own assert variants; roughly half the file

three hand-rolled validation systems, one copy-pasted helper trio in each. meanwhile typebox (`Type` from `@earendil-works/pi-ai`) is already imported in 8+ tool files for llm tool schemas — the schema library is in the dependency tree, it's just never pointed at persistence.

### why it's safe

verified: context item state is plain data. strings, numbers, status enums. even `LiveLlmResponseContextItemState` holds no stream handle — live output is a plain string updated via actions. the only non-serializable member of `AppState` is `actions`, which is already excluded from snapshots.

### the honest caveat

`normalizeRestoredState` does ~150 lines of _semantic_ migration that no schema can absorb: converting interrupted `running`/`applying`/`searching` statuses to error states on restore, rebuilding id counters from restored items, checking `schemaVersion`. that layer survives. the target is deleting the ~1,400 lines of mechanical parse/serialize, not the migration logic.

### the rule

a persistent shape is defined once, as a typebox schema. the typescript type derives via `Static<typeof Schema>`. the parser is `Value.Decode` (or equivalent) — fails loudly, which matches the no-silent-fallback doctrine. the serializer is the identity on plain data. adding a field means editing one schema, not three files.

---

## 2. context items: records + definition table (finish what b1ded97 started)

### the problem

the `ContextItem` interface (15 methods, `src/types.ts`) is the best idea in the codebase — items own their llm formatting, views, actions, so ui never switches on type. but the 8 class implementations in `contextItems.ts` (2147 lines) are ~50% identical ceremony per class: state getters, `withSummaryState` clone, `getPersistence` wrapper, `getHistoryEvents` doing `instanceof` checks plus field-by-field `fieldChanged` diffing, `static restore`. the other ~50% is genuine per-type behavior (`formatForLlm`, `getDetailView`, `getSummarizationInput`).

the interface also conflates five concerns in one object: data, llm formatting, ui views, persistence, history.

### what's already been tried

`codex/clutch-rebuild` commit b1ded97 ("replace context item classes with records") replaces the classes with records plus a `ContextItemDefinition<Type>` interface, one module per type under `contextItemDefinitions/`. review verdict: it kills the class ceremony and the `instanceof` checks — but it's **net +347 lines** (3364 insertions / 3017 deletions), because it moves the hand-rolled parsing into a new 510-line `contextItemPersistenceV1.ts`. it solves the structure problem without the validation problem.

### the fix

items 1 and 2 are one fix, done together:

- each item type is a plain record whose state type derives from a typebox schema (item 1 kills `contextItemPersistenceV1.ts` before it's born)
- per-type behavior lives in a definition table: `{ formatForLlm, getDetailView, getActions, getSummarizationInput }` keyed by type
- the generic machinery — summary state, persistence, history events — is written once. history events in particular: `getHistoryEvents` is field-diffing in every class; a generic differ over the schema fields plus a per-type event-name map replaces all eight implementations.

### doctrine conflict to resolve

`AGENTS.md:24` says "context items are the main OO abstraction… ui code should ask the item instead of switching on item types," while b1ded97 replaces exactly that with type-keyed definition records. pick the records: "ask the item" survives intact when the definition table is the thing being asked — the ui still never switches on type, it calls `definitionFor(item).getDetailView(item)`. update AGENTS.md in the same change.

---

## 3. the llm client belongs in fiat, not the app

`src/lib/llm/directLlmClient.ts` (943 lines) is the only llm client — everything routes through it. what it actually is: fiat translators for request bodies, pi-ai used **only for types** (`Tool`, `ToolCall`, `Type`) plus its oauth module, and hand-rolled everything else — sse parsing, url construction, usage/latency accounting, auth headers, service-tier gating. `requestOptions.ts` (258 lines) exists almost entirely to smuggle openrouter `reasoning` and `service_tier` past fiat's schema via the `onPayload` escape hatch. `maxRetries` is declared and never read — dead code.

the app embeds the missing half of a provider library, split across two repos, with fiat pinned to a mutable `github:…#v0.1` ref under the entire llm path.

full requirements for closing this: **`fiat-requirements.md`**. summary: new ops (service tier, thinking on all dialects, transport flags), a response accumulator, usage/metadata ops, stream-event tolerance, and an optional transport layer. clutch's client collapses to a ≤150-line adapter.

---

## 4. bounded continuation as a first-class turn concept

### the problem

the "you are the agent" model — one classified tool call per turn — was too rigid for multi-step editing, so agents grew back twice, independently:

1. `src/lib/llm/streamResponse.ts:281,436` — `continuePatchToolCalls` / `continueApplyPatchToolCalls`: real bounded agent loops (`MAX_PATCH_TOOL_CONTINUATIONS = 8`, `MAX_INVALID_PATCH_TOOL_RETRIES = 3`) that feed tool results back and re-invoke the model, because a patch that fails validation needs the model to retry
2. `src/workflows/agentAsk/` + `src/lib/agent/` (~2,200 lines) — a full second agent runtime: acp sdk, session driver, git-worktree sandboxes (`agentSandbox.ts`), its own diff application via `git apply`

each bolt-on carries its own loop, caps, error routing, and state.

### the fix

make the turn model honest: a turn has a **step budget**, default 1. the manual-transmission feel is the default budget, not the architecture. patch-apply is a turn with budget 8. agent-edit is a turn with a large budget and a worktree. one loop, one cap mechanism, one error path, and the philosophy survives as a configuration value instead of being contradicted by two hidden exceptions.

### what NOT to unify

the custom patch engine (`src/lib/patch/patchEngine.ts`, 1510 lines) stays. review verdict: unifying on git diffs is not feasible on the input side — models emit the openai apply_patch V4A format because they're rl-trained on it, and V4A's context-matching-without-line-numbers is the whole point. patchEngine is the one big file that earns its size. the only realistic (and low-value) unification is routing its _apply_ step through `git apply`, but patchEngine has already computed `nextContent` by then — skip it.

---

## 5. config becomes a workflow like everything else

`src/workflows/config/ConfigScreen.tsx` is 1917 lines with **21** `useState` hooks and per-stage key handlers dispatched inside one `useKeyboard` callback (line 208: `if (stage === "providers") handleProvidersKey({…15 setters passed down})`). it's a hand-rolled wizard state machine living entirely in component state — a direct violation of the repo's own rule (`AGENTS.md:70`: "keep ui thin. put state transitions in workflow action modules").

it's this shape because there's no form/wizard primitive, so every stage reinvents list-navigation and key handling. the fix is two small things:

- config stages become a workflow state machine (an `AppTask` with a `stage` field, transitions in a `configWorkflow.ts` action module) like every other flow in the app
- one generic "menu step" component (list + cursor + filter + select/back keys) that all stages render through — the per-stage `handle*Key` functions are ~80% the same keystroke plumbing

---

## 6. smaller items

- **task-kind touchpoints.** adding an `AppTask` kind touches 4 files / ~7 sites: the union in `appTypes.ts`, the render switch in `taskRegistry.tsx:13`, the presentation switch in `taskPresentation.ts:13`, and serialize/parse/normalize in `sessionSnapshot.ts`. AGENTS.md blesses this as convention, but it's convention compensating for a missing per-kind descriptor. schema-derived persistence (item 1) removes the worst three sites; a descriptor object (render + title + schema in one place) removes the rest.
- **identity-comparison dispatch.** `toolRegistry.ts:292-298` routes slash runners via `controller === addFilesWorkflowTool` — three identity comparisons patching over the fact that the controller abstraction doesn't carry its own slash behavior. make it a field on the controller.
- **three state systems.** the zustand store; the session recorder fed by recursive action-wrapping plus subscription diffing (`appStore.ts:106-171` — summary regeneration is also an implicit subscription side effect); and `agentAskSessionRegistry.ts` (517 lines of module-level mutable session state outside the store entirely). rebuild: actions emit explicit events; the recorder and summary regeneration subscribe to events, not inferred state diffs; agent sessions live in the store like everything else.
- **assert-helper trio.** three independent copies (contextItems, sessionSnapshot, clutchConfig variants). dissolved by item 1, but worth naming: it's the visible symptom of the missing schema layer.

---

## priority order

1. **schemas as source of truth** — deletes the most code, unblocks item 2
2. **context items as records + definition table** — finish b1ded97's direction, schema-backed so it goes net-negative instead of +347
3. **llm client into fiat** — per `fiat-requirements.md`; independent of 1–2, can proceed in parallel
4. **step budget on turns** — absorbs both agent bolt-ons; do after 3 so the loop sits on the fiat client
5. **config as a workflow + wizard primitive** — self-contained, any time

each step follows the standing doctrine: baseline first (capture current behavior on a real session), change, diff. items 1–2 in particular should prove themselves by byte-diffing a restored session snapshot before and after.
