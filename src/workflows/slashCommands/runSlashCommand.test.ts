import { expect, test } from "bun:test";
import { setAgentAskSkillSlashCommands } from "../llmTools/toolRegistry";
import { parseLlmSlashCommandInvocation } from "../llmTools/toolRegistry";
import {
  runAddSlashCommand,
  runAgentAskSlashCommand,
  runAgentEditSlashCommand,
  runAgentSkillSlashCommand,
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
  expect(parseLlmSlashCommandInvocation("/agent-ask inspect")?.command.run).toBe(
    runAgentAskSlashCommand,
  );
  expect(parseLlmSlashCommandInvocation("/agent-edit fix")?.command.run).toBe(
    runAgentEditSlashCommand,
  );
});

test("agent skill slash commands route through the skill runner", () => {
  setAgentAskSkillSlashCommands([
    {
      allowedToolNames: [],
      description: "Use project review instructions.",
      name: "skill:project-review",
      promptDirective: "",
      title: "Skill: project-review",
    },
  ]);

  try {
    expect(
      parseLlmSlashCommandInvocation("/skill:project-review auth routing")
        ?.command.run,
    ).toBe(runAgentSkillSlashCommand);
    expect(canSubmitMessage("/skill:project-review")).toBe(true);
  } finally {
    setAgentAskSkillSlashCommands([]);
  }
});

test("tool slash commands keep their workflow runners", () => {
  expect(parseLlmSlashCommandInvocation("/cmd list files")?.command).toMatchObject(
    {
      promptDirective: expect.any(String),
      run: runShellCommandSlashCommand,
    },
  );
  expect(parseLlmSlashCommandInvocation("/find auth routing")?.command.run).toBe(
    runFindSlashCommand,
  );
  expect(parseLlmSlashCommandInvocation("/add src/a.ts")?.command.run).toBe(
    runAddSlashCommand,
  );
  expect(parseLlmSlashCommandInvocation("/edit update parser")?.command).toMatchObject(
    {
      allowedToolNames: [expect.any(String)],
      patchToolMode: "review",
      promptDirective: expect.any(String),
      run: runLlmSlashCommand,
    },
  );
  expect(parseLlmSlashCommandInvocation("/ask explain auth")?.command.run).toBe(
    runLlmSlashCommand,
  );
});
