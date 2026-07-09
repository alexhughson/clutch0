import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentApp, ClientConnection } from "@agentclientprotocol/sdk";
import type { AgentOutputUpdate } from "../agentOutput/agentOutputTypes";
import {
  createAgentToolBlock,
  createAcpAgentOutputFormatter,
  type AcpAgentOutputFormatter,
} from "../agentOutput/acpAgentOutputAdapter";
import type { ClutchAgentBackendConfig } from "../config/clutchConfig";

export type AgentSessionDriver = {
  dispose: () => Promise<void>;
  latestAssistantText: () => string | null;
  prompt: (message: string) => Promise<void>;
};

export type CreateAcpAgentSessionDriverOptions = {
  backend: ClutchAgentBackendConfig;
  cwd: string;
  onOutputUpdate: (update: AgentOutputUpdate) => void;
  signal?: AbortSignal;
};

type AcpDriverResources = {
  child?: ChildProcessWithoutNullStreams;
  connection: ClientConnection;
  formatter: AcpAgentOutputFormatter;
  onOutputUpdate: (update: AgentOutputUpdate) => void;
  session: acp.ActiveSession;
};

type AcpStartupDiagnostics = {
  backend: ClutchAgentBackendConfig;
  childExit: {
    current: () => ChildExit | null;
    promise: Promise<ChildExit>;
  };
  stderr: () => string;
};

type ChildExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

export async function createAcpAgentSessionDriver({
  backend,
  cwd,
  onOutputUpdate,
  signal,
}: CreateAcpAgentSessionDriverOptions): Promise<AgentSessionDriver> {
  const child = spawnAcpBackend(backend, cwd);
  const childExit = trackChildExit(child);
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
  );
  const stderr = createStderrBuffer(child);
  const connection = createAcpClientApp({ onOutputUpdate }).connect(stream);

  try {
    const resources = await initializeAcpSession({
      child,
      connection,
      cwd,
      onOutputUpdate,
      signal,
      startupDiagnostics: { backend, childExit, stderr },
      startupFailure: createStartupFailurePromise({
        backend,
        child,
        childExit,
        stderr,
      }),
    });
    return createDriverFromResources(resources);
  } catch (error) {
    connection.close(error);
    killAcpBackend(child);
    throw error;
  }
}

export async function createInProcessAcpAgentSessionDriverForTest({
  agent,
  cwd,
  onOutputUpdate,
}: {
  agent: AgentApp;
  cwd: string;
  onOutputUpdate: (update: AgentOutputUpdate) => void;
}): Promise<AgentSessionDriver> {
  const connection = createAcpClientApp({ onOutputUpdate }).connect(agent);
  const resources = await initializeAcpSession({
    connection,
    cwd,
    onOutputUpdate,
  });
  return createDriverFromResources(resources);
}

async function initializeAcpSession({
  child,
  connection,
  cwd,
  onOutputUpdate,
  signal,
  startupDiagnostics,
  startupFailure,
}: {
  child?: ChildProcessWithoutNullStreams;
  connection: ClientConnection;
  cwd: string;
  onOutputUpdate: (update: AgentOutputUpdate) => void;
  signal?: AbortSignal;
  startupDiagnostics?: AcpStartupDiagnostics;
  startupFailure?: Promise<never>;
}): Promise<AcpDriverResources> {
  throwIfAborted(signal);
  const abortFailure = createAbortFailurePromise(signal);
  const initialize = connection.agent.request(
    acp.methods.agent.initialize,
    {
      clientCapabilities: {},
      clientInfo: {
        name: "clutch",
        title: "Clutch",
        version: "0.1.0",
      },
      protocolVersion: acp.PROTOCOL_VERSION,
    },
    {
      cancellationSignal: signal,
    },
  );
  const initResult = await runStartupOperation({
    diagnostics: startupDiagnostics,
    operation: "initialize",
    promise: raceStartup([initialize, startupFailure, abortFailure]),
  });
  if (initResult.protocolVersion !== acp.PROTOCOL_VERSION) {
    throw new Error(
      `ACP agent protocol mismatch: expected ${acp.PROTOCOL_VERSION}, received ${initResult.protocolVersion}.`,
    );
  }

  throwIfAborted(signal);
  const startSession = connection.agent
    .buildSession(cwd)
    .start({ cancellationSignal: signal });
  const session = await runStartupOperation({
    diagnostics: startupDiagnostics,
    operation: "session/new",
    promise: raceStartup([startSession, startupFailure, abortFailure]),
  });

  return {
    ...(child === undefined ? {} : { child }),
    connection,
    formatter: createAcpAgentOutputFormatter(),
    onOutputUpdate,
    session,
  };
}

