import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import {
  applyPatchProposal,
  getPatchProposalAffectedPaths,
  getPatchProposalFileChanges,
  getPatchProgressFromText,
  parseCodexPatch,
  validatePatchProposal,
} from "./patchEngine";
import { formatPatchValidationError } from "./patchToolOutput";

test("validates a Codex update patch and generates a diff", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.ts"), "const value = 1;\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: file.ts",
        "@@",
        "-const value = 1;",
        "+const value = 2;",
        "*** End Patch",
      ].join("\n"),
      summary: "Update value",
    },
  });

  expect(result.status).toBe("valid");
  expect(result.status === "valid" ? result.diffText : "").toContain(
    "-const value = 1;",
  );
  expect(result.status === "valid" ? result.diffText : "").toContain(
    "+const value = 2;",
  );
});

test("generates update diffs with Codex one-line context", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.txt"), "a\nb\nc\nd\ne\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: file.txt",
        "@@",
        "-c",
        "+C",
        "*** End Patch",
      ].join("\n"),
      summary: "Update middle line",
    },
  });

  expect(result.status).toBe("valid");
  const diffText = result.status === "valid" ? result.diffText : "";
  expect(diffText).toContain("@@ -2,3 +2,3 @@");
  expect(diffText).toContain(" b\n-c\n+C\n d");
  expect(diffText).not.toContain("\n a\n");
  expect(diffText).not.toContain("\n e");
});

test("accepts unified range hunk headers inside Codex update patches", async () => {
  const root = await createTempRoot();
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src/parser.test.ts"),
    [
      'import { test, expect } from "bun:test";',
      'import { parseOpenAICompatibleBody } from "./parser";',
      "",
      'test("parses a simple user message", () => {',
      "  const res = parseOpenAICompatibleBody({",
      '    model: "gpt-4o",',
      '    messages: [{ role: "user", content: "Hello" }],',
      "  });",
      "",
      '  expect(res.model).toBe("gpt-4o");',
      "});",
      "",
    ].join("\n"),
  );

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: src/parser.test.ts",
        "@@ -1,6 +1,35 @@",
        ' import { test, expect } from "bun:test";',
        ' import { parseOpenAICompatibleBody } from "./parser";',
        " ",
        '-test("parses a simple user message", () => {',
        "-  const res = parseOpenAICompatibleBody({",
        '+test("parses simple user message", () => {',
        "+  const result = parseOpenAICompatibleBody({",
        '     model: "gpt-4o",',
        '     messages: [{ role: "user", content: "Hello" }],',
        "   });",
        " ",
        '-  expect(res.model).toBe("gpt-4o");',
        '+  expect(result.model).toBe("gpt-4o");',
        " });",
        "*** End Patch",
      ].join("\n"),
      summary: "Rename parser test variable",
    },
  });

  expect(result.status).toBe("valid");
  const diffText = result.status === "valid" ? result.diffText : "";
  expect(diffText).toContain('test("parses simple user message"');
  expect(diffText).toContain("const result = parseOpenAICompatibleBody");
});

test("falls back from missing hunk context when expected lines are unique", async () => {
  const root = await createTempRoot();
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src/parser.test.ts"),
    [
      'import { test, expect } from "bun:test";',
      'import { parseOpenAICompatibleBody } from "./parser";',
      "",
      "// --- Test cases: each entry is { name, input, expected } ---",
      "const testCases = [",
      "  {",
      '    name: "simple user message",',
      "  },",
      "];",
      "",
    ].join("\n"),
  );

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: src/parser.test.ts",
        "@@ context",
        '-import { test, expect } from "bun:test";',
        '-import { parseOpenAICompatibleBody } from "./parser";',
        "-",
        "-// --- Test cases: each entry is { name, input, expected } ---",
        '+import { test, expect } from "bun:test";',
        '+import { parseOpenAICompatibleBody } from "./parser";',
        "+",
        "+// Each test is [input, expected] - paired for easy visual scanning",
        "*** End Patch",
      ].join("\n"),
      summary: "Clarify parser tests",
    },
  });

  expect(result.status).toBe("valid");
  expect(result.status === "valid" ? result.diffText : "").toContain(
    "Each test is [input, expected]",
  );
});

