import { readFile } from "node:fs/promises";
import {
  stripFrontmatter,
  type ResourceLoader,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { invariant } from "../../lib/invariant";
import { renderPrompt } from "../../lib/llm/prompts";

export async function buildAgentSkillKickoffPrompt({
  resourceLoader,
  skillName,
  userMessage,
}: {
  resourceLoader: ResourceLoader;
  skillName: string;
  userMessage: string;
}): Promise<string> {
  const skillBlock = await formatAgentSkillBlock(
    resolveAgentSkill({ resourceLoader, skillName }),
  );
  return `${skillBlock}\n\n${userMessage}`;
}

export function resolveAgentSkill({
  resourceLoader,
  skillName,
}: {
  resourceLoader: ResourceLoader;
  skillName: string;
}): Skill {
  const skill = resourceLoader
    .getSkills()
    .skills.find((candidate) => candidate.name === skillName);
  invariant(skill !== undefined, `Agent skill is not loaded: ${skillName}`);
  return skill;
}

async function formatAgentSkillBlock(skill: Skill): Promise<string> {
  assertSkillBlockAttribute("name", skill.name);
  assertSkillBlockAttribute("location", skill.filePath);

  const content = await readFile(skill.filePath, "utf8");
  return renderPrompt("agents/skill-kickoff.md", {
    baseDir: skill.baseDir,
    body: stripFrontmatter(content).trim(),
    location: skill.filePath,
    name: skill.name,
  });
}

function assertSkillBlockAttribute(name: string, value: string) {
  invariant(
    !value.includes('"'),
    `Agent skill ${name} cannot contain a double quote: ${value}`,
  );
}
