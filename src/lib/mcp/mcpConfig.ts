import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  CLUTCH_CONFIG_DIR_ENV,
  getClutchConfigPaths,
} from "../config/clutchConfig";
import type {
  McpDirectToolsSetting,
  McpLifecycle,
  McpServerConfig,
  McpSettings,
  McpToolPrefixSetting,
  ResolvedMcpConfig,
} from "./mcpTypes";

export type McpConfigPaths = {
  clutchGlobalPath: string;
  clutchProjectPath: string;
  sharedGlobalPath: string;
  sharedProjectPath: string;
};

const DEFAULT_MCP_SETTINGS: McpSettings = {
  directTools: false,
  idleTimeout: 10,
  toolPrefix: "server",
};

const MCP_TOOL_PREFIX_SETTINGS = ["server", "short", "none"] as const;
const MCP_LIFECYCLES = ["lazy", "eager", "keep-alive"] as const;

type ParsedMcpServerConfig = {
  args?: string[];
  auth?: "bearer";
  bearerToken?: string;
  bearerTokenEnv?: string;
  command?: string;
  cwd?: string;
  debug?: boolean;
  directTools?: McpDirectToolsSetting;
  env?: Record<string, string>;
  excludeTools?: string[];
  headers?: Record<string, string>;
  idleTimeout?: number;
  lifecycle?: McpLifecycle;
  name: string;
  url?: string;
};

export function getMcpConfigPaths({
  clutchConfigDir = process.env[CLUTCH_CONFIG_DIR_ENV] ??
    getClutchConfigPaths().configDir,
  root = process.cwd(),
}: {
  clutchConfigDir?: string;
  root?: string;
} = {}): McpConfigPaths {
  return {
    clutchGlobalPath: join(clutchConfigDir, "mcp.json"),
    clutchProjectPath: join(root, ".clutch", "mcp.json"),
    sharedGlobalPath: join(homedir(), ".config", "mcp", "mcp.json"),
    sharedProjectPath: join(root, ".mcp.json"),
  };
}

export function loadMcpConfig({
  root = process.cwd(),
  paths = getMcpConfigPaths({ root }),
}: {
  paths?: McpConfigPaths;
  root?: string;
} = {}): ResolvedMcpConfig {
  const rawConfigs = [
    paths.sharedGlobalPath,
    paths.clutchGlobalPath,
    paths.sharedProjectPath,
    paths.clutchProjectPath,
  ].map((path) => readOptionalMcpConfig(path));

  return parseMergedMcpConfig({ rawConfigs, root });
}

export function parseMergedMcpConfig({
  rawConfigs,
  root = process.cwd(),
}: {
  rawConfigs: readonly Record<string, unknown>[];
  root?: string;
}): ResolvedMcpConfig {
  let settings: McpSettings = { ...DEFAULT_MCP_SETTINGS };
  const servers = new Map<string, ParsedMcpServerConfig>();

  rawConfigs.forEach((rawConfig, configIndex) => {
    settings = {
      ...settings,
      ...parseMcpSettings(
        rawConfig.settings,
        `config[${configIndex}].settings`,
      ),
    };

    const parsedServers = parseMcpServers({
      rawServers: rawConfig.mcpServers,
      root,
      sourcePath: `config[${configIndex}].mcpServers`,
    });
    for (const server of parsedServers) {
      const existing = servers.get(server.name);
      servers.set(
        server.name,
        existing === undefined ? server : mergeServerConfig(existing, server),
      );
    }
  });

  return {
    servers: [...servers.values()].map(finalizeMcpServerConfig),
    settings,
  };
}

function readOptionalMcpConfig(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }

  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(raw)) {
    throw new Error(`MCP config ${path} must contain a JSON object.`);
  }

  return raw;
}

function parseMcpSettings(
  rawSettings: unknown,
  path: string,
): Partial<McpSettings> {
  if (rawSettings === undefined) {
    return {};
  }
  if (!isRecord(rawSettings)) {
    throw new Error(`${path} must be an object.`);
  }

  assertKnownFields(rawSettings, path, [
    "autoAuth",
    "directTools",
    "disableProxyTool",
    "idleTimeout",
    "sampling",
    "samplingAutoApprove",
    "toolPrefix",
  ]);

  const settings: Partial<McpSettings> = {};

  if (rawSettings.toolPrefix !== undefined) {
    settings.toolPrefix = parseEnumValue(
      rawSettings.toolPrefix,
      MCP_TOOL_PREFIX_SETTINGS,
      `${path}.toolPrefix`,
    );
  }

  if (rawSettings.directTools !== undefined) {
    if (typeof rawSettings.directTools !== "boolean") {
      throw new Error(`${path}.directTools must be a boolean.`);
    }
    settings.directTools = rawSettings.directTools;
  }

  if (rawSettings.idleTimeout !== undefined) {
    settings.idleTimeout = parseNonNegativeNumber(
      rawSettings.idleTimeout,
      `${path}.idleTimeout`,
    );
  }

  return settings;
}

