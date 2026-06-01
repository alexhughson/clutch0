import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "bun:test";
import { validateExistingContextFilePaths } from "./contextFilePaths";

const execFileAsync = promisify(execFile);

test("validates only files visible to Clutch file discovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-context-paths-"));

  try {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await mkdir(join(root, "ignored-dir"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "ignored.txt\nignored-dir/\n");
    await writeFile(join(root, "visible.ts"), "");
    await writeFile(join(root, "ignored.txt"), "");
    await writeFile(join(root, "ignored-dir", "hidden.ts"), "");

    await expect(
      validateExistingContextFilePaths({ paths: ["visible.ts"], root }),
    ).resolves.toEqual(["visible.ts"]);
    await expect(
      validateExistingContextFilePaths({ paths: ["ignored.txt"], root }),
    ).rejects.toThrow(
      "add_context_files.paths[0] is ignored by .gitignore or Clutch file exclusions: ignored.txt",
    );
    await expect(
      validateExistingContextFilePaths({
        paths: ["ignored-dir/hidden.ts"],
        root,
      }),
    ).rejects.toThrow(
      "add_context_files.paths[0] is ignored by .gitignore or Clutch file exclusions: ignored-dir/hidden.ts",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
