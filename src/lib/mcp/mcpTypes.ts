export type McpDirectToolsSetting = boolean | readonly string[];
export type McpToolPrefixSetting = "none" | "server" | "short";
export type McpLifecycle = "eager" | "keep-alive" | "lazy";

export type McpSettings = {
  directTools: boolean;
  idleTimeout: number;
  toolPrefix: McpToolPrefixSetting;
};

export type McpServerConfig = {
  args: string[];
  auth?: "bearer";
  bearerToken?: string;
  bearerTokenEnv?: string;
  command?: string;
  cwd?: string;
  debug: boolean;
  directTools?: McpDirectToolsSetting;
  env?: Record<string, string>;
  excludeTools: string[];
  headers?: Record<string, string>;
  idleTimeout?: number;
  lifecycle: McpLifecycle;
  name: string;
  url?: string;
};

export type ResolvedMcpConfig = {
  servers: readonly McpServerConfig[];
  settings: McpSettings;
};

export type McpToolMetadata = {
  description?: string;
  inputSchema: Record<string, unknown>;
  name: string;
  serverName: string;
};

export type McpRegisteredTool = McpToolMetadata & {
  slashCommandName: string;
  slashToolName: string;
  toolName: string;
};

export type McpToolOutput = {
  arguments: Record<string, unknown>;
  contentText: string;
  isError: boolean;
  rawResult: unknown;
  serverName: string;
  structuredContent?: unknown;
  toolName: string;
};

export interface McpToolRuntime {
  callTool(options: {
    arguments: Record<string, unknown>;
    serverName: string;
    toolName: string;
  }): Promise<McpToolOutput>;
  listTools(serverName: string): Promise<McpToolMetadata[]>;
}
