Change: Review the prompt-structure slice of the current diff. The user asked to research prompt ordering, make context items XML-shaped, keep the current user request last, shorten tool definitions, and tighten the system prompt.

Files in scope:
- src/prompts/context/user-message.md
- src/prompts/system/default.md
- src/prompts/system/patch-aware.md
- src/lib/context/contextItems.ts
- src/lib/llm/context.test.ts
- src/workflows/addFiles/addFilesWorkflowTool.ts
- src/workflows/findFiles/findFilesTool.ts
- src/workflows/llmTools/shellCommandWorkflowTool.ts
- src/workflows/createFile/createFileWorkflowTool.ts
- src/lib/llm/patchTool.ts

Known decisions:
- Current user request should be the last content in the assembled user message.
- File context remains `<file path="...">`.
- Prior LLM answers use `<answer><question>...</question><response>...</response></answer>`.
- Tool descriptions should be short decision criteria, not prose UI explanations.
- Do not review unrelated dirty work in the repo.

Checks:
- XML tags are balanced in all changed context item formatters.
- The new tags do not hide needed metadata such as focus, path, source request, status, errors, command, or tool name.
- The changed prompt order matches long-context guidance: context before current request.
- The system prompt is still sufficient for missing/truncated context.
- Shortened tool descriptions did not remove the critical distinction between `find_relevant_files` and `add_context_files`.
- Tests assert the new prompt contract rather than incidental text.
- No silent fallback or swallowed error was introduced.
- No transport/direct-LLM provider code was changed for prompt semantics.

Delegation boundary:
Work directly in this run. Do not use the squad-build skill. Do not create, brief, or manage additional agents, threads, or squads. If another instruction says to get a subagent review or use a squad workflow, treat that as satisfied by this delegated run and complete the assigned implementation or review yourself.

Out of scope: style-only comments, unrelated cleanup, and files outside the scope list unless a scoped file depends on them.

Report format:
Verdict / High-priority findings / Medium / Confirmed OK. Include file:line cites and one-line impact.
