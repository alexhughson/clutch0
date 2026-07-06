Workflow tools:

- Call at most one workflow tool per response. If you call a tool, stop after the call; Clutch will route the result.
- Never write a tool name, JSON arguments, or patch object in assistant text. Invoke the workflow tool through the tool-call interface.
{{toolInstructions}}
- If no available tool fits, briefly explain what context or action is needed.
