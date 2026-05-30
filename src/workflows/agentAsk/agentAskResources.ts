import {
  DefaultResourceLoader,
  getAgentDir,
  type AgentSession,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { invariant } from "../../lib/invariant";
import type { LlmSlashCommand } from "../llmTools/types";

const AGENT_ASK_READ_ONLY_BUILTIN_TOOLS = [
  "read",
  "grep",
  "find",
  "ls",
] as const;

export async function createAgentAskResourceLoader({
  agentDir = getAgentDir(),
  noExtensions = false,
  root = process.cwd(),
}: {
  agentDir?: string;
  noExtensions?: boolean;
  root?: string;
} = {}): Promise<ResourceLoader> {
  const resourceLoader = new DefaultResourceLoader({
    agentDir,
    cwd: root,
    noExtensions,
  });
  await resourceLoader.reload();
  assertAgentAskResourcesLoaded(resourceLoader);
  return resourceLoader;
}

export async function loadAgentAskSkillSlashCommands({
  agentDir = getAgentDir(),
  root = process.cwd(),
}: {
  agentDir?: string;
  root?: string;
} = {}): Promise<LlmSlashCommand[]> {
  const resourceLoader = await createAgentAskResourceLoader({
    agentDir,
    noExtensions: true,
    root,
  });

  return resourceLoader.getSkills().skills.map((skill) => ({
    allowedToolNames: [],
    description: skill.description,
    name: `skill:${skill.name}`,
    promptDirective: "",
    taskKind: "agent-skill" as const,
    title: `Skill: ${skill.name}`,
  }));
}

export function activateAgentAskTools(session: AgentSession) {
  session.setActiveToolsByName(
    getAgentAskActiveToolNames({
      activeToolNames: session.getActiveToolNames(),
      allToolNames: session.getAllTools().map((tool) => tool.name),
    }),
  );
}

export function getAgentAskActiveToolNames({
  activeToolNames,
  allToolNames,
}: {
  activeToolNames: readonly string[];
  allToolNames: readonly string[];
}): string[] {
  const allToolNameSet = new Set(allToolNames);
  const nextActiveToolNameSet = new Set(activeToolNames);

  for (const toolName of AGENT_ASK_READ_ONLY_BUILTIN_TOOLS) {
    invariant(
      allToolNameSet.has(toolName),
      `Agent ask expected built-in tool to be available: ${toolName}`,
    );
    nextActiveToolNameSet.add(toolName);
  }

  return [...nextActiveToolNameSet];
}

function assertAgentAskResourcesLoaded(resourceLoader: ResourceLoader) {
  const extensionErrors = resourceLoader.getExtensions().errors;
  invariant(
    extensionErrors.length === 0,
    `Agent ask extension load failed: ${extensionErrors
      .map((error) => `${error.path}: ${error.error}`)
      .join("\n")}`,
  );

  const skillErrors = resourceLoader
    .getSkills()
    .diagnostics.filter((diagnostic) => diagnostic.type === "error");
  invariant(
    skillErrors.length === 0,
    `Agent ask skill load failed: ${skillErrors
      .map((diagnostic) =>
        diagnostic.path === undefined
          ? diagnostic.message
          : `${diagnostic.path}: ${diagnostic.message}`,
      )
      .join("\n")}`,
  );
}
