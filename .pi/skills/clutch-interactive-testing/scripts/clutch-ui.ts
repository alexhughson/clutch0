#!/usr/bin/env bun

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_WIDTH = 80;
const DEFAULT_HEIGHT = 24;
const DEFAULT_IDLE_MS = 10 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const START_TIMEOUT_MS = 10_000;

const SPECIAL_KEY_NAMES: Record<string, string> = {
  backspace: "BACKSPACE",
  bs: "BACKSPACE",
  del: "DELETE",
  delete: "DELETE",
  end: "END",
  esc: "ESCAPE",
  escape: "ESCAPE",
  f1: "F1",
  f10: "F10",
  f11: "F11",
  f12: "F12",
  f2: "F2",
  f3: "F3",
  f4: "F4",
  f5: "F5",
  f6: "F6",
  f7: "F7",
  f8: "F8",
  f9: "F9",
  home: "HOME",
  linefeed: "LINEFEED",
  lf: "LINEFEED",
  return: "RETURN",
  tab: "TAB",
};

type SessionRecord = {
  configDir: string;
  cwd: string;
  height: number;
  id: string;
  lastUsedAt: number;
  logPath: string;
  pid: number;
  socketPath: string;
  startedAt: number;
  width: number;
};

type Registry = {
  sessions: SessionRecord[];
};

type Modifiers = {
  ctrl?: boolean;
  hyper?: boolean;
  meta?: boolean;
  shift?: boolean;
  super?: boolean;
};

type DaemonRequest =
  | {
      command: "arrow";
      direction: "down" | "left" | "right" | "up";
      modifiers?: Modifiers;
    }
  | { command: "key"; key: string; modifiers?: Modifiers }
  | { command: "paste"; text: string }
  | { command: "ping" }
  | { command: "resize"; height: number; width: number }
  | { command: "screen" }
  | { command: "spans" }
  | { command: "stop" }
  | { command: "type"; delayMs?: number; text: string }
  | { command: "wait"; ms: number };

type DaemonResponse =
  | { ok: true; result: unknown }
  | { error: string; ok: false; stack?: string };

type DaemonOptions = {
  configCheck: boolean;
  configDir: string;
  cwd: string;
  height: number;
  id: string;
  idleMs: number;
  socketPath: string;
  width: number;
};

type Options = Record<string, string | true>;

type ParsedArgs = {
  options: Options;
  positionals: string[];
};

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "start":
      await startSession(args);
      return;
    case "list":
      listSessions();
      return;
    case "screen":
      await printScreen(args);
      return;
    case "spans":
      await printSpans(args);
      return;
    case "type":
      await sendTextCommand(args, "type");
      return;
    case "paste":
      await sendTextCommand(args, "paste");
      return;
    case "key":
      await sendKey(args);
      return;
    case "arrow":
      await sendArrow(args);
      return;
    case "enter":
      await sendSimpleKey(args, "return");
      return;
    case "escape":
      await sendSimpleKey(args, "escape");
      return;
    case "resize":
      await resizeSession(args);
      return;
    case "wait":
      await waitInSession(args);
      return;
    case "stop":
      await stopSession(args);
      return;
    case "kill":
      await killSessionCommand(args);
      return;
    case "stop-all":
      await stopAllSessions();
      return;
    case "cleanup":
      cleanupSessions();
      return;
    case "__daemon":
      await runDaemon(parseDaemonOptions(args));
      return;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      throw new Error(
        `Unknown command: ${command}\n\nRun: bun ${SCRIPT_PATH} help`,
      );
  }
}

