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
  private closed = false;
  private readonly pendingTransports = new Set<Transport>();
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
    signal,
    toolName,
  }: {
    arguments: Record<string, unknown>;
    serverName: string;
    signal?: AbortSignal;
    toolName: string;
  }): Promise<McpToolOutput> {
    throwIfAborted(signal);
    const connection = await abortable(this.getConnection(serverName), signal);
    const rawResult = await abortable(
      connection.client.callTool({
        arguments: arguments_,
        name: toolName,
      }),
      signal,
    );

    return formatMcpToolOutput({
      arguments: arguments_,
      rawResult,
      serverName,
      toolName,
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const connections = [...this.connections.values()];
    const pendingTransports = [...this.pendingTransports];
    this.pendingTransports.clear();
    this.connections.clear();
    await withTimeout(
      Promise.allSettled(
        [
          ...pendingTransports.map(closeMcpTransport),
          ...connections.map(async (connection) => {
            const resolved = await connection;
            await closeMcpConnection(resolved);
          }),
        ],
      ),
      MCP_CLOSE_TIMEOUT_MS,
    );
  }

  private getConnection(serverName: string): Promise<McpConnection> {
    this.assertOpen();

    const server = this.serversByName.get(serverName);
    if (server === undefined) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }

    const existing = this.connections.get(serverName);
    if (existing !== undefined) {
      return existing;
    }

    const connection = connectMcpServer(
      server,
      (transport) => this.trackPendingTransport(transport),
      () => this.assertOpen(),
    ).then(
      async (resolved) => {
        if (this.closed) {
          await closeMcpConnection(resolved);
          throw new Error("MCP client registry is closed.");
        }

        return resolved;
      },
      (error) => {
        this.connections.delete(serverName);
        throw error;
      },
    );
    this.connections.set(serverName, connection);
    return connection;
  }

  private assertOpen() {
    if (this.closed) {
      throw new Error("MCP client registry is closed.");
    }
  }

  private trackPendingTransport(transport: Transport): () => void {
    if (this.closed) {
      void closeMcpTransport(transport);
      throw new Error("MCP client registry is closed.");
    }

    this.pendingTransports.add(transport);
    return () => {
      this.pendingTransports.delete(transport);
    };
  }
}

const MCP_CLOSE_TIMEOUT_MS = 2_000;

type McpConnection = {
  client: Client;
  transport: Transport;
};

async function closeMcpConnection(connection: McpConnection): Promise<void> {
  await connection.client.close();
}

async function closeMcpTransport(transport: Transport): Promise<void> {
  await transport.close?.();
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  throwIfAborted(signal);
  if (signal === undefined) {
    return await promise;
  }

  return await Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new Error("MCP tool call was aborted.")),
        { once: true },
      );
    }),
  ]);
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted === true) {
    throw new Error("MCP tool call was aborted.");
  }
}

async function connectMcpServer(
  server: McpServerConfig,
  trackTransport: (transport: Transport) => () => void,
  assertOpen: () => void,
): Promise<McpConnection> {
  assertOpen();
  if (server.command !== undefined) {
    return await connectStdioMcpServer(server, trackTransport);
  }

  if (server.url !== undefined) {
    return await connectHttpMcpServer(server, trackTransport, assertOpen);
  }

  throw new Error(`MCP server ${server.name} does not define a transport.`);
}

async function connectStdioMcpServer(
  server: McpServerConfig,
  trackTransport: (transport: Transport) => () => void,
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
  const untrackTransport = trackTransport(transport);
  try {
    await client.connect(transport);
  } finally {
    untrackTransport();
  }
  return { client, transport };
}

async function connectHttpMcpServer(
  server: McpServerConfig,
  trackTransport: (transport: Transport) => () => void,
  assertOpen: () => void,
): Promise<McpConnection> {
  const url = new URL(server.url!);
  const requestInit = createHttpRequestInit(server);

  try {
    assertOpen();
    const transport = new StreamableHTTPClientTransport(url, { requestInit });
    const client = createClient(server.name);
    const untrackTransport = trackTransport(transport);
    try {
      await client.connect(transport);
    } finally {
      untrackTransport();
    }
    return { client, transport };
  } catch (error) {
    assertOpen();
    const transport = new SSEClientTransport(url, {
      eventSourceInit: { fetch: fetch as never },
      requestInit,
    });
    const client = createClient(server.name);
    const untrackTransport = trackTransport(transport);
    try {
      await client.connect(transport);
    } finally {
      untrackTransport();
    }
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