test("rejects missing hunk context when expected lines are ambiguous", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.txt"), "same\nold\nsame\nold\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: file.txt",
        "@@ missing anchor",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
      summary: "Ambiguous edit",
    },
  });

  expect(result.status).toBe("invalid");
  expect(result.status === "invalid" ? result.errors[0]?.message : "").toBe(
    "Failed to find context 'missing anchor' in file.txt; expected lines matched multiple locations.",
  );
});

test("extracts Codex-shaped file changes from patch proposals", () => {
  const changes = getPatchProposalFileChanges({
    patch: [
      "*** Begin Patch",
      "*** Add File: docs/new.md",
      "+hello",
      "*** Update File: README.md",
      "*** Move to: docs/README.md",
      "@@ heading",
      "-old",
      "+new",
      "*** Delete File: old.txt",
      "*** End Patch",
    ].join("\n"),
    summary: "Update files",
  });

  expect(changes).toEqual({
    "README.md": {
      move_path: "docs/README.md",
      type: "update",
      unified_diff: "@@ heading\n-old\n+new\n",
    },
    "docs/new.md": {
      content: "hello\n",
      type: "add",
    },
    "old.txt": {
      content: "",
      type: "delete",
    },
  });
});

test("extracts Codex-style affected paths without collapsing repeated operations", () => {
  expect(
    getPatchProposalAffectedPaths({
      patch: [
        "*** Begin Patch",
        "*** Add File: repeat.txt",
        "+hello",
        "*** Delete File: repeat.txt",
        "*** Update File: old.ts",
        "*** Move to: new.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
      summary: "Repeated operations",
    }),
  ).toEqual({
    added: ["repeat.txt"],
    deleted: ["repeat.txt"],
    modified: ["new.ts"],
  });
});

test("matches update hunks with relaxed whitespace", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "README.md"), "## Notes\n\n- item   \n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: README.md",
        "@@",
        " ## Notes",
        " ",
        "-- item",
        "+- updated item",
        "*** End Patch",
      ].join("\n"),
      summary: "Update notes",
    },
  });

  expect(result.status).toBe("valid");
  expect(result.status === "valid" ? result.diffText : "").toContain(
    "+- updated item",
  );
});

test("parses an apply_patch environment id preamble", () => {
  const result = parseCodexPatch(
    [
      "*** Begin Patch",
      "*** Environment ID: local",
      "*** Update File: file.ts",
      "@@",
      "-const value = 1;",
      "+const value = 2;",
      "*** End Patch",
    ].join("\n"),
  );

  expect(result).toMatchObject({
    patch: {
      environmentId: "local",
      operations: [
        {
          path: "file.ts",
          type: "update",
        },
      ],
    },
    status: "valid",
  });
});

test("rejects apply_patch environment selection in Clutch's single-workspace tool mode", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.ts"), "const value = 1;\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Environment ID: local",
        "*** Update File: file.ts",
        "@@",
        "-const value = 1;",
        "+const value = 2;",
        "*** End Patch",
      ].join("\n"),
      summary: "Update value",
    },
  });

  expect(result.status).toBe("invalid");
  expect(result.status === "invalid" ? result.errors[0]?.message : "").toBe(
    "apply_patch environment selection is unavailable for this turn",
  );
});

test("rejects Codex environment id preamble without a space after the colon", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.ts"), "const value = 1;\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Environment ID:local",
        "*** Update File: file.ts",
        "@@",
        "-const value = 1;",
        "+const value = 2;",
        "*** End Patch",
      ].join("\n"),
      summary: "Update value",
    },
  });

  expect(result.status).toBe("invalid");
  expect(result.status === "invalid" ? result.errors[0]?.message : "").toBe(
    "apply_patch environment selection is unavailable for this turn",
  );
});