function createDriverFromResources({
  child,
  connection,
  formatter,
  onOutputUpdate,
  session,
}: AcpDriverResources): AgentSessionDriver {
  let disposed = false;
  let promptQueue = Promise.resolve();
  let activePromptAbort: AbortController | null = null;

  const runPrompt = async (message: string) => {
    if (disposed) {
      throw new Error("ACP agent session is disposed.");
    }

    formatter.beginPrompt();
    activePromptAbort = new AbortController();
    const promptPromise = session.prompt([{ text: message, type: "text" }], {
      cancellationSignal: activePromptAbort.signal,
    });
    const promptFailure = promptPromise.then<never>(
      () => new Promise<never>(() => {}),
      (error) => {
        throw error;
      },
    );

    try {
      for (;;) {
        const message = await Promise.race([
          session.nextUpdate(),
          promptFailure,
        ]);
        for (const update of formatter.format(message)) {
          onOutputUpdate(update);
        }
        if (message.kind === "stop") {
          await promptPromise;
          return;
        }
      }
    } finally {
      activePromptAbort = null;
    }
  };

  return {
    async dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      activePromptAbort?.abort();
      try {
        await withTimeout(
          disposeProtocolSession(connection, session),
          1_000,
          "Timed out closing ACP agent session.",
        );
      } finally {
        connection.close();
        if (child !== undefined) {
          killAcpBackend(child);
        }
      }
    },
    latestAssistantText() {
      return formatter.getLatestAssistantText();
    },
    async prompt(message: string) {
      const run = promptQueue.then(() => runPrompt(message));
      promptQueue = run.catch(() => {});
      await run;
    },
  };
}

function createAcpClientApp({
  onOutputUpdate,
}: {
  onOutputUpdate: (update: AgentOutputUpdate) => void;
}) {
  return acp
    .client({ name: "clutch" })
    .onRequest(acp.methods.client.session.requestPermission, ({ params }) =>
      handlePermissionRequest({ onOutputUpdate, params }),
    );
}

function handlePermissionRequest({
  onOutputUpdate,
  params,
}: {
  onOutputUpdate: (update: AgentOutputUpdate) => void;
  params: acp.RequestPermissionRequest;
}): acp.RequestPermissionResponse {
  const option =
    params.options.find((candidate) => candidate.kind === "allow_once") ??
    params.options.find((candidate) => candidate.kind === "allow_always");
  if (option === undefined) {
    onOutputUpdate({
      block: createAgentToolBlock({
        isError: true,
        phase: "end",
        summary: `auto-cancelled permission request: ${params.toolCall.title ?? params.toolCall.toolCallId}`,
        toolName: "permission",
      }),
      kind: "append-block",
    });
    return { outcome: { outcome: "cancelled" } };
  }

  onOutputUpdate({
    block: createAgentToolBlock({
      phase: "end",
      summary: `auto-allowed ${params.toolCall.title ?? params.toolCall.toolCallId}: ${option.name}`,
      toolName: "permission",
    }),
    kind: "append-block",
  });
  return { outcome: { optionId: option.optionId, outcome: "selected" } };
}

function spawnAcpBackend(
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
          `Failed to start ACP agent backend ${formatBackendCommand(backend)}: ${error.message}`,
        ),
      );
    });
    void childExit.promise.then((exit) => {
      reject(
        new Error(
          `ACP agent backend ${formatBackendCommand(backend)} exited before session startup (${formatExit(exit)}).${formatStderr(stderr())}`,
        ),
      );
    });
  });
}

function createStderrBuffer(
  child: ChildProcessWithoutNullStreams,
): () => string {
  let buffer = "";
  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (chunk: string) => {
    buffer = `${buffer}${chunk}`;
    if (buffer.length > 4_000) {
      buffer = buffer.slice(buffer.length - 4_000);
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

async function runStartupOperation<T>({
  diagnostics,
  operation,
  promise,
}: {
  diagnostics: AcpStartupDiagnostics | undefined;
  operation: string;
  promise: Promise<T>;
}): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (diagnostics === undefined) {
      throw error;
    }
    throw new Error(
      [
        `ACP agent startup failed during ${operation}.`,
        `backend=${formatBackendCommand(diagnostics.backend)}`,
        `exit=${formatExit(diagnostics.childExit.current())}`,
        `error=${error instanceof Error ? error.message : String(error)}`,
        `stderr=${diagnostics.stderr() || "<empty>"}`,
      ].join("\n"),
    );
  }
}

async function notifyCancelSession(
  connection: ClientConnection,
  sessionId: string,
) {
  await connection.agent.notify(acp.methods.agent.session.cancel, {
    sessionId,
  });
}

async function closeAcpSession(
  connection: ClientConnection,
  sessionId: string,
) {
  try {
    await connection.agent.request(acp.methods.agent.session.close, {
      sessionId,
    });
  } catch (error) {
    if (error instanceof acp.RequestError && error.code === -32601) {
      return;
    }
    throw error;
  }
}

async function disposeProtocolSession(
  connection: ClientConnection,
  session: acp.ActiveSession,
) {
  try {
    await notifyCancelSession(connection, session.sessionId);
  } finally {
    session.dispose();
  }
  await closeAcpSession(connection, session.sessionId);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function raceStartup<T>(
  promises: [
    Promise<T>,
    Promise<never> | undefined,
    Promise<never> | undefined,
  ],
): Promise<T> {
  return await Promise.race(
    promises.filter(
      (promise): promise is Promise<T> | Promise<never> =>
        promise !== undefined,
    ),
  );
}

function createAbortFailurePromise(
  signal: AbortSignal | undefined,
): Promise<never> | undefined {
  if (signal === undefined) {
    return undefined;
  }

  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new Error("Agent session was aborted."));
      return;
    }

    signal.addEventListener(
      "abort",
      () => {
        reject(new Error("Agent session was aborted."));
      },
      { once: true },
    );
  });
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted === true) {
    throw new Error("Agent session was aborted.");
  }
}

function killAcpBackend(child: ChildProcessWithoutNullStreams) {
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
