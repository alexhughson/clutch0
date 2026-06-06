import type { TSchema } from "@earendil-works/pi-ai";
import { invariant } from "../invariant";
import type {
  McpDirectToolsSetting,
  McpRegisteredTool,
  McpServerConfig,
  McpToolMetadata,
  McpToolPrefixSetting,
  McpToolRuntime,
  ResolvedMcpConfig,
} from "./mcpTypes";

export async function loadDirectMcpTools({
  config,
  runtime,
}: {
  config: ResolvedMcpConfig;
  runtime: McpToolRuntime;
}): Promise<McpRegisteredTool[]> {
  const registeredTools: McpRegisteredTool[] = [];

  for (const server of config.servers) {
    const directTools = server.directTools ?? config.settings.directTools;
    if (directTools === false) {
      continue;
    }

    const tools = await runtime.listTools(server.name);
    registeredTools.push(
      ...tools
        .filter((tool) => isDirectToolEnabled({ directTools, server, tool }))
        .map((tool) =>
          registerMcpTool({
            tool,
            toolPrefix: config.settings.toolPrefix,
          }),
        ),
    );
  }

  assertUniqueRegisteredMcpTools(registeredTools);
  return registeredTools;
}

export function mcpToolParametersSchema(
  inputSchema: Record<string, unknown>,
): TSchema {
  invariant(
    inputSchema.type === "object",
    'MCP tool inputSchema.type must be "object".',
  );
  return inputSchema as TSchema;
}

function registerMcpTool({
  tool,
  toolPrefix,
}: {
  tool: McpToolMetadata;
  toolPrefix: McpToolPrefixSetting;
}): McpRegisteredTool {
  const prefixedToolName = getPrefixedMcpToolName({
    serverName: tool.serverName,
    toolName: tool.name,
    toolPrefix,
  });

  return {
    ...tool,
    slashCommandName: `mcp:${sanitizeSlashCommandSegment(tool.serverName)}`,
    slashToolName: `mcp:${sanitizeSlashCommandSegment(tool.serverName)}:${sanitizeSlashCommandSegment(tool.name)}`,
    toolName: sanitizeToolName(`mcp_${prefixedToolName}`),
  };
}

function isDirectToolEnabled({
  directTools,
  server,
  tool,
}: {
  directTools: McpDirectToolsSetting;
  server: McpServerConfig;
  tool: McpToolMetadata;
}): boolean {
  if (matchesExcludedTool({ server, tool })) {
    return false;
  }

  if (directTools === false) {
    return false;
  }

  if (directTools === true) {
    return true;
  }

  return directTools.includes(tool.name);
}

function matchesExcludedTool({
  server,
  tool,
}: {
  server: McpServerConfig;
  tool: McpToolMetadata;
}): boolean {
  if (server.excludeTools.includes(tool.name)) {
    return true;
  }

  const serverPrefix = sanitizeToolName(server.name);
  return server.excludeTools.includes(`${serverPrefix}_${tool.name}`);
}

function getPrefixedMcpToolName({
  serverName,
  toolName,
  toolPrefix,
}: {
  serverName: string;
  toolName: string;
  toolPrefix: McpToolPrefixSetting;
}): string {
  if (toolPrefix === "none") {
    return toolName;
  }

  const prefixSource =
    toolPrefix === "short" ? stripMcpSuffix(serverName) : serverName;
  return `${prefixSource}_${toolName}`;
}

function stripMcpSuffix(value: string): string {
  return value.replace(/[-_]?mcp$/i, "");
}

function sanitizeToolName(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "_");
  invariant(
    /^[A-Za-z0-9_-]+$/.test(sanitized),
    `Unable to generate valid MCP tool name from: ${value}`,
  );
  return sanitized;
}

function sanitizeSlashCommandSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "_");
  invariant(
    /^[A-Za-z0-9_-]+$/.test(sanitized),
    `Unable to generate valid MCP slash command segment from: ${value}`,
  );
  return sanitized;
}

function assertUniqueRegisteredMcpTools(tools: readonly McpRegisteredTool[]) {
  const toolNames = new Set<string>();
  const slashToolNames = new Set<string>();

  for (const tool of tools) {
    invariant(
      !toolNames.has(tool.toolName),
      `Duplicate MCP tool name after prefixing: ${tool.toolName}`,
    );
    invariant(
      !slashToolNames.has(tool.slashToolName),
      `Duplicate MCP slash command name after sanitizing: /${tool.slashToolName}`,
    );
    toolNames.add(tool.toolName);
    slashToolNames.add(tool.slashToolName);
  }
}