test("reports Codex environment id parser errors without standalone punctuation", () => {
  expect(
    parseCodexPatch(
      [
        "*** Begin Patch",
        "*** Environment ID:   ",
        "*** Add File: hello.txt",
        "+hello",
        "*** End Patch",
      ].join("\n"),
    ),
  ).toMatchObject({
    error: "apply_patch environment_id cannot be empty",
    status: "invalid",
  });

  expect(
    parseCodexPatch(
      [
        "*** Begin Patch",
        "*** Environment ID: first",
        "*** Environment ID: second",
        "*** Add File: hello.txt",
        "+hello",
        "*** End Patch",
      ].join("\n"),
    ),
  ).toMatchObject({
    error: "apply_patch environment_id cannot be specified more than once",
    status: "invalid",
  });
});

test("accepts whitespace-padded Codex structural markers", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.txt"), "old\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        " *** Begin Patch ",
        "  *** Update File: file.txt ",
        "@@",
        "-old",
        "+new",
        " *** End Patch",
      ].join("\n"),
      summary: "Update value",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("new\n");
});

test("accepts double-quoted heredoc wrapped patch text", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.txt"), "old\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        '<<"EOF"',
        "*** Begin Patch",
        "*** Update File: file.txt",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
        "EOF",
      ].join("\n"),
      summary: "Update value",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("new\n");
});

test("accepts unquoted heredoc wrapped patch text like Codex", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.txt"), "old\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        "<<EOF",
        "*** Begin Patch",
        "*** Update File: file.txt",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
        "EOF",
      ].join("\n"),
      summary: "Update value",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("new\n");
});

test("accepts single-quoted heredoc wrapped patch text like Codex", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.txt"), "old\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        "<<'EOF'",
        "*** Begin Patch",
        "*** Update File: file.txt",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
        "EOF",
      ].join("\n"),
      summary: "Update value",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("new\n");
});

test("rejects non-EOF heredoc markers like Codex", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.txt"), "old\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "<<PATCH",
        "*** Begin Patch",
        "*** Update File: file.txt",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
        "PATCH",
      ].join("\n"),
      summary: "Update value",
    },
  });

  expect(result).toMatchObject({
    errors: [
      {
        message:
          "invalid patch: The first line of the patch must be '*** Begin Patch'",
      },
    ],
    status: "invalid",
  });
});

test("rejects mismatched heredoc quotes like Codex", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.txt"), "old\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "<<\"EOF'",
        "*** Begin Patch",
        "*** Update File: file.txt",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
        "EOF",
      ].join("\n"),
      summary: "Update value",
    },
  });

  expect(result).toMatchObject({
    errors: [
      {
        message:
          "invalid patch: The first line of the patch must be '*** Begin Patch'",
      },
    ],
    status: "invalid",
  });
});

test("reports missing end patch inside a Codex heredoc wrapper", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.txt"), "old\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "<<EOF",
        "*** Begin Patch",
        "*** Update File: file.txt",
        "EOF",
      ].join("\n"),
      summary: "Update value",
    },
  });

  expect(result).toMatchObject({
    errors: [
      {
        message:
          "invalid patch: The last line of the patch must be '*** End Patch'",
      },
    ],
    status: "invalid",
  });
});

test("preserves boundary blank lines inside Codex heredoc wrappers", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.txt"), "old\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "<<EOF",
        "",
        "*** Begin Patch",
        "*** Update File: file.txt",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
        "",
        "EOF",
      ].join("\n"),
      summary: "Update value",
    },
  });

  expect(result).toMatchObject({
    errors: [
      {
        message:
          "invalid patch: The first line of the patch must be '*** Begin Patch'",
      },
    ],
    status: "invalid",
  });
});

