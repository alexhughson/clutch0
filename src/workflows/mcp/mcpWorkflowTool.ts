import type { Tool, ToolCall } from "@earendil-works/pi-ai";
import { loadMcpConfig } from "../../lib/mcp/mcpConfig";
import { McpClientRegistry } from "../../lib/mcp/mcpClientRegistry";
import {
  loadDirectMcpTools,
  mcpToolParametersSchema,
} from "../../lib/mcp/mcpTools";
import type {
  McpRegisteredTool,
  McpToolOutput,
  McpToolRuntime,
} from "../../lib/mcp/mcpTypes";
import { renderPrompt } from "../../lib/llm/prompts";
import { invariant } from "../../lib/invariant";
import { recordSessionRuntimeEvent } from "../../store/appStore";
import type {
  LlmSlashCommand,
  LlmWorkflowToolController,
} from "../llmTools/types";

export type McpWorkflowResources = {
  close?: () => Promise<void> | void;
  slashCommands: readonly LlmSlashCommand[];
  toolControllers: readonly LlmWorkflowToolController[];
};

export async function loadMcpWorkflowResources({
  onCloseReady,
  root = process.cwd(),
  runtime,
}: {
  onCloseReady?: (close: () => Promise<void> | void) => void;
  root?: string;
  runtime?: McpToolRuntime;
} = {}): Promise<McpWorkflowResources> {
  const config = loadMcpConfig({ root });
  const mcpRuntime = runtime ?? new McpClientRegistry(config);
  if (mcpRuntime.close !== undefined) {
    onCloseReady?.(() => mcpRuntime.close?.());
  }
  const registeredTools = await loadDirectMcpTools({
    config,
    runtime: mcpRuntime,
  });

  return createMcpWorkflowResources({
    runtime: mcpRuntime,
    tools: registeredTools,
  });
}

export function createMcpWorkflowResources({
  runtime,
  tools,
}: {
  runtime: McpToolRuntime;
  tools: readonly McpRegisteredTool[];
}): McpWorkflowResources {
  return {
    ...(runtime.close === undefined ? {} : { close: () => runtime.close?.() }),
    slashCommands: createMcpSlashCommands(tools),
    toolControllers: tools.map((tool) =>
      createMcpWorkflowToolController({ runtime, tool }),
    ),
  };
}

function createMcpWorkflowToolController({
  runtime,
  tool,
}: {
  runtime: McpToolRuntime;
  tool: McpRegisteredTool;
}): LlmWorkflowToolController {
  return {
    resultKind: "mcp-tool-output",
    tool: createMcpTool(tool),
    handleResult({ actions, requestId, result }) {
      invariant(
        result.kind === "mcp-tool-output",
        `${tool.toolName} cannot handle ${result.kind} results`,
      );

      actions.mcp.finishToolCall({
        output: result.output,
        requestId,
        responseText: result.responseText,
      });
    },
    async routeToolCall({ signal, toolCall }) {
      invariant(
        toolCall.name === tool.toolName,
        `${tool.toolName} routed unexpected tool ${toolCall.name}`,
      );

      const arguments_ = parseMcpToolArguments(toolCall);
      recordSessionRuntimeEvent({
        kind: "mcp-tool.started",
        serverName: tool.serverName,
        toolName: tool.name,
        workflowToolName: tool.toolName,
      });
      try {
        const output = await runtime.callTool({
          arguments: arguments_,
          serverName: tool.serverName,
          signal,
          toolName: tool.name,
        });
        recordSessionRuntimeEvent({
          isError: output.isError,
          kind: "mcp-tool.finished",
          serverName: tool.serverName,
          toolName: tool.name,
          workflowToolName: tool.toolName,
        });
        return {
          kind: "mcp-tool-output" as const,
          output,
        };
      } catch (error) {
        recordSessionRuntimeEvent({
          errorMessage: error instanceof Error ? error.message : String(error),
          kind: "mcp-tool.failed",
          serverName: tool.serverName,
          toolName: tool.name,
          workflowToolName: tool.toolName,
        });
        throw error;
      }
    },
  };
}

function createMcpTool(tool: McpRegisteredTool): Tool {
  return {
    description:
      tool.description ??
      `Call MCP tool ${tool.name} from server ${tool.serverName}.`,
    name: tool.toolName,
    parameters: mcpToolParametersSchema(tool.inputSchema),
  };
}

function parseMcpToolArguments(toolCall: ToolCall): Record<string, unknown> {
  invariant(
    toolCall.arguments !== null &&
      typeof toolCall.arguments === "object" &&
      !Array.isArray(toolCall.arguments),
    `${toolCall.name} arguments must be an object.`,
  );
  return toolCall.arguments;
}

function createMcpSlashCommands(
  tools: readonly McpRegisteredTool[],
): LlmSlashCommand[] {
  const byServer = new Map<string, McpRegisteredTool[]>();
  for (const tool of tools) {
    const serverTools = byServer.get(tool.serverName) ?? [];
    serverTools.push(tool);
    byServer.set(tool.serverName, serverTools);
  }

  const commands: LlmSlashCommand[] = [];
  for (const [serverName, serverTools] of byServer) {
    const slashCommandName = serverTools[0]?.slashCommandName;
    invariant(
      slashCommandName !== undefined,
      `MCP server ${serverName} has no slash command name.`,
    );

    commands.push({
      allowedToolNames: serverTools.map((tool) => tool.toolName),
      description: `Call a direct MCP tool from ${serverName}.`,
      name: slashCommandName,
      promptDirective: renderPrompt("commands/mcp-server.md", {
        serverName,
        toolNames: serverTools.map((tool) => tool.name).join(", "),
      }),
      title: `MCP: ${serverName}`,
    });

    for (const tool of serverTools) {
      commands.push({
        allowedToolNames: [tool.toolName],
        description: `Call MCP tool ${tool.name} from ${tool.serverName}.`,
        name: tool.slashToolName,
        promptDirective: renderPrompt("commands/mcp-tool.md", {
          serverName: tool.serverName,
          toolName: tool.name,
        }),
        title: `MCP: ${tool.serverName}:${tool.name}`,
      });
    }
  }

  assertUniqueMcpSlashCommands(commands);
  return commands;
}

function assertUniqueMcpSlashCommands(commands: readonly LlmSlashCommand[]) {
  const names = new Set<string>();
  for (const command of commands) {
    invariant(
      !names.has(command.name),
      `Duplicate MCP slash command name: ${command.name}`,
    );
    names.add(command.name);
  }
}

export type McpWorkflowToolResult = {
  kind: "mcp-tool-output";
  output: McpToolOutput;
};