async function startSession(args: string[]) {
  const { options, positionals } = parseArgs(args);
  const id = readSessionIdOption(options, positionals);
  const cwd = resolve(String(options.cwd ?? process.cwd()));
  const width = readPositiveIntegerOption(
    options.width,
    DEFAULT_WIDTH,
    "width",
  );
  const height = readPositiveIntegerOption(
    options.height,
    DEFAULT_HEIGHT,
    "height",
  );
  const idleMs = readPositiveIntegerOption(
    options["idle-ms"],
    DEFAULT_IDLE_MS,
    "idle-ms",
  );
  const replace = options.replace === true;
  const configCheck = options["config-check"] === true;
  const paths = sessionPaths(cwd, id);
  mkdirSync(paths.sessionDir, { recursive: true });

  const existing = getSessionRecord(cwd, id);
  if (existing !== null && isPidAlive(existing.pid)) {
    if (!replace) {
      throw new Error(
        `Session "${id}" is already running with pid ${existing.pid}. Use --replace, stop, or kill.`,
      );
    }
    await killSession(existing, { quiet: true });
  }

  removeSessionRecord(cwd, id);
  rmSync(paths.sessionDir, { recursive: true, force: true });
  mkdirSync(paths.sessionDir, { recursive: true });

  const logFd = openSync(paths.logPath, "a");
  const child = spawn(
    process.execPath,
    [
      SCRIPT_PATH,
      "__daemon",
      "--id",
      id,
      "--cwd",
      cwd,
      "--socket",
      paths.socketPath,
      "--config-dir",
      paths.configDir,
      "--width",
      String(width),
      "--height",
      String(height),
      "--idle-ms",
      String(idleMs),
      ...(configCheck ? ["--config-check"] : []),
    ],
    {
      cwd,
      detached: true,
      env: {
        ...process.env,
        CLUTCH_CONFIG_DIR: paths.configDir,
      },
      stdio: ["ignore", logFd, logFd],
    },
  );
  child.unref();
  closeSync(logFd);

  if (child.pid === undefined) {
    throw new Error("Failed to spawn Clutch UI daemon.");
  }

  const record: SessionRecord = {
    configDir: paths.configDir,
    cwd,
    height,
    id,
    lastUsedAt: Date.now(),
    logPath: paths.logPath,
    pid: child.pid,
    socketPath: paths.socketPath,
    startedAt: Date.now(),
    width,
  };
  upsertSessionRecord(cwd, record);

  try {
    await waitForSessionReady(record);
  } catch (error) {
    await killSession(record, { quiet: true });
    removeSessionRecord(cwd, id);
    throw new Error(
      `Session "${id}" failed to start: ${errorMessage(error)}\nLog: ${paths.logPath}\n${readLogTail(paths.logPath)}`,
    );
  }

  console.log(
    `started ${id} pid=${child.pid} size=${width}x${height} log=${paths.logPath}`,
  );
}

function listSessions() {
  const cwd = resolve(process.cwd());
  cleanupSessions({ quiet: true });
  const registry = readRegistry(cwd);

  if (registry.sessions.length === 0) {
    console.log("no clutch-ui sessions for this project");
    return;
  }

  for (const record of registry.sessions) {
    const alive = isPidAlive(record.pid) ? "alive" : "dead";
    console.log(
      [
        record.id,
        `pid=${record.pid}`,
        alive,
        `size=${record.width}x${record.height}`,
        `started=${new Date(record.startedAt).toISOString()}`,
        `lastUsed=${new Date(record.lastUsedAt).toISOString()}`,
        `log=${record.logPath}`,
      ].join(" "),
    );
  }
}

async function printScreen(args: string[]) {
  const { options, positionals } = parseArgs(args);
  const id = readRequiredPositional(positionals, 0, "session id");
  const result = await requestSession(id, { command: "screen" });
  const screen = parseScreenResult(result);

  if (options.json === true) {
    console.log(JSON.stringify(screen, null, 2));
    return;
  }

  if (options.raw === true) {
    process.stdout.write(screen.frame);
    if (!screen.frame.endsWith("\n")) {
      process.stdout.write("\n");
    }
    return;
  }

  console.log(formatFrame(id, screen));
}

async function printSpans(args: string[]) {
  const id = readRequiredPositional(
    parseArgs(args).positionals,
    0,
    "session id",
  );
  const result = await requestSession(id, { command: "spans" });
  console.log(JSON.stringify(result, null, 2));
}

