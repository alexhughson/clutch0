import type { AgentSessionDriver } from "../../lib/agent/agentSessionDriver";
import { getAgentHarness } from "../../lib/agent/harnessRegistry";
import type {
  AgentHarnessPersistence,
  AgentHarnessRuntimeContext,
  ClutchAgentHarnessSettings,
} from "../../lib/agent/harnessTypes";
import { registerBuiltinAgentHarnesses } from "../../lib/agent/harnesses/registerBuiltinHarnesses";
import { createAgentToolBlock } from "../../lib/agentOutput/agentOutputBlocks";
import type { AgentOutputUpdate } from "../../lib/agentOutput/agentOutputTypes";
import {
  getClutchConfigPaths,
  hasUsableApiKey,
  loadClutchAuth,
  resolveConfiguredAgentHarness,
} from "../../lib/config/clutchConfig";
import { PiAgentContextItem } from "../../lib/context/contextItems";
import { buildAgentPromptWithContext } from "../../lib/llm/agentContext";
import { recordSessionRuntimeEvent, useAppStore } from "../../store/appStore";
import type { ContextItem } from "../../types";
import {
  createAgentSandbox,
  getAgentSandboxDiff,
  openAgentSandboxFromPersisted,
  removeAgentSandbox,
  type AgentSandbox,
} from "./agentSandbox";

type AgentAskHandle = {
  activePromptCount: number;
  driver: AgentSessionDriver;
  harnessKind: string;
  sandbox?: AgentSandbox;
};

type AgentAskStartupHandle = {
  abort: () => void;
  done: Promise<void>;
  driver?: AgentSessionDriver;
  sandbox?: AgentSandbox;
  registered: boolean;
};

const agentAskSessions = new Map<string, AgentAskHandle>();
const agentAskStartups = new Map<string, AgentAskStartupHandle>();
const agentAskRehydrations = new Map<
  string,
  {
    abort: () => void;
    done: Promise<AgentAskHandle>;
  }
>();

type CreateHarnessSessionDriver = (options: {
  ctx: AgentHarnessRuntimeContext;
  harness: ClutchAgentHarnessSettings;
  session: unknown;
}) => Promise<AgentSessionDriver>;

type CreateHarnessSession = (options: {
  ctx: AgentHarnessRuntimeContext;
  harness: ClutchAgentHarnessSettings;
}) => Promise<unknown>;

let createHarnessSessionDriver: CreateHarnessSessionDriver =
  defaultCreateHarnessSessionDriver;
let createHarnessSession: CreateHarnessSession = defaultCreateHarnessSession;

export function setAgentHarnessFactoriesForTest({
  createSession,
  createSessionDriver,
}: {
  createSession?: CreateHarnessSession;
  createSessionDriver?: CreateHarnessSessionDriver;
}) {
  const previousSession = createHarnessSession;
  const previousDriver = createHarnessSessionDriver;
  if (createSession !== undefined) {
    createHarnessSession = createSession;
  }
  if (createSessionDriver !== undefined) {
    createHarnessSessionDriver = createSessionDriver;
  }
  return () => {
    createHarnessSession = previousSession;
    createHarnessSessionDriver = previousDriver;
  };
}

async function defaultCreateHarnessSession({
  ctx,
  harness,
}: {
  ctx: AgentHarnessRuntimeContext;
  harness: ClutchAgentHarnessSettings;
}): Promise<unknown> {
  registerBuiltinAgentHarnesses();
  const definition = getAgentHarness(harness.kind);
  const config = definition.parseConfig(harness.config);
  return await definition.createSession(ctx, config);
}

async function defaultCreateHarnessSessionDriver({
  ctx,
  harness,
  session,
}: {
  ctx: AgentHarnessRuntimeContext;
  harness: ClutchAgentHarnessSettings;
  session: unknown;
}): Promise<AgentSessionDriver> {
  registerBuiltinAgentHarnesses();
  const definition = getAgentHarness(harness.kind);
  const config = definition.parseConfig(harness.config);
  const parsedSession = definition.parseSession(session);
  return await definition.createSessionDriver(ctx, config, parsedSession);
}

