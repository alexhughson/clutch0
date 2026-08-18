import { expect, test } from "bun:test";
import {
  formatUnifiedDiffFilesLabel,
  listUnifiedDiffFilePaths,
  splitUnifiedDiffByFile,
} from "./unifiedDiffFiles";

const MULTI_FILE_DIFF = `diff --git a/src/one.ts b/src/one.ts
index 1111111..2222222 100644
--- a/src/one.ts
+++ b/src/one.ts
@@ -1 +1 @@
-old1
+new1
diff --git a/src/two.ts b/src/two.ts
index 3333333..4444444 100644
--- a/src/two.ts
+++ b/src/two.ts
@@ -1 +1 @@
-old2
+new2
diff --git a/README.md b/README.md
index 5555555..6666666 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-old readme
+new readme
`;

test("splitUnifiedDiffByFile keeps every file as its own patch", () => {
  const files = splitUnifiedDiffByFile(MULTI_FILE_DIFF);
  expect(files.map((file) => file.path)).toEqual([
    "src/one.ts",
    "src/two.ts",
    "README.md",
  ]);
  expect(files[0]?.diff).toContain("src/one.ts");
  expect(files[0]?.diff).not.toContain("src/two.ts");
  expect(files[1]?.diff).toContain("src/two.ts");
  expect(files[2]?.diff).toContain("README.md");
});

test("list and label helpers describe multi-file diffs", () => {
  expect(listUnifiedDiffFilePaths(MULTI_FILE_DIFF)).toEqual([
    "src/one.ts",
    "src/two.ts",
    "README.md",
  ]);
  expect(formatUnifiedDiffFilesLabel(MULTI_FILE_DIFF)).toBe(
    "3 files · src/one.ts, src/two.ts, README.md",
  );
  expect(formatUnifiedDiffFilesLabel(MULTI_FILE_DIFF, { maxPaths: 2 })).toBe(
    "3 files · src/one.ts, src/two.ts, …",
  );
});

test("single-file diffs stay one entry", () => {
  const single = `diff --git a/only.ts b/only.ts
--- a/only.ts
+++ b/only.ts
@@ -1 +1 @@
-a
+b
`;
  expect(splitUnifiedDiffByFile(single)).toHaveLength(1);
  expect(formatUnifiedDiffFilesLabel(single)).toBe("only.ts");
});

test("rename diffs count as one file", () => {
  const rename = `diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
`;
  expect(listUnifiedDiffFilePaths(rename)).toEqual(["new.ts"]);
  expect(formatUnifiedDiffFilesLabel(rename)).toBe("new.ts");
});