async function sendTextCommand(args: string[], command: "paste" | "type") {
  const id = readRequiredPositional(args, 0, "session id");
  const text = args.slice(1).join(" ");
  if (text.length === 0) {
    throw new Error(`${command} requires text.`);
  }

  await requestSession(id, { command, text });
  console.log(`${command} sent to ${id}`);
}

async function sendKey(args: string[]) {
  const id = readRequiredPositional(args, 0, "session id");
  const key = readRequiredPositional(args, 1, "key");
  const { options } = parseArgs(args.slice(2));

  await requestSession(id, {
    command: "key",
    key,
    modifiers: readModifiers(options),
  });
  console.log(`key ${formatKeyForLog(key, options)} sent to ${id}`);
}

async function sendArrow(args: string[]) {
  const id = readRequiredPositional(args, 0, "session id");
  const rawDirection = readRequiredPositional(
    args,
    1,
    "direction",
  ).toLowerCase();
  const direction = readArrowDirection(rawDirection);
  const { options } = parseArgs(args.slice(2));

  await requestSession(id, {
    command: "arrow",
    direction,
    modifiers: readModifiers(options),
  });
  console.log(`arrow ${direction} sent to ${id}`);
}

async function sendSimpleKey(args: string[], key: string) {
  const id = readRequiredPositional(args, 0, "session id");
  await requestSession(id, { command: "key", key });
  console.log(`${key} sent to ${id}`);
}

async function resizeSession(args: string[]) {
  const id = readRequiredPositional(args, 0, "session id");
  const width = parsePositiveInteger(
    readRequiredPositional(args, 1, "width"),
    "width",
  );
  const height = parsePositiveInteger(
    readRequiredPositional(args, 2, "height"),
    "height",
  );

  await requestSession(id, { command: "resize", height, width });
  updateSessionRecord(id, (record) => ({ ...record, height, width }));
  console.log(`resized ${id} to ${width}x${height}`);
}

async function waitInSession(args: string[]) {
  const id = readRequiredPositional(args, 0, "session id");
  const ms = parsePositiveInteger(
    readRequiredPositional(args, 1, "milliseconds"),
    "milliseconds",
  );
  await requestSession(
    id,
    { command: "wait", ms },
    Math.max(DEFAULT_REQUEST_TIMEOUT_MS, ms + 1_000),
  );
  console.log(`waited ${ms}ms in ${id}`);
}

async function stopSession(args: string[]) {
  const id = readRequiredPositional(args, 0, "session id");
  const record = requireSessionRecord(resolve(process.cwd()), id);

  try {
    await sendRequest(record, { command: "stop" }, DEFAULT_REQUEST_TIMEOUT_MS);
  } catch (error) {
    throw new Error(
      `Clean stop failed for "${id}": ${errorMessage(error)}\nTry: bun ${SCRIPT_PATH} kill ${id}\nLog: ${record.logPath}`,
    );
  } finally {
    removeSessionRecord(record.cwd, id);
  }

  console.log(`stopped ${id}`);
}

async function killSessionCommand(args: string[]) {
  const id = readRequiredPositional(args, 0, "session id");
  const record = requireSessionRecord(resolve(process.cwd()), id);
  await killSession(record, { quiet: false });
  removeSessionRecord(record.cwd, id);
}

async function stopAllSessions() {
  const cwd = resolve(process.cwd());
  const registry = readRegistry(cwd);
  for (const record of registry.sessions) {
    if (!isPidAlive(record.pid)) {
      removeSessionRecord(cwd, record.id);
      continue;
    }

    try {
      await sendRequest(record, { command: "stop" }, 1_000);
      console.log(`stopped ${record.id}`);
    } catch {
      await killSession(record, { quiet: false });
    } finally {
      removeSessionRecord(cwd, record.id);
    }
  }
}

