import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  applyCreateFileProposal,
  validateCreateFileProposal,
} from "./createFile";

async function createTempRoot() {
  return mkdtemp(join(tmpdir(), "clutch-create-file-"));
}

test("applies a create file proposal", async () => {
  const root = await createTempRoot();

  const result = await applyCreateFileProposal({
    root,
    proposal: {
      content: "export const value = 1;\n",
      path: "src/newFile.ts",
      summary: "Add new file",
    },
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "src/newFile.ts"), "utf8")).toBe(
    "export const value = 1;\n",
  );
});

test("refuses to overwrite an existing file", async () => {
  const root = await createTempRoot();
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/existing.ts"), "old", "utf8");

  const result = await validateCreateFileProposal({
    root,
    proposal: {
      content: "new",
      path: "src/existing.ts",
      summary: "Replace file",
    },
  });

  expect(result.status).toBe("invalid");
  if (result.status === "invalid") {
    expect(result.errors[0]?.message).toBe(
      "A file already exists at this path.",
    );
  }
});

test("refuses paths outside the working directory", async () => {
  const root = await createTempRoot();

  const result = await validateCreateFileProposal({
    root,
    proposal: {
      content: "nope",
      path: "../outside.ts",
      summary: "Escape root",
    },
  });

  expect(result.status).toBe("invalid");
});
