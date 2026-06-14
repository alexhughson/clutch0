# Clutch LLM Evals

## Summary

Add a manual live eval suite focused on Clutch's first-step classification and edit behavior. The suite will use real Clutch prompt/context construction, real context items, and real workflow tool definitions so prompt tuning against `gpt-oss-120b` reflects the app's actual behavior.

## Required Eval Suite

Add these required case groups under `evals/cases/`.

### Classifier: Normal Answers

- `classifier/answer-selected-file`: selected file has enough context; expect `text`, no tool call.
- `classifier/answer-selected-saved-response`: selected saved LLM response is relevant; expect `text`, no tool call.
- `classifier/explain-current-diff`: git diff context is enough for explanation; expect `text`, no patch.
- `classifier/review-not-edit`: user asks "what would you change?"; expect `text`, no patch.
- `classifier/ask-command-suppresses-tools`: `/ask` with edit-ish wording; expect `text`, no workflow tool.

### Classifier: Find Context

- `classifier/find-missing-code-context`: no selected file, code-navigation question; expect `find_relevant_files`.
- `classifier/find-incomplete-context`: selected context is obviously unrelated; expect `find_relevant_files`.
- `classifier/find-truncated-context`: selected file is truncated before relevant symbol; expect `find_relevant_files`.
- `classifier/find-debug-stacktrace`: user provides stack trace but no source file; expect `find_relevant_files`.
- `classifier/no-find-general-question`: general programming question with no repo dependency; expect `text`.

### Classifier: Edit Routing

- `classifier/plain-edit-with-file`: normal "fix/change/refactor" request with selected file; expect `propose_patch`.
- `classifier/edit-command-with-file`: `/edit` with sufficient selected file context; expect `propose_patch`.
- `classifier/edit-command-missing-context`: `/edit` without enough context; expect `text` explaining missing context, not invented patch.
- `classifier/edit-request-needs-file-search`: non-slash edit request with no selected context; expect `find_relevant_files`.
- `classifier/refactor-selected-file`: refactor wording with clear file context; expect `propose_patch`.
- `classifier/do-not-patch-when-asking-plan`: user asks for a plan before changing code; expect `text`.

### Classifier: Other Workflow Tools

- `classifier/create-new-file`: explicit create-new-file request; expect `create_file`.
- `classifier/add-files-request`: user asks to add specific existing files to context; expect `add_context_files`.
- `classifier/find-command`: `/find` request; expect `find_relevant_files`.
- `classifier/cmd-command`: `/cmd` request; expect `run_shell_command`.
- `classifier/no-shell-for-dangerous-or-vague`: vague "run whatever checks" request; expect `text` or `find_relevant_files`, not shell.

### Edit Quality

- `edit/one-line-bugfix`: small single-file bug fix; expect valid `propose_patch`, exact unique `oldText`, correct behavior by judge.
- `edit/multi-hunk-single-file`: two related edits in one file; expect valid patch with focused changes.
- `edit/preserve-style`: edit must follow existing naming/import style; judge checks style preservation.
- `edit/no-unrequested-refactor`: simple fix should avoid broad rewrite; judge checks scope.
- `edit/create-file-when-explicit`: edit requires a new helper only because user explicitly asked; expect valid new-file edit with empty `oldText`.
- `edit/reject-existing-file-empty-oldtext`: existing file edit must not use empty `oldText`; validation must catch failure if model does.
- `edit/use-focused-context`: multiple selected files, one focused; expect patch targets focused/relevant file.
- `edit/use-saved-diff-context`: selected saved diff gives prior change context; expect patch builds on it correctly.
- `edit/missing-context-no-hallucinated-patch`: insufficient context; expect no patch or invalid case failure with clear classification.

## Key Changes

- Add `evals/run.ts` for manual live runs and `evals/render.ts` for regenerating rendered prompt artifacts.
- Add package scripts:
  - `eval:llm`: run live evals against configured `gpt-oss-120b`.
  - `eval:render`: regenerate case prompt snapshots.
  - `eval:check`: deterministic schema/render checks with no network.
- Add `src/prompts/evals/judge.md` for judge-only scoring prompts.
- Extract a reusable Clutch prompt builder so evals and runtime share `buildLlmContext`, command directive formatting, `patchAwareSystemPrompt`, and `getLlmWorkflowTools`.

## Case Format

- `input.json` describes source data: question, optional slash command, selected/focused context items, temp workspace files, optional git diff setup, and allowed tools.
- `expected.json` describes expected classifier result, required tool arguments, patch validity requirements, and optional judge rubric.
- `prompt.md` is generated from Clutch code as a review artifact, not hand-written source.

## Scoring

- Classifier cases use exact structured assertions first: expected tool name or no tool, single tool call only, and required argument shape.
- Edit cases must parse as `propose_patch` and pass existing patch validation against the temp workspace.
- Every patch attempt writes the internal Clutch validator output as report artifacts: `patch-validation.json` for the full validation result and `.diff` for valid generated diffs. These artifacts should be treated as the authoritative diff format for eval review.
- LLM-as-judge scores semantic correctness only where exact matching is brittle, especially edit intent, patch quality, scope, and style.
- Default live run repeats each case 3 times; pass by majority with required judge score at least `4/5`.

## Test Plan

- Add deterministic Bun tests for eval case schema parsing, workspace fixture creation, prompt rendering, result normalization, and malformed-case failures.
- Add tests proving rendered eval prompts include real Clutch context item formatting and real workflow tool definitions.
- Keep live evals out of normal `bun test`; they run only through `eval:llm`.

## Assumptions

- Live evals are manual, not a CI gate.
- Target model is configured primary model and should be `gpt-oss-120b`.
- Judge model is configurable and defaults to the configured summarization model.
- Agent/subagent workflows remain out of scope.