test("accepts CRLF heredoc wrapped patch text", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.txt"), "old\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch:
        '<<"EOF"\r\n*** Begin Patch\r\n*** Update File: file.txt\r\n@@\r\n-old\r\n+new\r\n*** End Patch\r\nEOF\r\n',
      summary: "Update value",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("new\n");
});

test("ignores pre-chunk end-of-file markers like Codex", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "README.md"), "# Notes\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: README.md",
        "*** End of File",
        "+More notes",
        "*** End Patch",
      ].join("\n"),
      summary: "Append notes",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "README.md"), "utf8")).toBe(
    "# Notes\nMore notes\n",
  );
});

test("preserves bare carriage returns in patch content lines", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.txt"), "old\r\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch:
        "*** Begin Patch\r\n*** Update File: file.txt\r\n@@\r\n-old\r\r\n+new\r\n*** End Patch\r\n",
      summary: "Update value",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("new\n");
});

test("accepts Codex update structural markers with trailing whitespace", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.txt"), "old\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: file.txt",
        "@@   ",
        "-old",
        "+new",
        "*** End of File   ",
        "*** End Patch",
      ].join("\n"),
      summary: "Update value",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("new\n");
});

test("rejects update content after an end-of-file marker", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.txt"), "old\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: file.txt",
        "@@",
        "-old",
        "+new",
        "*** End of File",
        "+after eof",
        "*** End Patch",
      ].join("\n"),
      summary: "Invalid eof content",
    },
  });

  expect(result.status).toBe("invalid");
  expect(
    result.status === "invalid" ? result.errors[0]?.message : "",
  ).toContain("Expected update hunk to start with a @@ context marker");
});

test("keeps content lines that look like padded markers inside update hunks", async () => {
  const root = await createTempRoot();
  await writeFile(
    join(root, "notes.md"),
    "before\n*** Update File: not-a-header\nold\n",
  );

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: notes.md",
        "@@",
        " before",
        " *** Update File: not-a-header",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
      summary: "Update value",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "notes.md"), "utf8")).toBe(
    "before\n*** Update File: not-a-header\nnew\n",
  );
});

test("preserves bare empty update lines as context", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "README.md"), "## Notes\n\nold\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: README.md",
        "@@",
        " ## Notes",
        "",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
      summary: "Update notes",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "README.md"), "utf8")).toBe(
    "## Notes\n\nnew\n",
  );
});

test("ignores blank spacer lines after end-of-file markers", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "README.md"), "# Notes\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: README.md",
        "@@",
        "+",
        "+More notes",
        "*** End of File",
        "",
        "*** End Patch",
      ].join("\n"),
      summary: "Append notes",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "README.md"), "utf8")).toBe(
    "# Notes\n\nMore notes\n",
  );
});

test("inserts pure additions before a final blank line like Codex", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "README.md"), "# Notes\n\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: README.md",
        "@@",
        "+More notes",
        "*** End of File",
        "*** End Patch",
      ].join("\n"),
      summary: "Append notes",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "README.md"), "utf8")).toBe(
    "# Notes\nMore notes\n",
  );
});

test("uses @@ context to target a repeated markdown section", async () => {
  const root = await createTempRoot();
  await writeFile(
    join(root, "README.md"),
    "## Staging\n\n- timeout: 30\n\n## Production\n\n- timeout: 30\n",
  );

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: README.md",
        "@@ ## Production",
        "-- timeout: 30",
        "+- timeout: 45",
        "*** End Patch",
      ].join("\n"),
      summary: "Update production timeout",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "README.md"), "utf8")).toBe(
    "## Staging\n\n- timeout: 30\n\n## Production\n\n- timeout: 45\n",
  );
});