export async function startAgentSession({
  itemId,
  contextItems,
  focusedContextItemId,
  prompt,
  root = process.cwd(),
  signal,
}: {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  itemId: string;
  prompt: string;
  root?: string;
  signal?: AbortSignal;
}) {
  if (agentAskSessions.has(itemId) || agentAskStartups.has(itemId)) {
    throw new Error(`Agent session already exists for context item ${itemId}.`);
  }

  const abortHandle = createStartupAbortHandle(signal);
  const startup: AgentAskStartupHandle = {
    abort: abortHandle.abort,
    done: Promise.resolve(),
    registered: false,
  };
  agentAskStartups.set(itemId, startup);
  startup.done = runAgentSessionStartup({
    contextItems,
    focusedContextItemId,
    itemId,
    prompt,
    root,
    signal: abortHandle.signal,
    startup,
  }).finally(() => {
    abortHandle.dispose();
    agentAskStartups.delete(itemId);
  });
  await startup.done;
}

async function runAgentSessionStartup({
  itemId,
  contextItems,
  focusedContextItemId,
  prompt,
  root,
  signal,
  startup,
}: {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  itemId: string;
  prompt: string;
  root: string;
  signal: AbortSignal;
  startup: AgentAskStartupHandle;
}) {
  recordSessionRuntimeEvent({
    contextItemIds: contextItems.map((item) => item.id),
    focusedContextItemId,
    itemId,
    kind: "agent-session.started",
  });

  try {
    throwIfAgentSessionAborted(signal);
    const harness = resolveConfiguredAgentHarness();
    assertConfiguredHarnessAuth(harness, loadClutchAuth(getClutchConfigPaths()));

    const sandbox = await createAgentSandbox({ root, signal });
    startup.sandbox = sandbox;
    throwIfAgentSessionAborted(signal);
    const sessionRoot = sandbox.path;
    useAppStore.getState().actions.agentAsk.attachSandbox({
      itemId,
      sandbox: {
        baselineTree: sandbox.baselineTree,
        diffStatus: "unknown",
        path: sandbox.path,
        root: sandbox.root,
      },
    });
    recordSessionRuntimeEvent({
      itemId,
      kind: "agent-session.sandbox-attached",
      sandboxPath: sandbox.path,
    });

    const initialPrompt = await buildInitialAgentPrompt({
      contextItems,
      focusedContextItemId,
      prompt,
      root: sessionRoot,
    });
    throwIfAgentSessionAborted(signal);

    const runtimeCtx = createRuntimeContext({
      cwd: sessionRoot,
      itemId,
      signal,
    });
    const session = await createHarnessSession({
      ctx: runtimeCtx,
      harness,
    });
    throwIfAgentSessionAborted(signal);

    const harnessPersistence: AgentHarnessPersistence = {
      kind: harness.kind,
      session,
    };
    useAppStore.getState().actions.agentAsk.attachHarness({
      harness: harnessPersistence,
      itemId,
    });

    const driver = await createAgentSessionDriverWithAbort({
      create: () =>
        createHarnessSessionDriver({
          ctx: runtimeCtx,
          harness,
          session,
        }),
      signal,
    });
    startup.driver = driver;
    throwIfAgentSessionAborted(signal);

    agentAskSessions.set(itemId, {
      activePromptCount: 0,
      driver,
      harnessKind: harness.kind,
      sandbox,
    });
    startup.registered = true;
    startup.sandbox = undefined;
    startup.driver = undefined;
    useAppStore.getState().actions.agentAsk.recordOutput({
      itemId,
      update: {
        block: createAgentToolBlock({
          phase: "start",
          summary: "agent sandbox session",
          toolName: "agent",
        }),
        kind: "append-block",
      },
    });
    await runAgentPrompt(itemId, initialPrompt);
  } catch (error) {
    await disposeAgentAskStartup(startup);
    recordSessionRuntimeEvent({
      errorMessage: error instanceof Error ? error.message : String(error),
      itemId,
      kind: "agent-session.failed",
    });
    useAppStore.getState().actions.agentAsk.fail({
      errorMessage: error instanceof Error ? error.message : String(error),
      itemId,
    });
  }
}

function throwIfAgentSessionAborted(signal: AbortSignal | undefined) {
  if (isAgentSessionAborted(signal)) {
    throw new Error("Agent session was aborted.");
  }
}

function isAgentSessionAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function buildInitialAgentPrompt({
  contextItems,
  focusedContextItemId,
  prompt,
  root,
}: {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  prompt: string;
  root: string;
}) {
  return await buildAgentPromptWithContext({
    contextItems,
    focusedContextItemId,
    prompt,
    root,
  });
}

