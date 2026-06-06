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
import type {
  LlmSlashCommand,
  LlmWorkflowToolController,
} from "../llmTools/types";

export type McpWorkflowResources = {
  slashCommands: readonly LlmSlashCommand[];
  toolControllers: readonly LlmWorkflowToolController[];
};

export async function loadMcpWorkflowResources({
  root = process.cwd(),
  runtime,
}: {
  root?: string;
  runtime?: McpToolRuntime;
} = {}): Promise<McpWorkflowResources> {
  const config = loadMcpConfig({ root });
  const mcpRuntime = runtime ?? new McpClientRegistry(config);
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
    async routeToolCall({ toolCall }) {
      invariant(
        toolCall.name === tool.toolName,
        `${tool.toolName} routed unexpected tool ${toolCall.name}`,
      );

      return {
        kind: "mcp-tool-output" as const,
        output: await runtime.callTool({
          arguments: parseMcpToolArguments(toolCall),
          serverName: tool.serverName,
          toolName: tool.name,
        }),
      };
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