test("generates one final diff for repeated updates to the same file", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.ts"), "const a = 1;\nconst b = 1;\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: file.ts",
        "@@",
        "-const a = 1;",
        "+const a = 2;",
        "*** Update File: file.ts",
        "@@",
        "-const b = 1;",
        "+const b = 2;",
        "*** End Patch",
      ].join("\n"),
      summary: "Update both constants",
    },
  });

  expect(result.status).toBe("valid");
  const diffText = result.status === "valid" ? result.diffText : "";
  expect(diffText.match(/^--- file\.ts$/gm)?.length).toBe(1);
  expect(diffText).toContain("+const a = 2;");
  expect(diffText).toContain("+const b = 2;");
});

test("updates a moved file through its new path in the same patch", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "old.ts"), "const value = 1;\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: old.ts",
        "*** Move to: new.ts",
        "@@",
        "-const value = 1;",
        "+const value = 2;",
        "*** Update File: new.ts",
        "@@",
        "-const value = 2;",
        "+const value = 3;",
        "*** End Patch",
      ].join("\n"),
      summary: "Move and update",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "new.ts"), "utf8")).toBe(
    "const value = 3;\n",
  );
  await expect(readFile(join(root, "old.ts"), "utf8")).rejects.toThrow();
  const diffText = result.status === "valid" ? result.diffText : "";
  expect(diffText).toContain("--- old.ts");
  expect(diffText).toContain("+++ new.ts");
  expect(diffText).toContain("+const value = 3;");
});

test("move operations overwrite existing destinations like Codex", async () => {
  const root = await createTempRoot();
  await mkdir(join(root, "old"), { recursive: true });
  await mkdir(join(root, "renamed", "dir"), { recursive: true });
  await writeFile(join(root, "old", "name.txt"), "from\n");
  await writeFile(join(root, "renamed", "dir", "name.txt"), "existing\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: old/name.txt",
        "*** Move to: renamed/dir/name.txt",
        "@@",
        "-from",
        "+new",
        "*** End Patch",
      ].join("\n"),
      summary: "Move over existing file",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "renamed", "dir", "name.txt"), "utf8")).toBe(
    "new\n",
  );
  await expect(
    readFile(join(root, "old", "name.txt"), "utf8"),
  ).rejects.toThrow();
});

test("updates a newly added file later in the same patch", async () => {
  const root = await createTempRoot();

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Add File: created.ts",
        "+const value = 1;",
        "*** Update File: created.ts",
        "@@",
        "-const value = 1;",
        "+const value = 2;",
        "*** End Patch",
      ].join("\n"),
      summary: "Create and update",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "created.ts"), "utf8")).toBe(
    "const value = 2;\n",
  );
  const diffText = result.status === "valid" ? result.diffText : "";
  expect(diffText).toContain("--- /dev/null");
  expect(diffText).toContain("+++ created.ts");
  expect(diffText).toContain("+const value = 2;");
});

test("does not reread the old path after a move in the same patch", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "old.ts"), "const value = 1;\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: old.ts",
        "*** Move to: new.ts",
        "@@",
        "-const value = 1;",
        "+const value = 2;",
        "*** Update File: old.ts",
        "@@",
        "-const value = 1;",
        "+const value = 3;",
        "*** End Patch",
      ].join("\n"),
      summary: "Move then update old path",
    },
  });

  expect(result.status).toBe("invalid");
  expect(result.status === "invalid" ? result.errors[0]?.message : "").toBe(
    `Failed to read file to update ${join(root, "old.ts")}: No such file or directory (os error 2)`,
  );
});

test("extracts patch progress from incomplete Codex patch text", () => {
  const patchText = [
    "*** Begin Patch",
    "  *** Update File: src/old.ts ",
    " *** Move to: src/new.ts",
    "@@",
    "-old",
    "+new",
    " *** Add File: notes.md",
    "+# Notes",
  ].join("\n");

  expect(getPatchProgressFromText(patchText)).toEqual({
    files: [
      {
        movePath: "src/new.ts",
        operation: "update",
        path: "src/old.ts",
      },
      {
        operation: "add",
        path: "notes.md",
      },
    ],
    patchCharacterCount: patchText.length,
  });
});