function cleanupSessions({ quiet = false }: { quiet?: boolean } = {}) {
  const cwd = resolve(process.cwd());
  const registry = readRegistry(cwd);
  let removed = 0;

  for (const record of registry.sessions) {
    if (isPidAlive(record.pid)) {
      continue;
    }

    removeSessionRecord(cwd, record.id);
    rmSync(sessionPaths(cwd, record.id).sessionDir, {
      recursive: true,
      force: true,
    });
    removed += 1;
  }

  if (!quiet) {
    console.log(`removed ${removed} dead session${removed === 1 ? "" : "s"}`);
  }
}

async function requestSession(
  id: string,
  request: DaemonRequest,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const cwd = resolve(process.cwd());
  const record = requireSessionRecord(cwd, id);
  if (!isPidAlive(record.pid)) {
    removeSessionRecord(cwd, id);
    throw new Error(
      `Session "${id}" is not running. Removed stale registry entry.`,
    );
  }

  const result = await sendRequest(record, request, timeoutMs);
  if (request.command !== "stop") {
    updateSessionRecord(id, (current) => ({
      ...current,
      lastUsedAt: Date.now(),
    }));
  }
  return result;
}

async function sendRequest(
  record: SessionRecord,
  request: DaemonRequest,
  timeoutMs: number,
): Promise<unknown> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const socket = net.createConnection(record.socketPath);
    let responseText = "";
    let finished = false;
    const timer = setTimeout(() => {
      fail(
        new Error(`Timed out after ${timeoutMs}ms waiting for ${record.id}.`),
      );
    }, timeoutMs);

    const finish = (value: unknown) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolvePromise(value);
    };

    const fail = (error: unknown) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      rejectPromise(error);
    };

    socket.on("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk) => {
      responseText += chunk.toString("utf8");
    });
    socket.on("error", fail);
    socket.on("end", () => {
      try {
        const response = JSON.parse(responseText) as DaemonResponse;
        if (!response.ok) {
          throw new Error(response.error);
        }
        finish(response.result);
      } catch (error) {
        fail(error);
      }
    });
  });
}

async function waitForSessionReady(record: SessionRecord) {
  const startedAt = Date.now();
  let lastError: unknown = new Error("not ready");

  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (!isPidAlive(record.pid)) {
      throw new Error("daemon exited before becoming ready");
    }

    try {
      await sendRequest(record, { command: "ping" }, 500);
      return;
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }

  throw lastError;
}

async function killSession(
  record: SessionRecord,
  { quiet }: { quiet: boolean },
) {
  if (!isPidAlive(record.pid)) {
    if (!quiet) {
      console.log(`${record.id} already stopped`);
    }
    return;
  }

  try {
    process.kill(record.pid, "SIGTERM");
  } catch {
    // If the process disappeared between checks, the requested outcome is done.
  }

  await waitForProcessExit(record.pid, 1_000);
  if (isPidAlive(record.pid)) {
    try {
      process.kill(record.pid, "SIGKILL");
    } catch {
      // Process may have exited after the last check.
    }
    await waitForProcessExit(record.pid, 1_000);
  }

  if (!quiet) {
    console.log(`killed ${record.id} pid=${record.pid}`);
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isPidAlive(pid)) {
      return;
    }
    await sleep(50);
  }
}

