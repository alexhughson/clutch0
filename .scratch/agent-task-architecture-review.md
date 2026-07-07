Objective: read-only adversarial review of the architecture plan below for /Users/alex/Code/clutch. Do not edit files.

Focus:
- identify critical blockers, over-abstractions, and simpler paths
- verify against cited files where needed
- be harsh on unnecessary registries/dispatchers and missed smaller changes

Must not touch:
- any source files
- package files
- tests

Write findings to .scratch/agent-notes-architecture-review.md. Include only actionable review notes, grouped as Critical blockers and Nitpicks. Mention any commands run.

Context/evidence:
- ContextItem interface owns formatForLlm/getActions/getDetailView/getSummary/etc: src/types.ts:36-59.
- ContextItemDetailView union is in src/types.ts:102-141.
- ContextItemViewerScreen imports PiAgentContextItem/UserTextContextItem and bypasses getDetailView for live/editable details: src/workflows/contextItems/ContextItemViewerScreen.tsx:11-43 and skips getDetailView for those classes at lines 65-80.
- Detail renderer is private inside ContextItemViewerScreen: lines 166-207, with editable and agent subviews later in same file.
- AppTask union is src/app/appTypes.ts:20-27. Rendering switch is src/app/taskRegistry.tsx:12-31. Pane/context-keyboard policy is src/app/taskPresentation.ts:3-8. ctrl-c has separate task policy in src/app/ctrlCShortcut.ts.
- Command declarations are in src/workflows/llmTools/toolRegistry.ts:33-86 and getLlmSlashCommands at 124-145. LlmSlashCommand has taskKind in src/workflows/llmTools/types.ts:41-56. Composer builds SubmissionIntent in src/components/MessageComposer/messageSubmission.ts:8-44 and switches on taskKind at 58-99. Composer runs intent via a second switch in src/components/MessageComposer/messageComposerActions.ts:389-448.
- Context item actions are item-provided, but run through a broad ContextItemActionContext in src/types.ts:158-180 and src/workflows/contextItems/contextItemActionRunner.ts:11-48.
- Diff apply action is only created by diff items, but contextItemEffects.ts silently returns for non-diff item ids: src/workflows/contextItems/contextItemEffects.ts:10-19.
- File display grouping re-identifies FileContextItem in src/lib/context/contextItemDisplay.ts:23-50 even though FileContextItem owns labels in src/lib/context/contextItems.ts:232-263.
- LLM context already asks each item to format itself: src/lib/llm/context.ts:105-137.

Plan draft:
1. preserve ContextItem as the domain owner. first small implementation step: remove concrete-class special casing from ContextItemViewerScreen. Always call item.getDetailView({root}). For live agent/editable text, the item already returns a current view. To keep live updates, include item.state or item object identity in the effect dependency, and ensure getDetailView is cheap for those cases. Extract the renderer portion into a reusable ViewRenderer module that accepts ContextItemDetailView and action callbacks for editable/agent views. This makes completions/response screens able to reuse the same renderer later without inventing a new view framework.
2. introduce a small app view/task presentation registry, not a broad abstraction. Keep AppTask union, but co-locate render, pane behavior, context-list-keyboard eligibility, and ctrl-c/close policy in one registry keyed by task.kind. Replace taskRegistry.tsx + taskPresentation.ts + ctrlC task checks with that registry. Do this after step 1 so view rendering has a stable reusable component.
3. split command ownership from llm tools. Create a command module that exposes SlashCommand records with suggestion metadata plus a run({input, submittedComposer}) handler or an intent builder. LLM workflow tool slash commands can still be generated from their controllers, but the composer should only parse `/name input`, look up a command, and call command.run. Remove taskKind and SubmissionIntent switch. This is the highest impact simplification: adding /say or /show-context becomes one command record instead of registry + intent union + runner switch.
4. narrow context item action execution. Replace the broad ContextItemActionContext bag with command-like operations or a small AppCommand dispatcher. Concrete option: ContextItemAction.run receives {dispatch} and returns/dispatches typed operations like open-view, remove-context-item, rerun-llm, rerun-shell, apply-diff, save-agent-diff. The first implementation can keep the current runner but make invalid operations fail loudly: applySavedDiffContextItem should throw if invoked on a non-diff item instead of silently returning. Then migrate actions to typed operations once command dispatcher exists.
5. make file grouping item-provided only if/when touching context list. Add optional ContextItem.getListGroup? or getDisplayEntry? for file tree grouping, so contextItemDisplay groups by metadata instead of instanceof FileContextItem. This is lower priority because the existing tree builder is localized and working.
6. do not remove fail-fast guardrails in tool registry. duplicate slash/tool result assertions are useful because mcp/skill commands are dynamic. target only silent no-ops where there is no expected race, e.g. non-diff apply action. For async stale completions, keep no-op behavior but name helper functions to show they are race guards.

Implementation order:
a. ViewRenderer extraction + remove ContextItemViewerScreen instanceof branches; tests for user text edit and agent detail still render/update.
b. command registry owns slash command execution; delete SubmissionIntent taskKind switch.
c. task presentation registry unifies render/pane/close/context-keyboard policy.
d. typed context item action dispatch + fail loudly for impossible action/id mismatches.
e. optional file display metadata if still worth it after a-d.

Validation plan:
- baseline before code: bun test, bun run typecheck. if full test is slow, still run focused tests for MessageComposer, contextItems, task/ctrlC, response/shell/showContext.
- after each step: bun test affected tests + bun run typecheck.
- for UI behavior: run the app and manually exercise /say, /show-context, /cmd, opening file/user-text/agent/diff context items, focused context item Ctrl+o/Ctrl+x/Ctrl+y, and saving/rerunning outputs. no claim of verified e2e unless that real app path runs.
