import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  McpServerConfig,
  McpToolMetadata,
  McpToolOutput,
  McpToolRuntime,
  ResolvedMcpConfig,
} from "./mcpTypes";

export class McpClientRegistry implements McpToolRuntime {
  private readonly connections = new Map<string, Promise<McpConnection>>();
  private readonly serversByName: Map<string, McpServerConfig>;

  constructor(private readonly config: ResolvedMcpConfig) {
    this.serversByName = new Map(
      config.servers.map((server) => [server.name, server]),
    );
  }

  async listTools(serverName: string): Promise<McpToolMetadata[]> {
    const connection = await this.getConnection(serverName);
    const tools: McpToolMetadata[] = [];
    let cursor: string | undefined;

    do {
      const result = await connection.client.listTools(
        cursor === undefined ? undefined : { cursor },
      );
      tools.push(
        ...result.tools.map((tool) => ({
          description: tool.description,
          inputSchema: tool.inputSchema,
          name: tool.name,
          serverName,
        })),
      );
      cursor = result.nextCursor;
    } while (cursor !== undefined);

    return tools;
  }

  async callTool({
    arguments: arguments_,
    serverName,
    toolName,
  }: {
    arguments: Record<string, unknown>;
    serverName: string;
    toolName: string;
  }): Promise<McpToolOutput> {
    const connection = await this.getConnection(serverName);
    const rawResult = await connection.client.callTool({
      arguments: arguments_,
      name: toolName,
    });

    return formatMcpToolOutput({
      arguments: arguments_,
      rawResult,
      serverName,
      toolName,
    });
  }

  private getConnection(serverName: string): Promise<McpConnection> {
    const server = this.serversByName.get(serverName);
    if (server === undefined) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }

    const existing = this.connections.get(serverName);
    if (existing !== undefined) {
      return existing;
    }

    const connection = connectMcpServer(server);
    this.connections.set(serverName, connection);
    return connection;
  }
}

type McpConnection = {
  client: Client;
  transport: Transport;
};

async function connectMcpServer(
  server: McpServerConfig,
): Promise<McpConnection> {
  if (server.command !== undefined) {
    return await connectStdioMcpServer(server);
  }

  if (server.url !== undefined) {
    return await connectHttpMcpServer(server);
  }

  throw new Error(`MCP server ${server.name} does not define a transport.`);
}

async function connectStdioMcpServer(
  server: McpServerConfig,
): Promise<McpConnection> {
  const transport = new StdioClientTransport({
    args: server.args,
    command: server.command!,
    cwd: server.cwd,
    env:
      server.env === undefined
        ? undefined
        : { ...getDefaultEnvironment(), ...server.env },
    stderr: server.debug ? "inherit" : "pipe",
  });
  if (!server.debug) {
    const stderr = transport.stderr as { resume?: () => void } | null;
    stderr?.resume?.();
  }

  const client = createClient(server.name);
  await client.connect(transport);
  return { client, transport };
}

async function connectHttpMcpServer(
  server: McpServerConfig,
): Promise<McpConnection> {
  const url = new URL(server.url!);
  const requestInit = createHttpRequestInit(server);

  try {
    const transport = new StreamableHTTPClientTransport(url, { requestInit });
    const client = createClient(server.name);
    await client.connect(transport);
    return { client, transport };
  } catch (error) {
    const transport = new SSEClientTransport(url, {
      eventSourceInit: { fetch: fetch as never },
      requestInit,
    });
    const client = createClient(server.name);
    await client.connect(transport);
    return { client, transport };
  }
}

function createClient(serverName: string): Client {
  return new Client(
    { name: `clutch0-mcp-${serverName}`, version: "0.1.0" },
    { capabilities: {} },
  );
}

function createHttpRequestInit(server: McpServerConfig): RequestInit {
  const headers: Record<string, string> = { ...(server.headers ?? {}) };
  const bearerToken = getBearerToken(server);
  if (bearerToken !== undefined) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  return Object.keys(headers).length === 0 ? {} : { headers };
}

function getBearerToken(server: McpServerConfig): string | undefined {
  if (server.bearerToken !== undefined) {
    return server.bearerToken;
  }
  if (server.bearerTokenEnv === undefined) {
    return undefined;
  }

  const token = process.env[server.bearerTokenEnv];
  if (token === undefined || token.length === 0) {
    throw new Error(
      `MCP server ${server.name} references missing bearerTokenEnv: ${server.bearerTokenEnv}`,
    );
  }
  return token;
}

function formatMcpToolOutput({
  arguments: arguments_,
  rawResult,
  serverName,
  toolName,
}: {
  arguments: Record<string, unknown>;
  rawResult: Awaited<ReturnType<Client["callTool"]>>;
  serverName: string;
  toolName: string;
}): McpToolOutput {
  if (isCallToolResult(rawResult)) {
    return {
      arguments: arguments_,
      contentText: rawResult.content.map(formatMcpContentBlock).join("\n"),
      isError: rawResult.isError === true,
      rawResult,
      serverName,
      structuredContent: rawResult.structuredContent,
      toolName,
    };
  }

  return {
    arguments: arguments_,
    contentText: safeJsonStringify(rawResult.toolResult),
    isError: false,
    rawResult,
    serverName,
    structuredContent: rawResult.toolResult,
    toolName,
  };
}

function isCallToolResult(
  value: Awaited<ReturnType<Client["callTool"]>>,
): value is CallToolResult {
  return "content" in value && Array.isArray(value.content);
}

function formatMcpContentBlock(
  block: CallToolResult["content"][number],
): string {
  if (block.type === "text") {
    return block.text;
  }
  if (block.type === "image") {
    return `[image ${block.mimeType}, ${block.data.length} base64 chars]`;
  }
  if (block.type === "audio") {
    return `[audio ${block.mimeType}, ${block.data.length} base64 chars]`;
  }
  if (block.type === "resource") {
    if ("text" in block.resource) {
      return `[resource ${block.resource.uri}]\n${block.resource.text}`;
    }
    return `[resource ${block.resource.uri}, ${block.resource.blob.length} base64 chars]`;
  }
  if (block.type === "resource_link") {
    return `[resource link ${block.name}: ${block.uri}]`;
  }

  return safeJsonStringify(block);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return `Could not serialize value: ${error instanceof Error ? error.message : String(error)}`;
  }
}
