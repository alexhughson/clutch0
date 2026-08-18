import type { AppActions } from "../../app/appTypes";
import type { LlmTool, LlmToolCall } from "../../lib/llm/types";
import { addFilesWorkflowTool } from "../addFiles/addFilesWorkflowTool";
import { createFileWorkflowTool } from "../createFile/createFileWorkflowTool";
import { findFilesWorkflowTool } from "../findFiles/findFilesTool";
import { invariant } from "../../lib/invariant";
import { askCommandPromptDirective } from "../../lib/llm/prompts";
import {
  runAgentSlashCommand,
  runConfigSlashCommand,
  runAddSlashCommand,
  runFindSlashCommand,
  runLlmSlashCommand,
  runSaySlashCommand,
  runShellCommandSlashCommand,
  runShowContextSlashCommand,
} from "../slashCommands/slashCommandRunners";
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
  addFilesWorkflowTool,
  createFileWorkflowTool,
  findFilesWorkflowTool,
  patchWorkflowTool,
  shellCommandWorkflowTool,
]);

const agentSlashCommand: LlmSlashCommand = {
  allowedToolNames: [],
  description:
    "Run a Cursor agent in a sandbox, save its session as context, and review diffs before applying.",
  name: "agent",
  promptDirective: "",
  run: runAgentSlashCommand,
  title: "Run agent",
};

const askSlashCommand: LlmSlashCommand = {
  allowedToolNames: [],
  description: "Ask a normal question without allowing workflow tools.",
  name: "ask",
  promptDirective: askCommandPromptDirective,
  run: runLlmSlashCommand,
  title: "Ask a question",
};

const configSlashCommand: LlmSlashCommand = {
  allowedToolNames: [],
  allowsEmptyInput: true,
  description: "Configure Clutch model providers, models, and API keys.",
  name: "config",
  promptDirective: "",
  run: runConfigSlashCommand,
  title: "Configure Clutch",
};

const showContextSlashCommand: LlmSlashCommand = {
  allowedToolNames: [],
  allowsEmptyInput: true,
  description: "Preview the rendered LLM context for debugging.",
  name: "show-context",
  promptDirective: "",
  run: runShowContextSlashCommand,
  title: "Show rendered context",
};

const saySlashCommand: LlmSlashCommand = {
  allowedToolNames: [],
  allowsEmptyInput: true,
  description: "Add editable user text directly to context.",
  name: "say",
  promptDirective: "",
  run: runSaySlashCommand,
  title: "Add editable context text",
};

export function getLlmWorkflowTools({
  allowedToolNames,
}: {
  allowedToolNames?: readonly string[];
} = {}): LlmTool[] {
  return getLlmWorkflowToolControllers({ allowedToolNames }).map(
    (controller) => controller.tool,
  );
}

export function getLlmSlashCommands(): LlmSlashCommand[] {
  return [
    askSlashCommand,
    agentSlashCommand,
    configSlashCommand,
    showContextSlashCommand,
    saySlashCommand,
    ...workflowToolControllers.flatMap((controller) =>
      controller.slashCommand === undefined
        ? []
        : [slashCommandFromController(controller)],
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
  signal,
  toolCalls,
}: {
  allowedToolNames?: readonly string[];
  root?: string;
  signal?: AbortSignal;
  toolCalls: readonly LlmToolCall[];
}): Promise<LlmWorkflowToolResult | null> {
  if (toolCalls.length === 0) {
    return null;
  }
  invariant(
    toolCalls.length === 1,
    `LLM workflow routing accepts exactly one tool call per response; received ${toolCalls.length}.`,
  );

  const controllers = getLlmWorkflowToolControllers({ allowedToolNames });
  const controllersByToolName = new Map(
    controllers.map((controller) => [controller.tool.name, controller]),
  );

  const [toolCall] = toolCalls;
  invariant(toolCall !== undefined, "Expected one LLM workflow tool call.");

  const controller = controllersByToolName.get(toolCall.name);
  invariant(
    controller !== undefined,
    `LLM called unregistered or disallowed workflow tool: ${toolCall.name}`,
  );

  return await controller.routeToolCall({ root, signal, toolCall });
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
  const controller = [...workflowToolControllers].find(
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

function assertNoWorkflowToolNameCollisions(
  controllers: readonly LlmWorkflowToolController[],
) {
  const existingNames = new Set(
    workflowToolControllers.map((controller) => controller.tool.name),
  );
  const newNames = new Set<string>();

  for (const controller of controllers) {
    invariant(
      !existingNames.has(controller.tool.name),
      `Duplicate workflow tool name: ${controller.tool.name}`,
    );
    invariant(
      !newNames.has(controller.tool.name),
      `Duplicate workflow tool name: ${controller.tool.name}`,
    );
    newNames.add(controller.tool.name);
  }
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

function slashCommandFromController(
  controller: LlmWorkflowToolController,
): LlmSlashCommand {
  invariant(
    controller.slashCommand !== undefined,
    `Workflow tool ${controller.tool.name} is missing slash command metadata.`,
  );

  return {
    ...controller.slashCommand,
    allowedToolNames: [controller.tool.name],
    run: slashCommandRunnerForController(controller),
  };
}

function slashCommandRunnerForController(
  controller: LlmWorkflowToolController,
): LlmSlashCommand["run"] {
  if (controller === addFilesWorkflowTool) {
    return runAddSlashCommand;
  }
  if (controller === findFilesWorkflowTool) {
    return runFindSlashCommand;
  }
  if (controller === shellCommandWorkflowTool) {
    return runShellCommandSlashCommand;
  }
  return controller.runSlashCommand ?? runLlmSlashCommand;
}
