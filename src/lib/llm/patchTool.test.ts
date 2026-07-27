import type { LlmToolCall } from "./types";
import { expect, test } from "bun:test";
import { applyPatchTool, patchProposalFromToolCall } from "./patchTool";

const patch = [
  "*** Begin Patch",
  "*** Update File: README.md",
  "@@",
  "-old",
  "+new",
  "*** End Patch",
].join("\n");

test("apply_patch JSON fallback uses Codex input argument", () => {
  const serialized = JSON.stringify(applyPatchTool);

  expect(serialized).toContain('"input"');
  expect(serialized).not.toContain('"patch"');
  expect(serialized).not.toContain('"summary"');
});

test("parses Codex input apply_patch tool calls", () => {
  expect(
    patchProposalFromToolCall({
      arguments: { input: patch },
      id: "tool-1",
      name: "apply_patch",
      type: "toolCall",
    } satisfies LlmToolCall),
  ).toEqual({
    patch,
    summary: "Apply patch",
    toolCallId: "tool-1",
  });
});

test("keeps legacy patch and summary apply_patch tool calls parseable", () => {
  expect(
    patchProposalFromToolCall({
      arguments: { patch, summary: "Update README" },
      id: "tool-1",
      name: "apply_patch",
      type: "toolCall",
    } satisfies LlmToolCall),
  ).toEqual({
    patch,
    summary: "Update README",
    toolCallId: "tool-1",
  });
});
