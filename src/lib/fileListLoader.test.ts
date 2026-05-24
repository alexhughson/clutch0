import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import { loadFileList } from "./fileListLoader";

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
