import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "bun:test";
import { loadFileList } from "./fileListLoader";

const execFileAsync = promisify(execFile);

test("loads git files while respecting gitignore rules", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-file-list-git-"));

  try {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await mkdir(join(root, "ignored-dir"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "ignored.txt\nignored-dir/\n");
    await writeFile(join(root, "visible.ts"), "");
    await writeFile(join(root, "ignored.txt"), "");
    await writeFile(join(root, "ignored-dir", "hidden.ts"), "");

    expect(await loadFileList({ root })).toEqual([".gitignore", "visible.ts"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("loads files with pluggable exclusions", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-file-list-"));

  try {
    await mkdir(join(root, "src", "lib"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "src", "index.tsx"), "");
    await writeFile(join(root, "src", "lib", "fileFilter.ts"), "");
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "");

    expect(await loadFileList({ root })).toEqual([
      "src/index.tsx",
      "src/lib/fileFilter.ts",
    ]);

    expect(
      await loadFileList({
        root,
        exclusionFilters: [(entry) => entry.path === "src/lib"],
      }),
    ).toEqual(["node_modules/pkg/index.js", "src/index.tsx"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