async function runDaemon(options: DaemonOptions) {
  process.chdir(options.cwd);
  process.env.CLUTCH_CONFIG_DIR = options.configDir;
  mkdirSync(options.configDir, { recursive: true });
  rmSocketIfPresent(options.socketPath);

  const { setup, act } = await createRenderedApp(options);
  let lastUsedAt = Date.now();
  let stopping = false;
  let idleTimer: ReturnType<typeof setInterval> | null = null;

  const server = net.createServer((socket) => {
    let requestText = "";
    let handled = false;

    const handleRequestText = () => {
      if (handled || requestText.length === 0) {
        return;
      }
      handled = true;
      void (async () => {
        let request: DaemonRequest | null = null;
        try {
          request = JSON.parse(requestText.trimEnd()) as DaemonRequest;
          lastUsedAt = Date.now();
          const result = await handleDaemonRequest({
            act,
            options,
            request,
            setup,
          });
          socket.end(
            JSON.stringify({ ok: true, result } satisfies DaemonResponse),
          );
        } catch (error) {
          socket.end(
            JSON.stringify({
              error: errorMessage(error),
              ok: false,
              stack: error instanceof Error ? error.stack : undefined,
            } satisfies DaemonResponse),
          );
        } finally {
          if (request?.command === "stop") {
            stopping = true;
            setTimeout(() => shutdown(0), 0);
          }
        }
      })();
    };

    socket.on("data", (chunk) => {
      requestText += chunk.toString("utf8");
      if (requestText.includes("\n")) {
        handleRequestText();
      }
    });
    socket.on("end", handleRequestText);
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(options.socketPath, () => {
      server.off("error", rejectPromise);
      resolvePromise();
    });
  });

  idleTimer = setInterval(
    () => {
      if (!stopping && Date.now() - lastUsedAt >= options.idleMs) {
        console.error(
          `idle timeout after ${options.idleMs}ms; stopping ${options.id}`,
        );
        stopping = true;
        shutdown(0);
      }
    },
    Math.min(30_000, Math.max(1_000, options.idleMs)),
  );

  function shutdown(code: number) {
    if (idleTimer !== null) {
      clearInterval(idleTimer);
    }
    server.close();
    try {
      setup.renderer.destroy();
    } catch (error) {
      console.error(errorMessage(error));
    }
    rmSocketIfPresent(options.socketPath);
    process.exit(code);
  }

  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));
  process.on("uncaughtException", (error) => {
    console.error(error);
    shutdown(1);
  });
  process.on("unhandledRejection", (error) => {
    console.error(error);
    shutdown(1);
  });

  console.error(`clutch-ui daemon ready id=${options.id} pid=${process.pid}`);
}

async function createRenderedApp(options: DaemonOptions) {
  const [{ testRender }, { act, createElement }] = await Promise.all([
    import("@opentui/react/test-utils"),
    import("react"),
  ]);

  const appModule = await import(
    pathToFileURL(join(options.cwd, "src/App.tsx")).href
  );
  const fileListModule = await import(
    pathToFileURL(join(options.cwd, "src/lib/fileListLoader.ts")).href
  );
  const agentResourcesModule = await import(
    pathToFileURL(
      join(options.cwd, "src/workflows/agentAsk/agentAskResources.ts"),
    ).href
  );
  const toolRegistryModule = await import(
    pathToFileURL(join(options.cwd, "src/workflows/llmTools/toolRegistry.ts"))
      .href
  );

  const agentAskSkillSlashCommands =
    await agentResourcesModule.loadAgentAskSkillSlashCommands();
  toolRegistryModule.setAgentAskSkillSlashCommands(agentAskSkillSlashCommands);

  if (options.configCheck) {
    const [configModule, storeModule] = await Promise.all([
      import(
        pathToFileURL(join(options.cwd, "src/lib/config/clutchConfig.ts")).href
      ),
      import(pathToFileURL(join(options.cwd, "src/store/appStore.ts")).href),
    ]);
    if (!configModule.isClutchConfigured()) {
      storeModule.useAppStore.getState().actions.config.openSetup();
    }
  }

  const filePaths = await fileListModule.loadFileList();
  const setup = await testRender(createElement(appModule.App, { filePaths }), {
    height: options.height,
    width: options.width,
  });
  await renderStable({ act, frames: 3, setup });

  return { act, setup };
}