function parseMcpServers({
  rawServers,
  root,
  sourcePath,
}: {
  rawServers: unknown;
  root: string;
  sourcePath: string;
}): ParsedMcpServerConfig[] {
  if (rawServers === undefined) {
    return [];
  }
  if (!isRecord(rawServers)) {
    throw new Error(`${sourcePath} must be an object.`);
  }

  return Object.entries(rawServers).map(([serverName, rawServer]) =>
    parseMcpServer({ rawServer, root, serverName, sourcePath }),
  );
}

function parseMcpServer({
  rawServer,
  root,
  serverName,
  sourcePath,
}: {
  rawServer: unknown;
  root: string;
  serverName: string;
  sourcePath: string;
}): ParsedMcpServerConfig {
  const path = `${sourcePath}.${serverName}`;
  if (!isSafeConfigName(serverName)) {
    throw new Error(`${path} has an invalid server name.`);
  }
  if (!isRecord(rawServer)) {
    throw new Error(`${path} must be an object.`);
  }

  assertKnownFields(rawServer, path, [
    "args",
    "auth",
    "bearerToken",
    "bearerTokenEnv",
    "command",
    "cwd",
    "debug",
    "directTools",
    "env",
    "excludeTools",
    "exposeResources",
    "headers",
    "idleTimeout",
    "lifecycle",
    "oauth",
    "url",
  ]);

  const command = parseOptionalInterpolatedString(
    rawServer.command,
    `${path}.command`,
  );
  const url = parseOptionalInterpolatedString(rawServer.url, `${path}.url`);
  if (command !== undefined && url !== undefined) {
    throw new Error(`${path} cannot define both command and url.`);
  }

  const auth = parseOptionalAuth(rawServer.auth, `${path}.auth`);
  if (rawServer.oauth !== undefined) {
    throw new Error(`${path}.oauth is not supported by Clutch MCP yet.`);
  }

  return {
    args: parseOptionalStringArray(rawServer.args, `${path}.args`),
    auth,
    bearerToken: parseOptionalInterpolatedString(
      rawServer.bearerToken,
      `${path}.bearerToken`,
    ),
    bearerTokenEnv: parseOptionalString(
      rawServer.bearerTokenEnv,
      `${path}.bearerTokenEnv`,
    ),
    command,
    cwd: parseOptionalCwd(rawServer.cwd, `${path}.cwd`, root),
    debug: parseOptionalBoolean(rawServer.debug, `${path}.debug`),
    directTools: parseOptionalDirectTools(
      rawServer.directTools,
      `${path}.directTools`,
    ),
    env: parseOptionalStringRecord(rawServer.env, `${path}.env`),
    excludeTools: parseOptionalStringArray(
      rawServer.excludeTools,
      `${path}.excludeTools`,
    ),
    headers: parseOptionalStringRecord(rawServer.headers, `${path}.headers`),
    idleTimeout:
      rawServer.idleTimeout === undefined
        ? undefined
        : parseNonNegativeNumber(rawServer.idleTimeout, `${path}.idleTimeout`),
    lifecycle:
      rawServer.lifecycle === undefined
        ? undefined
        : parseEnumValue(
            rawServer.lifecycle,
            MCP_LIFECYCLES,
            `${path}.lifecycle`,
          ),
    name: serverName,
    url,
  };
}

function mergeServerConfig(
  previous: ParsedMcpServerConfig,
  next: ParsedMcpServerConfig,
): ParsedMcpServerConfig {
  return {
    args: next.args ?? previous.args,
    auth: next.auth ?? previous.auth,
    bearerToken: next.bearerToken ?? previous.bearerToken,
    bearerTokenEnv: next.bearerTokenEnv ?? previous.bearerTokenEnv,
    command:
      next.command ?? (next.url !== undefined ? undefined : previous.command),
    cwd: next.cwd ?? previous.cwd,
    debug: next.debug ?? previous.debug,
    directTools: next.directTools ?? previous.directTools,
    env: next.env ?? previous.env,
    excludeTools: next.excludeTools ?? previous.excludeTools,
    headers: next.headers ?? previous.headers,
    idleTimeout: next.idleTimeout ?? previous.idleTimeout,
    lifecycle: next.lifecycle ?? previous.lifecycle,
    name: previous.name,
    url: next.url ?? (next.command !== undefined ? undefined : previous.url),
  };
}

