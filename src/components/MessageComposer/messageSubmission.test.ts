import { expect, test } from "bun:test";
import { setAgentAskSkillSlashCommands } from "../../workflows/llmTools/toolRegistry";
import { getSubmissionIntent } from "./messageSubmission";

test("plain text submits an LLM request", () => {
  expect(getSubmissionIntent(" explain the app ")).toEqual({
    allowedToolNames: undefined,
    commandDirective: undefined,
    kind: "llm-request",
    patchToolMode: undefined,
    question: "explain the app",
  });
});

test("empty submissions are ignored", () => {
  expect(getSubmissionIntent("  ")).toBeNull();
});

test("slash commands route to domain intents", () => {
  expect(getSubmissionIntent("/show-context")).toEqual({
    kind: "show-context",
    question: "",
  });
  expect(getSubmissionIntent("/config")).toEqual({ kind: "config" });
  expect(getSubmissionIntent("/say note")).toEqual({
    kind: "say",
    text: "note",
  });
  expect(getSubmissionIntent("/agent-ask inspect")).toEqual({
    kind: "agent-ask",
    prompt: "inspect",
  });
  expect(getSubmissionIntent("/agent-edit fix")).toEqual({
    kind: "agent-edit",
    prompt: "fix",
  });
});

test("agent skill slash commands route to structured skill intent", () => {
  setAgentAskSkillSlashCommands([
    {
      allowedToolNames: [],
      description: "Use project review instructions.",
      name: "skill:project-review",
      promptDirective: "",
      taskKind: "agent-skill",
      title: "Skill: project-review",
    },
  ]);

  try {
    expect(getSubmissionIntent("/skill:project-review auth routing")).toEqual({
      kind: "agent-skill",
      prompt: "auth routing",
      skillName: "project-review",
    });
    expect(getSubmissionIntent("/skill:project-review")).toEqual({
      kind: "agent-skill",
      prompt: "",
      skillName: "project-review",
    });
  } finally {
    setAgentAskSkillSlashCommands([]);
  }
});

test("tool slash commands keep their allowed tool rail", () => {
  expect(getSubmissionIntent("/cmd list files")).toEqual({
    commandDirective: expect.any(String),
    kind: "shell-command",
    prompt: "list files",
  });
  expect(getSubmissionIntent("/edit update parser")).toEqual({
    allowedToolNames: [expect.any(String)],
    commandDirective: expect.any(String),
    kind: "llm-request",
    patchToolMode: "review",
    question: "update parser",
  });
});