async function handleDaemonRequest({
  act,
  options,
  request,
  setup,
}: {
  act: (callback: () => Promise<void> | void) => Promise<void>;
  options: DaemonOptions;
  request: DaemonRequest;
  setup: Awaited<
    ReturnType<typeof import("@opentui/react/test-utils").testRender>
  >;
}) {
  switch (request.command) {
    case "ping":
      return { id: options.id, pid: process.pid };
    case "screen":
      await renderStable({ act, frames: 1, setup });
      return captureScreen(setup);
    case "spans":
      await renderStable({ act, frames: 1, setup });
      return setup.captureSpans();
    case "type":
      assertString(request.text, "type.text");
      await act(async () => {
        await setup.mockInput.typeText(request.text, request.delayMs ?? 0);
      });
      await renderStable({ act, frames: 3, setup });
      return captureScreen(setup);
    case "paste":
      assertString(request.text, "paste.text");
      await act(async () => {
        await setup.mockInput.pasteBracketedText(request.text);
      });
      await renderStable({ act, frames: 3, setup });
      return captureScreen(setup);
    case "key":
      assertString(request.key, "key.key");
      await act(async () => {
        pressKey(setup.mockInput, request.key, request.modifiers);
      });
      await renderStable({ act, frames: 3, setup });
      return captureScreen(setup);
    case "arrow":
      await act(async () => {
        setup.mockInput.pressArrow(request.direction, request.modifiers);
      });
      await renderStable({ act, frames: 3, setup });
      return captureScreen(setup);
    case "resize":
      await act(async () => {
        setup.resize(request.width, request.height);
      });
      await renderStable({ act, frames: 3, setup });
      return captureScreen(setup);
    case "wait":
      await sleep(request.ms);
      await renderStable({ act, frames: 3, setup });
      return captureScreen(setup);
    case "stop":
      return { stopping: true };
    default:
      assertNever(request);
  }
}

async function renderStable({
  act,
  frames,
  setup,
}: {
  act: (callback: () => Promise<void> | void) => Promise<void>;
  frames: number;
  setup: Awaited<
    ReturnType<typeof import("@opentui/react/test-utils").testRender>
  >;
}) {
  for (let index = 0; index < frames; index += 1) {
    await act(async () => {
      await setup.renderOnce();
    });
    await sleep(0);
  }
}

function captureScreen(
  setup: Awaited<
    ReturnType<typeof import("@opentui/react/test-utils").testRender>
  >,
) {
  const spans = setup.captureSpans();
  return {
    cols: spans.cols,
    cursor: spans.cursor,
    frame: setup.captureCharFrame(),
    rows: spans.rows,
  };
}

function pressKey(
  mockInput: Awaited<
    ReturnType<typeof import("@opentui/react/test-utils").testRender>
  >["mockInput"],
  key: string,
  modifiers?: Modifiers,
) {
  const normalized = key.toLowerCase();

  if (normalized === "enter" || normalized === "return") {
    mockInput.pressEnter(modifiers);
    return;
  }
  if (normalized === "escape" || normalized === "esc") {
    mockInput.pressEscape(modifiers);
    return;
  }
  if (normalized === "tab") {
    mockInput.pressTab(modifiers);
    return;
  }
  if (normalized === "backspace" || normalized === "bs") {
    mockInput.pressBackspace(modifiers);
    return;
  }
  if (normalized === "space") {
    mockInput.pressKey(" ", modifiers);
    return;
  }
  if (["down", "left", "right", "up"].includes(normalized)) {
    mockInput.pressArrow(
      normalized as "down" | "left" | "right" | "up",
      modifiers,
    );
    return;
  }

  const specialKey = SPECIAL_KEY_NAMES[normalized];
  if (specialKey !== undefined) {
    mockInput.pressKey(specialKey, modifiers);
    return;
  }

  if (key.length === 1) {
    mockInput.pressKey(key, modifiers);
    return;
  }

  throw new Error(`Unknown key "${key}".`);
}

function parseDaemonOptions(args: string[]): DaemonOptions {
  const { options } = parseArgs(args);
  const id = String(options.id ?? "");
  validateSessionId(id);
  return {
    configCheck: options["config-check"] === true,
    configDir: readStringOption(options, "config-dir"),
    cwd: resolve(readStringOption(options, "cwd")),
    height: readPositiveIntegerOption(options.height, DEFAULT_HEIGHT, "height"),
    id,
    idleMs: readPositiveIntegerOption(
      options["idle-ms"],
      DEFAULT_IDLE_MS,
      "idle-ms",
    ),
    socketPath: readStringOption(options, "socket"),
    width: readPositiveIntegerOption(options.width, DEFAULT_WIDTH, "width"),
  };
}

