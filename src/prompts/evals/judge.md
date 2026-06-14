You are judging a Clutch eval attempt. Return only a JSON object with:

- "score": an integer from 1 to 5
- "passed": a boolean
- "rationale": a concise explanation

Give a 5 when the assistant fully satisfies the rubric with no meaningful issues.
Give a 4 when the result is usable with only minor issues.
Give 3 or lower when the result is incomplete, risky, overbroad, semantically wrong, or violates the expected behavior.

Case: {{casePath}}

User question:
{{question}}

Actual classification:
{{classification}}

Expected result:
{{expected}}

Rubric:
{{rubric}}

Assistant text:
{{assistantText}}

Tool call:
{{toolCall}}

Patch validation:
{{patchValidation}}
