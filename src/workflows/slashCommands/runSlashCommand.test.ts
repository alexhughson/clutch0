import { expect, test } from "bun:test";
import { parseLlmSlashCommandInvocation } from "../llmTools/toolRegistry";
import {
  runAddSlashCommand,
  runAgentSlashCommand,
  runConfigSlashCommand,
  runFindSlashCommand,
  runLlmSlashCommand,
  runSaySlashCommand,
  runShellCommandSlashCommand,
  runShowContextSlashCommand,
} from "./slashCommandRunners";
import { canSubmitMessage } from "./runSlashCommand";

test("plain text can be submitted", () => {
  expect(canSubmitMessage(" explain the app ")).toBe(true);
});

test("empty submissions are ignored", () => {
  expect(canSubmitMessage("  ")).toBe(false);
});

test("slash commands allow empty input only when configured", () => {
  expect(canSubmitMessage("/show-context")).toBe(true);
  expect(canSubmitMessage("/config")).toBe(true);
  expect(canSubmitMessage("/say")).toBe(true);
  expect(canSubmitMessage("/ask")).toBe(false);
  expect(canSubmitMessage("/find")).toBe(false);
});

test("slash commands route through a single run handler", () => {
  expect(parseLlmSlashCommandInvocation("/show-context")?.command.run).toBe(
    runShowContextSlashCommand,
  );
  expect(parseLlmSlashCommandInvocation("/config")?.command.run).toBe(
    runConfigSlashCommand,
  );
  expect(parseLlmSlashCommandInvocation("/say note")?.command.run).toBe(
    runSaySlashCommand,
  );
  expect(parseLlmSlashCommandInvocation("/agent inspect")?.command.run).toBe(
    runAgentSlashCommand,
  );
});

test("tool slash commands keep their workflow runners", () => {
  expect(
    parseLlmSlashCommandInvocation("/cmd list files")?.command,
  ).toMatchObject({
    promptDirective: expect.any(String),
    run: runShellCommandSlashCommand,
  });
  expect(
    parseLlmSlashCommandInvocation("/find auth routing")?.command.run,
  ).toBe(runFindSlashCommand);
  expect(parseLlmSlashCommandInvocation("/add src/a.ts")?.command.run).toBe(
    runAddSlashCommand,
  );
  expect(
    parseLlmSlashCommandInvocation("/edit update parser")?.command,
  ).toMatchObject({
    allowedToolNames: [expect.any(String)],
    patchToolMode: "review",
    promptDirective: expect.any(String),
    run: runLlmSlashCommand,
  });
  expect(parseLlmSlashCommandInvocation("/ask explain auth")?.command.run).toBe(
    runLlmSlashCommand,
  );
});