function parseArgs(args: string[]): ParsedArgs {
  const options: Options = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const optionText = arg.slice(2);
    const equalsIndex = optionText.indexOf("=");
    if (equalsIndex !== -1) {
      options[optionText.slice(0, equalsIndex)] = optionText.slice(
        equalsIndex + 1,
      );
      continue;
    }

    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[optionText] = next;
      index += 1;
      continue;
    }

    options[optionText] = true;
  }

  return { options, positionals };
}

function readSessionIdOption(options: Options, positionals: string[]): string {
  const id = String(options.id ?? positionals[0] ?? "");
  validateSessionId(id);
  return id;
}

function validateSessionId(id: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(id)) {
    throw new Error(
      "Session id must be 1-40 chars: letters, numbers, dot, underscore, hyphen; first char must be alphanumeric.",
    );
  }
}

function readRequiredPositional(
  args: string[],
  index: number,
  label: string,
): string {
  const value = args[index];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing ${label}.`);
  }
  return value;
}

function readStringOption(options: Options, name: string): string {
  const value = options[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing --${name}.`);
  }
  return value;
}

function readPositiveIntegerOption(
  value: string | true | undefined,
  fallback: number,
  label: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (value === true) {
    throw new Error(`--${label} requires a value.`);
  }
  return parsePositiveInteger(value, label);
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function readModifiers(options: Options): Modifiers | undefined {
  const modifiers: Modifiers = {
    ctrl: options.ctrl === true,
    hyper: options.hyper === true,
    meta:
      options.meta === true || options.alt === true || options.option === true,
    shift: options.shift === true,
    super: options.super === true,
  };
  return Object.values(modifiers).some(Boolean) ? modifiers : undefined;
}

function readArrowDirection(
  direction: string,
): "down" | "left" | "right" | "up" {
  if (
    direction === "down" ||
    direction === "left" ||
    direction === "right" ||
    direction === "up"
  ) {
    return direction;
  }
  throw new Error(`Unknown arrow direction "${direction}".`);
}

function formatKeyForLog(key: string, options: Options): string {
  const parts = [key];
  for (const modifier of [
    "ctrl",
    "shift",
    "meta",
    "alt",
    "option",
    "super",
    "hyper",
  ]) {
    if (options[modifier] === true) {
      parts.push(`--${modifier}`);
    }
  }
  return parts.join(" ");
}

function parseScreenResult(result: unknown): {
  cols: number;
  cursor: [number, number];
  frame: string;
  rows: number;
} {
  if (result === null || typeof result !== "object") {
    throw new Error("Daemon returned malformed screen result.");
  }
  const candidate = result as Record<string, unknown>;
  if (
    typeof candidate.frame !== "string" ||
    typeof candidate.cols !== "number" ||
    typeof candidate.rows !== "number" ||
    !Array.isArray(candidate.cursor)
  ) {
    throw new Error("Daemon returned malformed screen result.");
  }
  return candidate as {
    cols: number;
    cursor: [number, number];
    frame: string;
    rows: number;
  };
}

function formatFrame(
  id: string,
  screen: {
    cols: number;
    cursor: [number, number];
    frame: string;
    rows: number;
  },
): string {
  const lines = screen.frame.endsWith("\n")
    ? screen.frame.slice(0, -1).split("\n")
    : screen.frame.split("\n");
  const lineNumberWidth = String(Math.max(screen.rows, lines.length)).length;
  const formattedLines = lines.map((line, index) => {
    const lineNumber = String(index + 1).padStart(lineNumberWidth, "0");
    return `${lineNumber} │ ${line.replace(/[ \t]+$/g, "")}`;
  });

  return [
    `[${id} ${screen.cols}x${screen.rows} cursor=${screen.cursor.join(",")}]`,
    ...formattedLines,
  ].join("\n");
}

function baseDir(cwd: string): string {
  return join("/tmp", `cui-${hashText(cwd).slice(0, 16)}`);
}

function registryPath(cwd: string): string {
  return join(baseDir(cwd), "registry.json");
}

function sessionPaths(cwd: string, id: string) {
  const sessionDir = join(baseDir(cwd), "sessions", id);
  return {
    configDir: join(sessionDir, "config"),
    logPath: join(sessionDir, "daemon.log"),
    sessionDir,
    socketPath: join(sessionDir, "s"),
  };
}

function readRegistry(cwd: string): Registry {
  const path = registryPath(cwd);
  if (!existsSync(path)) {
    return { sessions: [] };
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as Registry;
  if (!Array.isArray(parsed.sessions)) {
    throw new Error(`Malformed clutch-ui registry: ${path}`);
  }
  return parsed;
}

function writeRegistry(cwd: string, registry: Registry) {
  mkdirSync(baseDir(cwd), { recursive: true });
  writeFileSync(registryPath(cwd), JSON.stringify(registry, null, 2));
}

function getSessionRecord(cwd: string, id: string): SessionRecord | null {
  return readRegistry(cwd).sessions.find((record) => record.id === id) ?? null;
}

function requireSessionRecord(cwd: string, id: string): SessionRecord {
  validateSessionId(id);
  const record = getSessionRecord(cwd, id);
  if (record === null) {
    throw new Error(
      `No session "${id}" for ${cwd}. Run list or start it first.`,
    );
  }
  return record;
}

function upsertSessionRecord(cwd: string, record: SessionRecord) {
  const registry = readRegistry(cwd);
  writeRegistry(cwd, {
    sessions: [
      ...registry.sessions.filter((candidate) => candidate.id !== record.id),
      record,
    ].sort((a, b) => a.id.localeCompare(b.id)),
  });
}

function updateSessionRecord(
  id: string,
  update: (record: SessionRecord) => SessionRecord,
) {
  const cwd = resolve(process.cwd());
  const registry = readRegistry(cwd);
  writeRegistry(cwd, {
    sessions: registry.sessions.map((record) =>
      record.id === id ? update(record) : record,
    ),
  });
}

function removeSessionRecord(cwd: string, id: string) {
  const registry = readRegistry(cwd);
  writeRegistry(cwd, {
    sessions: registry.sessions.filter((record) => record.id !== id),
  });
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code === "EPERM";
  }
}

function rmSocketIfPresent(socketPath: string) {
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }
}

