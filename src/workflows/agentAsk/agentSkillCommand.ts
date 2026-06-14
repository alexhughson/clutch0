import { invariant } from "../../lib/invariant";

export const AGENT_SKILL_SLASH_COMMAND_PREFIX = "skill:";

export function formatAgentSkillSlashCommandName(skillName: string): string {
  invariant(skillName.length > 0, "Agent skill name must not be empty.");
  return `${AGENT_SKILL_SLASH_COMMAND_PREFIX}${skillName}`;
}

export function parseAgentSkillSlashCommandName(commandName: string): string {
  invariant(
    commandName.startsWith(AGENT_SKILL_SLASH_COMMAND_PREFIX),
    `Expected agent skill command name to start with ${AGENT_SKILL_SLASH_COMMAND_PREFIX}: ${commandName}`,
  );

  const skillName = commandName.slice(AGENT_SKILL_SLASH_COMMAND_PREFIX.length);
  invariant(
    skillName.length > 0,
    "Agent skill command name is missing a skill.",
  );
  return skillName;
}
