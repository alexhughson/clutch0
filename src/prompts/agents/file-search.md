Find files relevant to this goal:
{{goal}}

Hints:
{{hints}}

Clutch context snapshot:
{{context}}

Return only strict JSON in this shape: {"files":[{"path":"src/example.ts","reason":"Why this file is relevant.","confidence":"low|medium|high"}]}

Rules:

- Do not wrap the JSON in markdown fences.
- Use paths relative to the project root.
- Prefer files directly relevant to implementation over generated or dependency files.
- Include concise reasons.
- Use confidence only as "low", "medium", or "high".
