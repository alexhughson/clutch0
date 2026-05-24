import { expect, test } from "bun:test";
import { fileFilterExamples, filterFiles } from "./fileFilter";

test("filters files with cmd+p-style matching", () => {
  for (const example of fileFilterExamples) {
    expect(filterFiles(example.input, example.filePaths)).toEqual(
      example.expected,
    );
  }
});
