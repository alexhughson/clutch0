import { readFileSync } from "node:fs";

export const defaultSystemPrompt = readPrompt("default-system.md");
export const patchAwareSystemPrompt = readPrompt("patch-aware-system.md");

function readPrompt(fileName: string): string {
  return readFileSync(
    new URL(`../../prompts/${fileName}`, import.meta.url),
    "utf8",
  ).trim();
}