export async function sendAgentAskMessage({
  itemId,
  message,
}: {
  itemId: string;
  message: string;
}) {
  if (message.trim().length === 0) {
    return;
  }

  try {
    await ensureHandle(itemId);
  } catch (error) {
    useAppStore.getState().actions.agentAsk.fail({
      errorMessage: error instanceof Error ? error.message : String(error),
      itemId,
    });
    return;
  }

  useAppStore.getState().actions.agentAsk.startMessage({ itemId });
  try {
    await runAgentPrompt(itemId, message);
  } catch (error) {
    useAppStore.getState().actions.agentAsk.fail({
      errorMessage: error instanceof Error ? error.message : String(error),
      itemId,
    });
  }
}

async function ensureHandle(itemId: string): Promise<AgentAskHandle> {
  const existing = agentAskSessions.get(itemId);
  if (existing !== undefined) {
    return existing;
  }

  if (agentAskStartups.has(itemId)) {
    throw new Error(
      "Agent session is still starting. Wait for the first reply before following up.",
    );
  }

  const inFlight = agentAskRehydrations.get(itemId);
  if (inFlight !== undefined) {
    return await inFlight.done;
  }

  const controller = new AbortController();
  const done = rehydrateHandle(itemId, controller.signal).finally(() => {
    agentAskRehydrations.delete(itemId);
  });
  agentAskRehydrations.set(itemId, {
    abort: () => controller.abort(),
    done,
  });
  return await done;
}

async function rehydrateHandle(
  itemId: string,
  signal: AbortSignal,
): Promise<AgentAskHandle> {
  const existing = agentAskSessions.get(itemId);
  if (existing !== undefined) {
    return existing;
  }

  const item = useAppStore
    .getState()
    .workspace.contextItems.find((candidate) => candidate.id === itemId);
  if (!(item instanceof PiAgentContextItem)) {
    throw new Error(`Agent context item ${itemId} was not found.`);
  }
  if (item.harness === undefined) {
    throw new Error(
      "This agent session has no persisted harness state and cannot be resumed.",
    );
  }
  if (item.sessionAvailability === "detached") {
    throw new Error(
      "This agent session is detached and cannot be resumed in this Clutch process.",
    );
  }

  throwIfAgentSessionAborted(signal);
  registerBuiltinAgentHarnesses();
  const definition = getAgentHarness(item.harness.kind);
  const session = definition.parseSession(item.harness.session);
  const sandbox = await reopenSandboxForItem(item);
  throwIfAgentSessionAborted(signal);
  const cwd = sandbox.path;
  const resume = definition.canResume(session, { cwd });
  if (!resume.ok) {
    useAppStore.getState().actions.agentAsk.fail({
      errorMessage: `Cannot resume agent session: ${resume.reason}`,
      itemId,
    });
    throw new Error(`Cannot resume agent session: ${resume.reason}`);
  }

  // Follow-up uses the item's harness kind; config comes from current settings
  // only when kind matches. Otherwise use harness defaultConfig for that kind.
  const configured = resolveConfiguredAgentHarness();
  const harness: ClutchAgentHarnessSettings =
    configured.kind === item.harness.kind
      ? configured
      : {
          kind: item.harness.kind,
          config: definition.defaultConfig,
        };

  const runtimeCtx = createRuntimeContext({
    cwd,
    itemId,
    signal,
  });
  const driver = await createHarnessSessionDriver({
    ctx: runtimeCtx,
    harness,
    session,
  });

  if (signal.aborted) {
    await driver.dispose().catch(() => {});
    throw new Error("Agent session was aborted.");
  }

  const handle: AgentAskHandle = {
    activePromptCount: 0,
    driver,
    harnessKind: item.harness.kind,
    sandbox,
  };
  agentAskSessions.set(itemId, handle);
  return handle;
}

async function reopenSandboxForItem(
  item: PiAgentContextItem,
): Promise<AgentSandbox> {
  if (item.sandbox === undefined) {
    throw new Error("Agent session is missing persisted sandbox metadata.");
  }
  return await openAgentSandboxFromPersisted(item.sandbox);
}