test("creates and deletes files with Codex file operations", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "old.txt"), "remove me\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Add File: src/new.ts",
        "+export {};",
        "*** Delete File: old.txt",
        "*** End Patch",
      ].join("\n"),
      summary: "Create and delete files",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "src/new.ts"), "utf8")).toBe("export {};\n");
  await expect(readFile(join(root, "old.txt"), "utf8")).rejects.toThrow();
});

test("creates empty files from empty add hunks like Codex", async () => {
  const root = await createTempRoot();

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Add File: empty.txt",
        "*** End Patch",
      ].join("\n"),
      summary: "Create empty file",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "empty.txt"), "utf8")).toBe("");
});

test("add file operations overwrite existing files like Codex", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "duplicate.txt"), "old content\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Add File: duplicate.txt",
        "+new content",
        "*** End Patch",
      ].join("\n"),
      summary: "Add over existing file",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "duplicate.txt"), "utf8")).toBe(
    "new content\n",
  );
});

test("rejects empty patches with Codex's managed-tool rejection message", async () => {
  const root = await createTempRoot();

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: ["*** Begin Patch", "*** End Patch"].join("\n"),
      summary: "Empty patch",
    },
  });

  expect(result.status).toBe("invalid");
  expect(result.status === "invalid" ? result.errors[0]?.message : "").toBe(
    "patch rejected: empty patch",
  );
});

test("rejects missing delete targets with Codex's verification read failure", async () => {
  const root = await createTempRoot();

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Delete File: missing.txt",
        "*** End Patch",
      ].join("\n"),
      summary: "Delete missing file",
    },
  });

  expect(result.status).toBe("invalid");
  expect(result.status === "invalid" ? result.errors[0]?.message : "").toBe(
    `Failed to read ${join(root, "missing.txt")}: No such file or directory (os error 2)`,
  );
});

test("rejects directory delete targets with Codex's verification read failure", async () => {
  const root = await createTempRoot();
  await mkdir(join(root, "dir"));

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: ["*** Begin Patch", "*** Delete File: dir", "*** End Patch"].join(
        "\n",
      ),
      summary: "Delete directory",
    },
  });

  expect(result.status).toBe("invalid");
  expect(result.status === "invalid" ? result.errors[0]?.message : "").toBe(
    `Failed to read ${join(root, "dir")}: Is a directory (os error 21)`,
  );
});

test("rejects update hunks whose expected lines cannot be found", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.ts"), "const value = 1;\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: file.ts",
        "@@",
        "-const missing = true;",
        "+const missing = false;",
        "*** End Patch",
      ].join("\n"),
      summary: "Update value",
    },
  });

  expect(result.status).toBe("invalid");
  expect(
    result.status === "invalid" ? result.errors[0]?.message : "",
  ).toContain("Failed to find expected lines");
});

test("rejects single hunks that combine non-contiguous regions", async () => {
  const root = await createTempRoot();
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src/parser.test.ts"),
    [
      'import { test, expect } from "bun:test";',
      'import { parseOpenAICompatibleBody } from "./parser";',
      "",
      "// --- Test cases: each entry is { name, input, expected } ---",
      "const testCases = [",
      "  {",
      '    name: "simple user message",',
      "  },",
      "];",
      "",
      "// --- Runner ---",
      "for (const { name, input, expected } of testCases) {",
      "  test(name, () => {",
      "    const result = parseOpenAICompatibleBody(input);",
      "    expect(result).toEqual(expected);",
      "  });",
      "}",
      "",
    ].join("\n"),
  );

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: src/parser.test.ts",
        "@@",
        '-import { parseOpenAICompatibleBody } from "./parser";',
        "-",
        "-// --- Runner ---",
        "-for (const { name, input, expected } of testCases) {",
        "-  test(name, () => {",
        "-    const result = parseOpenAICompatibleBody(input);",
        "-    expect(result).toEqual(expected);",
        "-  });",
        "-}",
        "-// --- Test cases: each entry is { name, input, expected } ---",
        "-",
        "-const testCases = [",
        '+import { parseOpenAICompatibleBody } from "./parser";',
        "+",
        "+// Each test is [input, expected] - paired for easy visual scanning",
        "+const tests = [",
        "*** End Patch",
      ].join("\n"),
      summary: "Restructure parser tests",
    },
  });

  expect(result.status).toBe("invalid");
  const message = result.status === "invalid" ? result.errors[0]?.message : "";
  expect(message).toContain("Failed to find expected lines");
  expect(message).toContain(
    "Each update hunk must match one contiguous region",
  );
});