function finalizeMcpServerConfig(
  server: ParsedMcpServerConfig,
): McpServerConfig {
  if (server.command !== undefined && server.url !== undefined) {
    throw new Error(
      `MCP server ${server.name} cannot define both command and url.`,
    );
  }
  if (server.command === undefined && server.url === undefined) {
    throw new Error(
      `MCP server ${server.name} must define either command or url.`,
    );
  }
  if (server.url !== undefined) {
    try {
      new URL(server.url);
    } catch {
      throw new Error(`MCP server ${server.name}.url must be a valid URL.`);
    }
  }

  const finalized: McpServerConfig = {
    ...server,
    args: server.args ?? [],
    debug: server.debug ?? false,
    excludeTools: server.excludeTools ?? [],
    lifecycle: server.lifecycle ?? "lazy",
  };

  if (finalized.auth === "bearer" && getBearerToken(finalized) === undefined) {
    throw new Error(
      `MCP server ${server.name} uses bearer auth but does not define bearerToken or bearerTokenEnv.`,
    );
  }

  return finalized;
}

function parseOptionalAuth(
  value: unknown,
  path: string,
): McpServerConfig["auth"] {
  if (value === undefined) {
    return undefined;
  }
  if (value === "bearer") {
    return value;
  }
  if (value === "oauth") {
    throw new Error(`${path} oauth is not supported by Clutch MCP yet.`);
  }
  throw new Error(`${path} must be "bearer" or "oauth".`);
}

function parseOptionalDirectTools(
  value: unknown,
  path: string,
): McpDirectToolsSetting | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return parseStringArray(value, path);
}

function parseOptionalCwd(
  value: unknown,
  path: string,
  root: string,
): string | undefined {
  const cwd = parseOptionalInterpolatedString(value, path);
  if (cwd === undefined) {
    return undefined;
  }
  if (cwd === "~") {
    return homedir();
  }
  if (cwd.startsWith("~/")) {
    return join(homedir(), cwd.slice(2));
  }
  return resolve(root, cwd);
}

function parseOptionalStringRecord(
  value: unknown,
  path: string,
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object of strings.`);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, rawValue]) => {
      if (typeof rawValue !== "string") {
        throw new Error(`${path}.${key} must be a string.`);
      }
      return [key, interpolateConfigString(rawValue, `${path}.${key}`)];
    }),
  );
}

function parseStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of strings.`);
  }
  if (!value.every((entry) => typeof entry === "string")) {
    throw new Error(`${path} must contain only strings.`);
  }

  return value.map((entry, index) =>
    interpolateConfigString(entry, `${path}[${index}]`),
  );
}

function parseOptionalStringArray(
  value: unknown,
  path: string,
): string[] | undefined {
  return value === undefined ? undefined : parseStringArray(value, path);
}

function parseOptionalInterpolatedString(
  value: unknown,
  path: string,
): string | undefined {
  const raw = parseOptionalString(value, path);
  return raw === undefined ? undefined : interpolateConfigString(raw, path);
}

function parseOptionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string.`);
  }
  if (value.trim().length === 0) {
    throw new Error(`${path} must not be empty.`);
  }
  return value;
}

function parseOptionalBoolean(
  value: unknown,
  path: string,
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean.`);
  }
  return value;
}

function parseNonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a non-negative number.`);
  }
  return value;
}

function parseEnumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${path} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T[number];
}

function interpolateConfigString(value: string, path: string): string {
  return value
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) =>
      requireEnvValue(name, path),
    )
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) =>
      requireEnvValue(name, path),
    );
}

function requireEnvValue(name: string, path: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`${path} references missing environment variable: ${name}`);
  }
  return value;
}

function getBearerToken(server: McpServerConfig): string | undefined {
  if (server.bearerToken !== undefined) {
    return server.bearerToken;
  }
  if (server.bearerTokenEnv === undefined) {
    return undefined;
  }

  const value = process.env[server.bearerTokenEnv];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `MCP server ${server.name} references missing bearerTokenEnv: ${server.bearerTokenEnv}`,
    );
  }
  return value;
}

function assertKnownFields(
  value: Record<string, unknown>,
  path: string,
  knownFields: readonly string[],
) {
  const known = new Set(knownFields);
  for (const field of Object.keys(value)) {
    if (!known.has(field)) {
      throw new Error(`${path}.${field} is not supported by Clutch MCP.`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeConfigName(name: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(name);
}
