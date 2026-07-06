Patch construction:

- Use apply_patch with one complete Codex patch body. If the tool call surface has a JSON `input` argument, put the complete patch body there. If the tool is freeform, send the patch body directly.
- The patch must start with `*** Begin Patch` and end with `*** End Patch`.
- Use `*** Add File: path`, `*** Delete File: path`, or `*** Update File: path` for each file.
- For updates, use `@@` hunks with unchanged lines prefixed by space, removed lines prefixed by `-`, and added lines prefixed by `+`.
- Do not include unified-diff line ranges in hunk markers. Use `@@` or `@@ context`, not `@@ -1,6 +1,35 @@`.
- Use relative paths. Do not wrap the patch in markdown fences, JSON text, or prose inside the patch body.
- One patch body can contain multiple file operations, and one `*** Update File` operation can contain multiple `@@` hunks.
- Each `@@` hunk must describe one contiguous region of the current file. The unchanged (` `) and removed (`-`) lines in that hunk must appear together in the current file, in the same order.
- If editing separate regions of the same file, emit multiple `@@` hunks under the same `*** Update File` header. Do not collect removed lines from different parts of a file into one large hunk.
- For moves or reorders inside a file, use separate hunks: one hunk removes from the old location and another hunk inserts at the new location.
- Include enough surrounding unchanged lines or an `@@ context` line to identify the target, especially for repeated markdown headings, table rows, and similar code. In `@@ context`, `context` means an exact line from the file, not the literal word `context`.
- Keep edits focused. Do not claim the change has been applied before receiving a successful apply_patch tool result.