test("rejects empty update hunks", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.ts"), "const value = 1;\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: file.ts",
        "@@",
        "*** End Patch",
      ].join("\n"),
      summary: "Empty hunk",
    },
  });

  expect(result.status).toBe("invalid");
  expect(
    result.status === "invalid" ? result.errors[0]?.message : "",
  ).toContain("Update hunk does not contain any lines");
});

test("rejects malformed hunk context markers without a space after @@", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.ts"), "const value = 1;\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: file.ts",
        "@@const value",
        "-const value = 1;",
        "+const value = 2;",
        "*** End Patch",
      ].join("\n"),
      summary: "Update value",
    },
  });

  expect(result.status).toBe("invalid");
  expect(result.status === "invalid" ? result.errors[0]?.message : "").toBe(
    "Unexpected line found in update hunk: '@@const value'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)",
  );
});

test("rejects repeated empty update hunk markers with Codex's unexpected-line message", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.ts"), "const value = 1;\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: file.ts",
        "@@",
        "@@",
        "*** End Patch",
      ].join("\n"),
      summary: "Repeated empty hunk",
    },
  });

  expect(result.status).toBe("invalid");
  expect(result.status === "invalid" ? result.errors[0]?.message : "").toBe(
    "Unexpected line found in update hunk: '@@'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)",
  );
});

test("rejects file headers after empty update hunks with Codex's unexpected-line message", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.ts"), "const value = 1;\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: file.ts",
        "@@",
        "*** Update File: other.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
      summary: "Header after empty hunk",
    },
  });

  expect(result.status).toBe("invalid");
  expect(result.status === "invalid" ? result.errors[0]?.message : "").toBe(
    "Unexpected line found in update hunk: '*** Update File: other.ts'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)",
  );
});

test("rejects stray update lines after hunk content with Codex's context-marker message", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.ts"), "const value = 1;\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: file.ts",
        "@@",
        "-const value = 1;",
        "bad",
        "*** End Patch",
      ].join("\n"),
      summary: "Stray update line",
    },
  });

  expect(result.status).toBe("invalid");
  expect(result.status === "invalid" ? result.errors[0]?.message : "").toBe(
    "Expected update hunk to start with a @@ context marker, got: 'bad'",
  );
});

test("formats structurally broken patch validation errors without a leading colon", async () => {
  const root = await createTempRoot();

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: ["*** Update File: file.ts", "*** End Patch"].join("\n"),
      summary: "Missing begin marker",
    },
  });

  expect(result.status).toBe("invalid");
  if (result.status !== "invalid") {
    return;
  }

  expect(result.errors[0]?.path).toBeUndefined();
  const formatted = formatPatchValidationError(result.errors[0]!);
  expect(formatted).not.toMatch(/^:/);
  expect(formatted).toBe(
    "invalid patch: The first line of the patch must be '*** Begin Patch'",
  );
});

