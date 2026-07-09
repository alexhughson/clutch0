import { expect, test } from "bun:test";
import {
  infoStringToFiletype,
  pathToFiletype,
  TreeSitterClient,
} from "@opentui/core";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "./SyntaxHighlightedContent";

test("registers Kotlin syntax highlighting with OpenTUI", async () => {
  expect(pathToFiletype("Example.kt")).toBe("kotlin");
  expect(pathToFiletype("Example.kts")).toBe("kotlin");
  expect(infoStringToFiletype("kotlin")).toBe("kotlin");

  const client = new TreeSitterClient({
    dataPath: await mkdtemp(join(tmpdir(), "clutch-tree-sitter-")),
  });

  try {
    const result = await client.highlightOnce(
      ["package demo", "", "fun main() {", '  println("hello")', "}"].join(
        "\n",
      ),
      "kotlin",
    );

    expect(result.error).toBeUndefined();
    expect(result.warning).toBeUndefined();
    expect(result.highlights?.length).toBeGreaterThan(0);
    expect(
      result.highlights?.some((highlight) => highlight[2] === "keyword"),
    ).toBe(true);
    expect(
      result.highlights?.some((highlight) => highlight[2] === "string"),
    ).toBe(true);
  } finally {
    await client.destroy();
  }
});
