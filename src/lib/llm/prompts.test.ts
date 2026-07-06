import { expect, test } from "bun:test";
import {
  askCommandPromptDirective,
  buildPatchAwareSystemPrompt,
  renderPrompt,
} from "./prompts";

test("loads command prompts from prompt files", () => {
  expect(askCommandPromptDirective).toContain("/ask");
});

test("renders prompt templates and fails on missing variables", () => {
  expect(
    renderPrompt("context/command-user-message.md", {
      commandDirective: "Do the thing.",
      question: "What changed?",
    }),
  ).toBe("Do the thing.\n\nOriginal request:\nWhat changed?");

  expect(() =>
    renderPrompt("context/command-user-message.md", {
      commandDirective: "Do the thing.",
    }),
  ).toThrow(
    "Prompt context/command-user-message.md references missing variable",
  );
});

test("trims patch-aware prompt guidance to available workflow tools", () => {
  const editPrompt = buildPatchAwareSystemPrompt({
    toolNames: ["apply_patch"],
  });

  expect(editPrompt).toContain("apply_patch");
  expect(editPrompt).toContain("Patch construction:");
  expect(editPrompt).toContain("*** Begin Patch");
  expect(editPrompt).toContain("use `@@` hunks");
  expect(editPrompt).toContain(
    "one `*** Update File` operation can contain multiple `@@` hunks",
  );
  expect(editPrompt).toContain(
    "must describe one contiguous region of the current file",
  );
  expect(editPrompt).toContain(
    "Do not collect removed lines from different parts of a file into one large hunk.",
  );
  expect(editPrompt).toContain(
    "For moves or reorders inside a file, use separate hunks",
  );
  expect(editPrompt).toContain(
    "Do not claim the change has been applied before receiving a successful apply_patch tool result.",
  );
  expect(editPrompt).not.toContain("find_relevant_files");
  expect(editPrompt).not.toContain("add_context_files");
  expect(editPrompt).not.toContain("create_file");
  expect(editPrompt).not.toContain("run_shell_command");
  expect(editPrompt).not.toContain("Never put placeholders");

  const askPrompt = buildPatchAwareSystemPrompt({ toolNames: [] });

  expect(askPrompt).not.toContain("Workflow tools:");
  expect(askPrompt).not.toContain("apply_patch");
  expect(askPrompt).not.toContain("find_relevant_files");
  expect(askPrompt).not.toContain("tool-call interface");
});
