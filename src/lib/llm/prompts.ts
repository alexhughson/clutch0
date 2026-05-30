import { readFileSync } from "node:fs";

export const defaultSystemPrompt = readPrompt("system/default.md");
export const patchAwareSystemPrompt = readPrompt("system/patch-aware.md");

export const askCommandPromptDirective = readPrompt("commands/ask.md");
export const createCommandPromptDirective = readPrompt("commands/create.md");
export const findCommandPromptDirective = readPrompt("commands/find.md");
export const editCommandPromptDirective = readPrompt("commands/edit.md");
export const shellCommandPromptDirective = readPrompt("commands/cmd.md");

export const contextItemSummarySystemPrompt = readPrompt(
  "context-summary/system.md",
);

export function renderPrompt(
  fileName: string,
  variables: Record<string, string>,
): string {
  return readPrompt(fileName).replace(
    /{{\s*([A-Za-z0-9_-]+)\s*}}/g,
    (match, key: string) => {
      const value = variables[key];
      if (value === undefined) {
        throw new Error(
          `Prompt ${fileName} references missing variable: ${key}`,
        );
      }

      return value;
    },
  );
}

function readPrompt(fileName: string): string {
  return readFileSync(
    new URL(`../../prompts/${fileName}`, import.meta.url),
    "utf8",
  ).trim();
}
