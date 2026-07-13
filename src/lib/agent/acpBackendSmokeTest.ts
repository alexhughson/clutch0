import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough, Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import {
  getClutchConfigPaths,
  resolveConfiguredAgentBackend,
  type ClutchConfigPaths,
} from "../config/clutchConfig";
import type { ClutchAgentBackendConfig } from "../config/clutchConfigSchemas";

const DEFAULT_TIMEOUT_MS = 30_000;
const BUFFER_LIMIT = 8_000;

export type AcpBackendSmokeTestOptions = {
  backend?: ClutchAgentBackendConfig;
  configDir?: string;
  cwd?: string;
  prompt?: string;
  skipPrompt?: boolean;
  timeoutMs?: number;
};

export type AcpBackendSmokeTestResult = {
  assistantText: string;
  backendCommand: string;
  configPath: string;
  cwd: string;
  envKeys: string[];
  sessionId: string;
  stages: {
    initializeMs: number;
    promptMs?: number;
    sessionMs: number;
  };
  stderr: string;
  stdoutPrefix: string;
  stopReason?: string;
  updates: string[];
};

type ChildExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

export async function runAcpBackendSmokeTest({
  backend,
  configDir,
  cwd = process.cwd(),
  prompt = "Reply with exactly: clutch-acp-ok",
  skipPrompt = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: AcpBackendSmokeTestOptions = {}): Promise<AcpBackendSmokeTestResult> {
  const configPaths =
    configDir === undefined ? getClutchConfigPaths() : getClutchConfigPaths(configDir);
  const resolvedBackend =
    backend ?? resolveConfiguredAgentBackend(configPaths);
  const child = spawnBackend(resolvedBackend, cwd);
  const stderr = createStreamBuffer(child.stderr);
  const stdout = createStreamBuffer(child.stdout);
  const protocolStdout = new PassThrough();
  child.stdout.pipe(protocolStdout);
  const childExit = trackChildExit(child);
  const startupFailure = createStartupFailurePromise({
    backend: resolvedBackend,
    child,
    childExit,
    stderr,
  });
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(protocolStdout) as unknown as ReadableStream<Uint8Array>,
  );
  const updates: string[] = [];
  const client = createSmokeClient({ updates });
  const connection = client.connect(stream);

  try {
    const initializeStartedAt = Date.now();
    const initializeResult = await withDiagnostics({
      backend: resolvedBackend,
      childExit,
      operation: "initialize",
      promise: Promise.race([
        connection.agent.request(acp.methods.agent.initialize, {
          clientCapabilities: {},
          clientInfo: {
            name: "clutch-smoke-test",
            title: "Clutch ACP smoke test",
            version: "0.1.0",
          },
          protocolVersion: acp.PROTOCOL_VERSION,
        }),
        startupFailure,
      ]),
      stderr,
      stdout,
      timeoutMs,
    });
    const initializeMs = Date.now() - initializeStartedAt;
    if (initializeResult.protocolVersion !== acp.PROTOCOL_VERSION) {
      throw new Error(
        `ACP protocol mismatch: expected ${acp.PROTOCOL_VERSION}, received ${initializeResult.protocolVersion}.`,
      );
    }

    const sessionStartedAt = Date.now();
    const session = await withDiagnostics({
      backend: resolvedBackend,
      childExit,
      operation: "session/new",
      promise: Promise.race([
        connection.agent.buildSession(cwd).start(),
        startupFailure,
      ]),
      stderr,
      stdout,
      timeoutMs,
    });
    const sessionMs = Date.now() - sessionStartedAt;

    let assistantText = "";
    let promptMs: number | undefined;
    let stopReason: string | undefined;
    if (!skipPrompt) {
      const promptStartedAt = Date.now();
      const promptPromise = session.prompt(prompt);
      const promptFailure = promptPromise.then<never>(
        () => new Promise<never>(() => {}),
        (error) => {
          throw error;
        },
      );
      for (;;) {
        const message = await withDiagnostics({
          backend: resolvedBackend,
          childExit,
          operation: "session/prompt",
          promise: Promise.race([session.nextUpdate(), promptFailure]),
          stderr,
          stdout,
          timeoutMs,
        });
        if (message.kind === "stop") {
          stopReason = message.stopReason;
          await promptPromise;
          break;
        }
        const updateSummary = summarizeUpdate(message.update);
        updates.push(updateSummary);
        if (
          message.update.sessionUpdate === "agent_message_chunk" &&
          message.update.content.type === "text"
        ) {
          assistantText = `${assistantText}${message.update.content.text}`;
        }
      }
      promptMs = Date.now() - promptStartedAt;
      if (assistantText.trim().length === 0) {
        throw diagnosticError({
          backend: resolvedBackend,
          childExit,
          error: new Error(
            "ACP smoke test prompt completed without assistant text.",
          ),
          operation: "session/prompt",
          stderr,
          stdout,
        });
      }
    }

    await withDiagnostics({
      backend: resolvedBackend,
      childExit,
      operation: "session/dispose",
      promise: disposeSession({ connection, session }),
      stderr,
      stdout,
      timeoutMs,
    });
    connection.close();
    killBackend(child);

    return {
      assistantText,
      backendCommand: formatBackendCommand(resolvedBackend),
      configPath: configPaths.settingsPath,
      cwd,
      envKeys: Object.keys(resolvedBackend.env ?? {}).sort(),
      sessionId: session.sessionId,
      stages: {
        initializeMs,
        ...(promptMs === undefined ? {} : { promptMs }),
        sessionMs,
      },
      stderr: stderr(),
      stdoutPrefix: stdout(),
      stopReason,
      updates,
    };
  } catch (error) {
    connection.close(error);
    killBackend(child);
    throw error;
  }
}