test("rejects missing patch boundary markers with Codex's invalid-patch messages", async () => {
  const root = await createTempRoot();

  const missingStart = await validatePatchProposal({
    root,
    proposal: {
      patch: ["*** Update File: file.ts", "*** End Patch"].join("\n"),
      summary: "Missing start",
    },
  });

  expect(missingStart.status).toBe("invalid");
  expect(
    missingStart.status === "invalid" ? missingStart.errors[0]?.message : "",
  ).toBe(
    "invalid patch: The first line of the patch must be '*** Begin Patch'",
  );

  const missingEnd = await validatePatchProposal({
    root,
    proposal: {
      patch: ["*** Begin Patch", "*** Add File: file.ts", "+content"].join(
        "\n",
      ),
      summary: "Missing end",
    },
  });

  expect(missingEnd.status).toBe("invalid");
  expect(
    missingEnd.status === "invalid" ? missingEnd.errors[0]?.message : "",
  ).toBe("invalid patch: The last line of the patch must be '*** End Patch'");
});

test("rejects invalid operation headers with Codex's valid-header hint", async () => {
  const root = await createTempRoot();

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Frobnicate File: foo",
        "*** End Patch",
      ].join("\n"),
      summary: "Invalid operation",
    },
  });

  expect(result.status).toBe("invalid");
  expect(result.status === "invalid" ? result.errors[0]?.message : "").toBe(
    "invalid hunk at line 2, '*** Frobnicate File: foo' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'",
  );
});

test("rejects malformed add file bodies with Codex's valid-header hint", async () => {
  const root = await createTempRoot();

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Add File: file.txt",
        "bad",
        "*** End Patch",
      ].join("\n"),
      summary: "Invalid add body",
    },
  });

  expect(result.status).toBe("invalid");
  expect(result.status === "invalid" ? result.errors[0]?.message : "").toBe(
    "invalid hunk at line 3, 'bad' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'",
  );
});

test("rejects move-only update operations", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "old.ts"), "const value = 1;\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: old.ts",
        "*** Move to: new.ts",
        "*** End Patch",
      ].join("\n"),
      summary: "Move only",
    },
  });

  expect(result.status).toBe("invalid");
  expect(
    result.status === "invalid" ? result.errors[0]?.message : "",
  ).toContain("Update file hunk for path 'old.ts' is empty");
});

test("rejects update operations without hunks using Codex's empty update message", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.ts"), "const value = 1;\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: file.ts",
        "*** End Patch",
      ].join("\n"),
      summary: "Empty update",
    },
  });

  expect(result.status).toBe("invalid");
  expect(
    result.status === "invalid" ? result.errors[0]?.message : "",
  ).toContain("Update file hunk for path 'file.ts' is empty");
});

test("rejects paths outside the working directory", async () => {
  const root = await createTempRoot();

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Add File: ../outside.txt",
        "+nope",
        "*** End Patch",
      ].join("\n"),
      summary: "Escape root",
    },
  });

  expect(result.status).toBe("invalid");
  expect(
    result.status === "invalid" ? result.errors[0]?.message : "",
  ).toContain("outside the working directory");
});

test("rejects existing patch targets that are not valid UTF-8", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "bad.txt"), new Uint8Array([0xff, 0xfe, 0xfd]));

  const result = await validatePatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: bad.txt",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
      summary: "Update binary-looking file",
    },
  });

  expect(result.status).toBe("invalid");
  expect(
    result.status === "invalid" ? result.errors[0]?.message : "",
  ).toContain("not valid UTF-8");
});

test("does not write any files when one operation is invalid", async () => {
  const root = await createTempRoot();
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/a.ts"), "a = 1;\n");
  await writeFile(join(root, "src/b.ts"), "b = 1;\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: src/a.ts",
        "@@",
        "-a = 1;",
        "+a = 2;",
        "*** Update File: src/b.ts",
        "@@",
        "-missing",
        "+b = 2;",
        "*** End Patch",
      ].join("\n"),
      summary: "Partial failure",
    },
  });

  expect(result.status).toBe("invalid");
  expect(await readFile(join(root, "src/a.ts"), "utf8")).toBe("a = 1;\n");
  expect(await readFile(join(root, "src/b.ts"), "utf8")).toBe("b = 1;\n");
});

async function createTempRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "clutch-patch-"));
}
