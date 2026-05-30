import type { AppActions } from "../../app/appTypes";
import type { Tool, ToolCall } from "@earendil-works/pi-ai";
import { createFileWorkflowTool } from "../createFile/createFileWorkflowTool";
import { findFilesWorkflowTool } from "../findFiles/findFilesTool";
import { invariant } from "../../lib/invariant";
import { askCommandPromptDirective } from "../../lib/llm/prompts";
import { patchWorkflowTool } from "./patchWorkflowTool";
import { shellCommandWorkflowTool } from "./shellCommandWorkflowTool";
import type {
  LlmSlashCommand,
  LlmWorkflowToolController,
  LlmWorkflowToolResult,
} from "./types";

export type LlmSlashCommandInvocation = {
  command: LlmSlashCommand;
  input: string;
};

const workflowToolControllers = createWorkflowToolControllers([
  createFileWorkflowTool,
  findFilesWorkflowTool,
  patchWorkflowTool,
  shellCommandWorkflowTool,
]);

let agentAskSkillSlashCommands: readonly LlmSlashCommand[] = [];

const agentAskSlashCommand: LlmSlashCommand = {
  allowedToolNames: [],
  description:
    "Ask a long-running pi sub-agent and save its session as context.",
  name: "agent-ask",
  promptDirective: "",
  taskKind: "agent-ask",
  title: "Ask pi agent",
};

const askSlashCommand: LlmSlashCommand = {
  allowedToolNames: [],
  description: "Ask a normal question without allowing workflow tools.",
  name: "ask",
  promptDirective: askCommandPromptDirective,
  title: "Ask a question",
};

const showContextSlashCommand: LlmSlashCommand = {
  allowedToolNames: [],
  description: "Preview the rendered LLM context for debugging.",
  name: "show-context",
  promptDirective: "",
  taskKind: "show-context",
  title: "Show rendered context",
};

export function getLlmWorkflowTools({
  allowedToolNames,
}: {
  allowedToolNames?: readonly string[];
} = {}): Tool[] {
  return getLlmWorkflowToolControllers({ allowedToolNames }).map(
    (controller) => controller.tool,
  );
}

export function setAgentAskSkillSlashCommands(
  commands: readonly LlmSlashCommand[],
) {
  assertNoSlashCommandNameCollisions(commands);
  agentAskSkillSlashCommands = [...commands];
}

export function getLlmSlashCommands(): LlmSlashCommand[] {
  return [
    askSlashCommand,
    agentAskSlashCommand,
    ...agentAskSkillSlashCommands,
    showContextSlashCommand,
    ...workflowToolControllers.flatMap((controller) =>
      controller.slashCommand === undefined
        ? []
        : [
            {
              ...controller.slashCommand,
              allowedToolNames: [controller.tool.name],
            },
          ],
    ),
  ];
}

export function getLlmSlashCommand(name: string): LlmSlashCommand | null {
  return getLlmSlashCommands().find((command) => command.name === name) ?? null;
}

export function parseLlmSlashCommandInvocation(
  message: string,
): LlmSlashCommandInvocation | null {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(message.trim());
  if (match === null) {
    return null;
  }

  const command = getLlmSlashCommand(match[1]);
  if (command === null) {
    return null;
  }

  return {
    command,
    input: match[2]?.trim() ?? "",
  };
}

export async function routeLlmWorkflowToolCalls({
  allowedToolNames,
  root,
  toolCalls,
}: {
  allowedToolNames?: readonly string[];
  root?: string;
  toolCalls: readonly ToolCall[];
}): Promise<LlmWorkflowToolResult | null> {
  if (toolCalls.length === 0) {
    return null;
  }

  const controllers = getLlmWorkflowToolControllers({ allowedToolNames });
  const controllersByToolName = new Map(
    controllers.map((controller) => [controller.tool.name, controller]),
  );

  for (const toolCall of toolCalls) {
    const controller = controllersByToolName.get(toolCall.name);
    invariant(
      controller !== undefined,
      `LLM called unregistered or disallowed workflow tool: ${toolCall.name}`,
    );

    return await controller.routeToolCall({ root, toolCall });
  }

  return null;
}

export function handleLlmWorkflowResult({
  actions,
  requestId,
  result,
}: {
  actions: AppActions;
  requestId: number;
  result: LlmWorkflowToolResult & { responseText: string };
}) {
  const controller = workflowToolControllers.find(
    (candidate) => candidate.resultKind === result.kind,
  );
  invariant(
    controller !== undefined,
    `No workflow tool controller handles result kind: ${result.kind}`,
  );

  controller.handleResult({ actions, requestId, result });
}

function getLlmWorkflowToolControllers({
  allowedToolNames,
}: {
  allowedToolNames?: readonly string[];
} = {}): readonly LlmWorkflowToolController[] {
  if (allowedToolNames === undefined) {
    return workflowToolControllers.filter(
      (controller) => controller.enabledByDefault !== false,
    );
  }

  const controllersByName = new Map(
    workflowToolControllers.map((controller) => [
      controller.tool.name,
      controller,
    ]),
  );

  return allowedToolNames.map((toolName) => {
    const controller = controllersByName.get(toolName);
    invariant(
      controller !== undefined,
      `Allowed workflow tool is not registered: ${toolName}`,
    );
    return controller;
  });
}

function assertNoSlashCommandNameCollisions(
  commands: readonly LlmSlashCommand[],
) {
  const existingNames = new Set(
    getBaseLlmSlashCommands().map((command) => command.name),
  );

  for (const command of commands) {
    invariant(
      !existingNames.has(command.name),
      `Duplicate slash command name: ${command.name}`,
    );
    existingNames.add(command.name);
  }
}

function getBaseLlmSlashCommands(): LlmSlashCommand[] {
  return [
    askSlashCommand,
    agentAskSlashCommand,
    showContextSlashCommand,
    ...workflowToolControllers.flatMap((controller) =>
      controller.slashCommand === undefined
        ? []
        : [
            {
              ...controller.slashCommand,
              allowedToolNames: [controller.tool.name],
            },
          ],
    ),
  ];
}

function createWorkflowToolControllers(
  controllers: readonly LlmWorkflowToolController[],
): readonly LlmWorkflowToolController[] {
  const toolNames = new Set<string>();
  const resultKinds = new Set<LlmWorkflowToolResult["kind"]>();

  for (const controller of controllers) {
    invariant(
      !toolNames.has(controller.tool.name),
      `Duplicate workflow tool name: ${controller.tool.name}`,
    );
    invariant(
      !resultKinds.has(controller.resultKind),
      `Duplicate workflow result kind: ${controller.resultKind}`,
    );
    toolNames.add(controller.tool.name);
    resultKinds.add(controller.resultKind);
  }

  return controllers;
}
