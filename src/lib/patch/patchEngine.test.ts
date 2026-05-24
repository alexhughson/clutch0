import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import { applyPatchProposal, validatePatchProposal } from "./patchEngine";

test("validates an exact unique replacement and generates a diff", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.ts"), "const value = 1;\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      summary: "Update value",
      edits: [
        {
          path: "file.ts",
          oldText: "const value = 1;",
          newText: "const value = 2;",
        },
      ],
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

test("rejects edits whose oldText does not match", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.ts"), "const value = 1;\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      summary: "Update value",
      edits: [
        {
          path: "file.ts",
          oldText: "const missing = true;",
          newText: "const missing = false;",
        },
      ],
    },
  });

  expect(result.status).toBe("invalid");
  expect(
    result.status === "invalid" ? result.errors[0]?.message : "",
  ).toContain("did not match");
});

test("rejects edits whose oldText matches multiple times", async () => {
  const root = await createTempRoot();
  await writeFile(join(root, "file.ts"), "same\nsame\n");

  const result = await validatePatchProposal({
    root,
    proposal: {
      summary: "Update value",
      edits: [{ path: "file.ts", oldText: "same", newText: "changed" }],
    },
  });

  expect(result.status).toBe("invalid");
  expect(
    result.status === "invalid" ? result.errors[0]?.message : "",
  ).toContain("matched 2 times");
});

test("rejects paths outside the working directory", async () => {
  const root = await createTempRoot();

  const result = await validatePatchProposal({
    root,
    proposal: {
      summary: "Escape root",
      edits: [{ path: "../outside.txt", oldText: "", newText: "nope" }],
    },
  });

  expect(result.status).toBe("invalid");
  expect(
    result.status === "invalid" ? result.errors[0]?.message : "",
  ).toContain("outside the working directory");
});

test("creates new files with empty oldText", async () => {
  const root = await createTempRoot();
  const proposal = {
    summary: "Create file",
    edits: [{ path: "src/new.ts", oldText: "", newText: "export {};\n" }],
  };

  const result = await applyPatchProposal({ root, proposal });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "src/new.ts"), "utf8")).toBe("export {};\n");
});

test("does not write any files when one edit is invalid", async () => {
  const root = await createTempRoot();
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/a.ts"), "a = 1;\n");
  await writeFile(join(root, "src/b.ts"), "b = 1;\n");

  const result = await applyPatchProposal({
    root,
    proposal: {
      summary: "Partial failure",
      edits: [
        { path: "src/a.ts", oldText: "a = 1;", newText: "a = 2;" },
        { path: "src/b.ts", oldText: "missing", newText: "b = 2;" },
      ],
    },
  });

  expect(result.status).toBe("invalid");
  expect(await readFile(join(root, "src/a.ts"), "utf8")).toBe("a = 1;\n");
  expect(await readFile(join(root, "src/b.ts"), "utf8")).toBe("b = 1;\n");
});

async function createTempRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "clutch-patch-"));
}