function createSmokeClient({ updates }: { updates: string[] }) {
  return acp
    .client({ name: "clutch-smoke-test" })
    .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
      updates.push(`permission requested: ${permissionTitle(params)}`);
      return { outcome: { outcome: "cancelled" } };
    });
}

function permissionTitle(params: acp.RequestPermissionRequest): string {
  return params.toolCall.title ?? params.toolCall.toolCallId;
}

function spawnBackend(
  backend: ClutchAgentBackendConfig,
  cwd: string,
): ChildProcessWithoutNullStreams {
  return spawn(backend.command, backend.args ?? [], {
    cwd,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      ...backend.env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function createStreamBuffer(stream: NodeJS.ReadableStream): () => string {
  let buffer = "";
  stream.setEncoding("utf-8");
  stream.on("data", (chunk: string) => {
    buffer = `${buffer}${chunk}`;
    if (buffer.length > BUFFER_LIMIT) {
      buffer = buffer.slice(buffer.length - BUFFER_LIMIT);
    }
  });
  return () => buffer.trim();
}

function trackChildExit(child: ChildProcessWithoutNullStreams): {
  current: () => ChildExit | null;
  promise: Promise<ChildExit>;
} {
  let exit: ChildExit | null = null;
  const promise = new Promise<ChildExit>((resolve) => {
    child.once("exit", (code, signal) => {
      exit = { code, signal };
      resolve(exit);
    });
  });
  return {
    current: () => exit,
    promise,
  };
}

function createStartupFailurePromise({
  backend,
  child,
  childExit,
  stderr,
}: {
  backend: ClutchAgentBackendConfig;
  child: ChildProcessWithoutNullStreams;
  childExit: { promise: Promise<ChildExit> };
  stderr: () => string;
}): Promise<never> {
  return new Promise((_, reject) => {
    child.once("error", (error) => {
      reject(
        new Error(
          `Failed to start ACP backend ${formatBackendCommand(backend)}: ${error.message}`,
        ),
      );
    });
    void childExit.promise.then((exit) => {
      reject(
        new Error(
          `ACP backend ${formatBackendCommand(backend)} exited (${formatExit(exit)}).${formatStderr(stderr())}`,
        ),
      );
    });
  });
}

async function withDiagnostics<T>({
  backend,
  childExit,
  operation,
  promise,
  stderr,
  stdout,
  timeoutMs,
}: {
  backend: ClutchAgentBackendConfig;
  childExit: { current: () => ChildExit | null };
  operation: string;
  promise: Promise<T>;
  stderr: () => string;
  stdout: () => string;
  timeoutMs: number;
}): Promise<T> {
  try {
    return await withTimeout(promise, timeoutMs, operation);
  } catch (error) {
    throw diagnosticError({
      backend,
      childExit,
      error,
      operation,
      stderr,
      stdout,
    });
  }
}

function diagnosticError({
  backend,
  childExit,
  error,
  operation,
  stderr,
  stdout,
}: {
  backend: ClutchAgentBackendConfig;
  childExit: { current: () => ChildExit | null };
  error: unknown;
  operation: string;
  stderr: () => string;
  stdout: () => string;
}): Error {
  return new Error(
    [
      `ACP smoke test failed during ${operation}.`,
      `backend=${formatBackendCommand(backend)}`,
      `exit=${formatExit(childExit.current())}`,
      `error=${error instanceof Error ? error.message : String(error)}`,
      `stderr=${stderr() || "<empty>"}`,
      `stdoutPrefix=${stdout() || "<empty>"}`,
    ].join("\n"),
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${operation} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function disposeSession({
  connection,
  session,
}: {
  connection: acp.ClientConnection;
  session: acp.ActiveSession;
}) {
  try {
    await connection.agent.notify(acp.methods.agent.session.cancel, {
      sessionId: session.sessionId,
    });
  } finally {
    session.dispose();
  }
  try {
    await connection.agent.request(acp.methods.agent.session.close, {
      sessionId: session.sessionId,
    });
  } catch (error) {
    if (!(error instanceof acp.RequestError && error.code === -32601)) {
      throw error;
    }
  }
}

function killBackend(child: ChildProcessWithoutNullStreams) {
  if (child.killed) {
    return;
  }

  if (child.pid !== undefined && process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      child.kill("SIGTERM");
      return;
    }
  }

  child.kill("SIGTERM");
}

function summarizeUpdate(update: acp.SessionUpdate): string {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
    case "user_message_chunk":
      return `${update.sessionUpdate}:${update.content.type}`;
    case "tool_call":
      return `tool_call:${update.title}`;
    case "tool_call_update":
      return `tool_call_update:${update.toolCallId}:${update.status ?? "unknown"}`;
    case "plan":
      return `plan:${update.entries.length}`;
    case "usage_update":
      return `usage:${update.used}/${update.size}`;
    default:
      return update.sessionUpdate;
  }
}

function formatBackendCommand(backend: ClutchAgentBackendConfig): string {
  return [backend.command, ...(backend.args ?? [])]
    .map((part) => JSON.stringify(part))
    .join(" ");
}

function formatExit(exit: ChildExit | null): string {
  if (exit === null) {
    return "still running";
  }
  if (exit.code !== null) {
    return `exit code ${exit.code}`;
  }
  return `signal ${exit.signal ?? "unknown"}`;
}

function formatStderr(stderr: string): string {
  return stderr.length === 0 ? "" : ` stderr: ${stderr}`;
}
