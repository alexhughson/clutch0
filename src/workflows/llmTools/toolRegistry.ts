import type { Tool, ToolCall } from "@earendil-works/pi-ai";
import { findFilesWorkflowTool } from "../findFiles/findFilesTool";
import { patchWorkflowTool } from "./patchWorkflowTool";
import type {
  LlmSlashCommand,
  LlmWorkflowToolController,
  LlmWorkflowToolResult,
} from "./types";

export type LlmSlashCommandInvocation = {
  command: LlmSlashCommand;
  input: string;
};

const workflowToolControllers: readonly LlmWorkflowToolController[] = [
  findFilesWorkflowTool,
  patchWorkflowTool,
];

const askSlashCommand: LlmSlashCommand = {
  allowedToolNames: [],
  description: "Ask a normal question without allowing workflow tools.",
  name: "ask",
  promptDirective:
    "The user invoked /ask. Answer the user's question directly. Do not call workflow tools.",
  title: "Ask a question",
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

export function getLlmSlashCommands(): LlmSlashCommand[] {
  return [
    askSlashCommand,
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
  const controllers = getLlmWorkflowToolControllers({ allowedToolNames });

  for (const toolCall of toolCalls) {
    for (const controller of controllers) {
      const result = await controller.routeToolCall({ root, toolCall });
      if (result !== null) {
        return result;
      }
    }
  }

  return null;
}

function getLlmWorkflowToolControllers({
  allowedToolNames,
}: {
  allowedToolNames?: readonly string[];
} = {}): readonly LlmWorkflowToolController[] {
  if (allowedToolNames === undefined) {
    return workflowToolControllers;
  }

  const allowedToolNameSet = new Set(allowedToolNames);
  return workflowToolControllers.filter((controller) =>
    allowedToolNameSet.has(controller.tool.name),
  );
}
