import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  getAgentAskActiveToolNames,
  loadAgentAskSkillSlashCommands,
} from "./agentAskResources";

test("loads pi skills as agent-ask slash commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-agent-skills-root-"));
  const agentDir = await mkdtemp(join(tmpdir(), "clutch-agent-skills-agent-"));
  const skillDir = join(root, ".pi", "skills", "project-review");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    [
      "---",
      "name: project-review",
      "description: Review project-specific conventions.",
      "---",
      "# Project Review",
      "",
      "Check project conventions.",
    ].join("\n"),
  );

  const commands = await loadAgentAskSkillSlashCommands({ agentDir, root });

  expect(commands).toContainEqual({
    allowedToolNames: [],
    description: "Review project-specific conventions.",
    name: "skill:project-review",
    promptDirective: "",
    taskKind: "agent-skill",
    title: "Skill: project-review",
  });
});

test("agent ask activates read-only builtins while preserving extension tools", () => {
  expect(
    getAgentAskActiveToolNames({
      activeToolNames: ["project_lookup"],
      allToolNames: [
        "read",
        "bash",
        "edit",
        "write",
        "grep",
        "find",
        "ls",
        "project_lookup",
      ],
    }),
  ).toEqual(["project_lookup", "read", "grep", "find", "ls"]);
});

test("agent edit activates writable builtins in the sandbox", () => {
  expect(
    getAgentAskActiveToolNames({
      activeToolNames: ["project_lookup"],
      allToolNames: [
        "read",
        "bash",
        "edit",
        "write",
        "grep",
        "find",
        "ls",
        "project_lookup",
      ],
      mode: "edit",
    }),
  ).toEqual([
    "project_lookup",
    "read",
    "grep",
    "find",
    "ls",
    "bash",
    "edit",
    "write",
  ]);
});

test("agent ask fails when expected read-only builtins are unavailable", () => {
  expect(() =>
    getAgentAskActiveToolNames({
      activeToolNames: [],
      allToolNames: ["read", "grep", "find"],
    }),
  ).toThrow("Agent ask expected built-in tool to be available: ls");
});