/** Hard dispose: kill driver and delete sandbox. Used when the context item is removed. */
export async function disposeAgentAskSession(itemId: string): Promise<void> {
  const startup = agentAskStartups.get(itemId);
  if (startup !== undefined) {
    startup.abort();
    await startup.done;
  }

  const rehydration = agentAskRehydrations.get(itemId);
  if (rehydration !== undefined) {
    rehydration.abort();
    await rehydration.done.catch(() => {});
  }

  const handle = agentAskSessions.get(itemId);
  if (handle !== undefined) {
    try {
      await handle.driver.dispose();
      recordSessionRuntimeEvent({
        itemId,
        kind: "agent-session.disposed",
        sandboxPath: handle.sandbox?.path,
      });
    } finally {
      agentAskSessions.delete(itemId);
      if (handle.sandbox !== undefined) {
        await removeAgentSandbox(handle.sandbox);
      }
    }
    return;
  }

  // Soft-released or restored session: still hard-remove persisted edit sandbox.
  const item = useAppStore
    .getState()
    .workspace.contextItems.find((candidate) => candidate.id === itemId);
  if (item instanceof PiAgentContextItem && item.sandbox !== undefined) {
    await removeAgentSandbox({
      path: item.sandbox.path,
      root: item.sandbox.root,
    });
    recordSessionRuntimeEvent({
      itemId,
      kind: "agent-session.disposed",
      sandboxPath: item.sandbox.path,
    });
  }
}

/** Soft release on Clutch exit: dispose drivers, keep sandboxes + item.harness. */
export async function releaseAllAgentHandles(): Promise<void> {
  const startups = [...agentAskStartups.values()];
  for (const startup of startups) {
    startup.abort();
  }
  await Promise.all(startups.map((startup) => startup.done));

  const rehydrations = [...agentAskRehydrations.values()];
  for (const rehydration of rehydrations) {
    rehydration.abort();
  }
  await Promise.all(rehydrations.map((rehydration) => rehydration.done.catch(() => {})));
  agentAskRehydrations.clear();

  const handles = [...agentAskSessions.entries()];
  agentAskSessions.clear();
  await Promise.all(
    handles.map(async ([itemId, handle]) => {
      try {
        await handle.driver.dispose();
        recordSessionRuntimeEvent({
          itemId,
          kind: "agent-session.released",
          sandboxPath: handle.sandbox?.path,
        });
      } catch {
        // best-effort on shutdown
      }
    }),
  );
}

export async function saveAgentSandboxDiffToContext(itemId: string) {
  const handle = agentAskSessions.get(itemId);
  let sandbox = handle?.sandbox;
  if (sandbox === undefined) {
    const item = useAppStore
      .getState()
      .workspace.contextItems.find((candidate) => candidate.id === itemId);
    if (!(item instanceof PiAgentContextItem) || item.sandbox === undefined) {
      useAppStore.getState().actions.agentAsk.fail({
        errorMessage: "This agent edit session does not have an active sandbox.",
        itemId,
      });
      return;
    }
    sandbox = await openAgentSandboxFromPersisted(item.sandbox);
    if (handle !== undefined) {
      handle.sandbox = sandbox;
    }
  }

  const diff = await refreshAgentSandboxDiff(itemId, sandbox);
  if (diff.diffText.trim().length === 0) {
    useAppStore.getState().actions.agentAsk.recordOutput({
      itemId,
      update: {
        block: createAgentToolBlock({
          phase: "end",
          summary: "No sandbox changes to add to context.",
          toolName: "git diff",
        }),
        kind: "append-block",
      },
    });
    return;
  }

  useAppStore.getState().actions.agentAsk.saveSandboxDiffToContext({
    agentItemId: itemId,
    diffText: diff.diffText,
    summary: diff.summary,
  });
  recordSessionRuntimeEvent({
    itemId,
    kind: "agent-session.sandbox-diff-saved",
    summary: diff.summary,
  });
}

async function runAgentPrompt(itemId: string, message: string) {
  const handle = agentAskSessions.get(itemId);
  if (handle === undefined) {
    throw new Error(`Agent session handle missing for ${itemId}.`);
  }

  handle.activePromptCount += 1;
  try {
    recordSessionRuntimeEvent({
      followUp: handle.activePromptCount > 1,
      itemId,
      kind: "agent-session.prompt-started",
      messageLength: message.length,
    });

    await handle.driver.prompt(message);
    recordFinalAgentOutput(itemId, handle);
    if (handle.sandbox !== undefined) {
      await refreshAgentSandboxDiff(itemId, handle.sandbox);
    }
    recordSessionRuntimeEvent({
      itemId,
      kind: "agent-session.prompt-finished",
    });
    handle.activePromptCount -= 1;
    if (handle.activePromptCount === 0) {
      useAppStore.getState().actions.agentAsk.finish({ itemId });
    }
  } catch (error) {
    handle.activePromptCount = Math.max(0, handle.activePromptCount - 1);
    recordSessionRuntimeEvent({
      errorMessage: error instanceof Error ? error.message : String(error),
      itemId,
      kind: "agent-session.prompt-failed",
    });
    useAppStore.getState().actions.agentAsk.fail({
      errorMessage: error instanceof Error ? error.message : String(error),
      itemId,
    });
  }
}

