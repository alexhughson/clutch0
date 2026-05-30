import { expect, test } from "bun:test";
import { askCommandPromptDirective, renderPrompt } from "./prompts";

test("loads command prompts from prompt files", () => {
  expect(askCommandPromptDirective).toContain("/ask");
});

test("renders prompt templates and fails on missing variables", () => {
  expect(
    renderPrompt("context/command-user-message.md", {
      commandDirective: "Do the thing.",
      question: "What changed?",
    }),
  ).toBe("Do the thing.\n\nUser request:\nWhat changed?");

  expect(() =>
    renderPrompt("context/command-user-message.md", {
      commandDirective: "Do the thing.",
    }),
  ).toThrow(
    "Prompt context/command-user-message.md references missing variable",
  );
});