function readLogTail(path: string): string {
  if (!existsSync(path)) {
    return "";
  }
  const content = readFileSync(path, "utf8");
  const lines = content.trimEnd().split("\n");
  return lines.slice(-40).join("\n");
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled request: ${JSON.stringify(value)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printHelp() {
  console.log(`Usage:
  bun ${SCRIPT_PATH} start --id <id> [--width 80] [--height 24] [--replace] [--config-check]
  bun ${SCRIPT_PATH} screen <id> [--raw|--json]
  bun ${SCRIPT_PATH} spans <id>
  bun ${SCRIPT_PATH} type <id> <text>
  bun ${SCRIPT_PATH} paste <id> <text>
  bun ${SCRIPT_PATH} key <id> <key> [--ctrl] [--shift] [--meta]
  bun ${SCRIPT_PATH} arrow <id> <up|down|left|right>
  bun ${SCRIPT_PATH} enter <id>
  bun ${SCRIPT_PATH} escape <id>
  bun ${SCRIPT_PATH} resize <id> <width> <height>
  bun ${SCRIPT_PATH} wait <id> <milliseconds>
  bun ${SCRIPT_PATH} list
  bun ${SCRIPT_PATH} stop <id>
  bun ${SCRIPT_PATH} kill <id>
  bun ${SCRIPT_PATH} stop-all
  bun ${SCRIPT_PATH} cleanup`);
}