function recordFinalAgentOutput(itemId: string, handle: AgentAskHandle) {
  const latestAssistantText = handle.driver.latestAssistantText();
  const messageLength = latestAssistantText?.trim().length ?? 0;
  if (messageLength === 0) {
    return;
  }

  recordSessionRuntimeEvent({
    itemId,
    kind: "agent-session.final-output-reconciled",
    messageLength,
    updateCount: 0,
  });
}

function assertConfiguredHarnessAuth(
  harness: ClutchAgentHarnessSettings,
  auth: ReturnType<typeof loadClutchAuth>,
): void {
  registerBuiltinAgentHarnesses();
  const definition = getAgentHarness(harness.kind);
  for (const providerId of definition.authProviderIds) {
    if (!hasUsableApiKey(auth[providerId])) {
      throw new Error(
        `Missing API key for ${definition.label} (provider "${providerId}"). Configure it under /config → agent harness.`,
      );
    }
  }
}

function recordAgentOutputUpdates({
  itemId,
  source,
  updates,
}: {
  itemId: string;
  source: "event";
  updates: readonly AgentOutputUpdate[];
}) {
  for (const update of updates) {
    recordSessionRuntimeEvent({
      itemId,
      kind: "agent-session.output",
      source,
      updateKind: update.kind,
    });
    useAppStore.getState().actions.agentAsk.recordOutput({ itemId, update });
  }
}

async function refreshAgentSandboxDiff(itemId: string, sandbox: AgentSandbox) {
  try {
    const diff = await getAgentSandboxDiff(sandbox);
    useAppStore.getState().actions.agentAsk.updateSandboxDiff({
      itemId,
      sandbox: {
        baselineTree: sandbox.baselineTree,
        diffStatus: diff.diffText.trim().length === 0 ? "clean" : "dirty",
        path: sandbox.path,
        root: sandbox.root,
        summary: diff.summary,
      },
    });
    return diff;
  } catch (error) {
    useAppStore.getState().actions.agentAsk.updateSandboxDiff({
      itemId,
      sandbox: {
        baselineTree: sandbox.baselineTree,
        diffStatus: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
        path: sandbox.path,
        root: sandbox.root,
      },
    });
    throw error;
  }
}

function createRuntimeContext({
  cwd,
  itemId,
  signal,
}: {
  cwd: string;
  itemId: string;
  signal?: AbortSignal;
}): AgentHarnessRuntimeContext {
  const paths = getClutchConfigPaths();
  return {
    auth: loadClutchAuth(paths),
    configDir: paths.configDir,
    cwd,
    onOutputUpdate: (update) => {
      recordAgentOutputUpdates({
        itemId,
        source: "event",
        updates: [update],
      });
    },
    signal,
  };
}

function createStartupAbortHandle(parentSignal: AbortSignal | undefined): {
  abort: () => void;
  dispose: () => void;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };

  if (parentSignal?.aborted === true) {
    controller.abort();
  } else {
    parentSignal?.addEventListener("abort", abort, { once: true });
  }

  return {
    abort,
    dispose: () => {
      parentSignal?.removeEventListener("abort", abort);
    },
    signal: controller.signal,
  };
}

async function disposeAgentAskStartup(
  startup: AgentAskStartupHandle,
): Promise<void> {
  if (startup.registered) {
    return;
  }

  try {
    await startup.driver?.dispose();
  } finally {
    if (startup.sandbox !== undefined) {
      await removeAgentSandbox(startup.sandbox);
    }
    startup.sandbox = undefined;
    startup.driver = undefined;
  }
}

async function createAgentSessionDriverWithAbort({
  create,
  signal,
}: {
  create: () => Promise<AgentSessionDriver>;
  signal: AbortSignal;
}): Promise<AgentSessionDriver> {
  const driverPromise = create();
  if (!signal.aborted) {
    const abortPromise = new Promise<never>((_, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new Error("Agent session was aborted.")),
        { once: true },
      );
    });
    try {
      return await Promise.race([driverPromise, abortPromise]);
    } catch (error) {
      void driverPromise.then((driver) => driver.dispose()).catch(() => {});
      throw error;
    }
  }

  void driverPromise.then((driver) => driver.dispose()).catch(() => {});
  throw new Error("Agent session was aborted.");
}
