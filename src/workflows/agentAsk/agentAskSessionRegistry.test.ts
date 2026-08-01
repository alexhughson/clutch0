import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createInitialAppState } from "../../app/appInitialState";
import type { AgentSessionDriver } from "../../lib/agent/agentSessionDriver";
import type { AgentOutputUpdate } from "../../lib/agentOutput/agentOutputTypes";
import { createAgentOutputId } from "../../lib/agentOutput/agentOutputBlocks";
import {
  CLUTCH_CONFIG_DIR_ENV,
} from "../../lib/config/clutchConfig";
import { CURSOR_AUTH_PROVIDER_ID } from "../../lib/config/clutchConfig";
import { PiAgentContextItem } from "../../lib/context/contextItems";
import { hydrateAppStore, useAppStore } from "../../store/appStore";
import {
  disposeAgentAskSession,
  releaseAllAgentHandles,
  sendAgentAskMessage,
  setAgentHarnessFactoriesForTest,
  startAgentSession,
} from "./agentAskSessionRegistry";

let resetFactories: (() => void) | null = null;
let originalConfigDir: string | undefined;

beforeEach(() => {
  originalConfigDir = process.env[CLUTCH_CONFIG_DIR_ENV];
  hydrateAppStore(createInitialAppState());
});

afterEach(async () => {
  if (originalConfigDir === undefined) {
    delete process.env[CLUTCH_CONFIG_DIR_ENV];
  } else {
    process.env[CLUTCH_CONFIG_DIR_ENV] = originalConfigDir;
  }
  originalConfigDir = undefined;
  resetFactories?.();
  resetFactories = null;
  await disposeAgentAskSession("agent:1");
  await releaseAllAgentHandles();
  hydrateAppStore(createInitialAppState());
});

test("agent session registry records startup, prompt, follow-up, harness persist, and dispose", async () => {
  const root = await createGitRoot();
  await configureFakeAgentHarness();
  const calls = { disposed: 0, prompts: [] as string[], sessions: 0 };
  resetFactories = setAgentHarnessFactoriesForTest({
    createSession: async () => {
      calls.sessions += 1;
      return { agentId: "agent-1" };
    },
    createSessionDriver: async ({ ctx }) =>
      createFakeDriver({
        onDispose: () => {
          calls.disposed += 1;
        },
        onOutputUpdate: ctx.onOutputUpdate,
        onPrompt: (message) => {
          calls.prompts.push(message);
        },
      }),
  });

  const itemId = useAppStore.getState().actions.agentAsk.start({
    prompt: "Investigate routing",
  });
  if (itemId === null) {
    throw new Error("Failed to create agent context item.");
  }

  await startAgentSession({
    contextItems: [],
    focusedContextItemId: null,
    itemId,
    prompt: "Investigate routing",
    root,
  });
  await sendAgentAskMessage({ itemId, message: "Now check tests" });

  const item = useAppStore.getState().workspace.contextItems[0];
  expect(item).toBeInstanceOf(PiAgentContextItem);
  expect((item as PiAgentContextItem).harness).toEqual({
    kind: "cursor",
    session: { agentId: "agent-1" },
  });
  expect((item as PiAgentContextItem).status).toBe("idle");
  expect(calls.sessions).toBe(1);
  expect(calls.prompts).toHaveLength(2);
  expect(calls.prompts[0]).toContain("Investigate routing");
  expect(calls.prompts[1]).toBe("Now check tests");

  await disposeAgentAskSession(itemId);
  expect(calls.disposed).toBe(1);
});

test("agent dispose removes sandbox even when driver dispose fails", async () => {
  await configureFakeAgentHarness();
  const root = await createGitRoot();
  let sandboxPath = "";
  resetFactories = setAgentHarnessFactoriesForTest({
    createSession: async () => ({ agentId: "agent-edit" }),
    createSessionDriver: async ({ ctx }) => {
      sandboxPath = ctx.cwd;
      return createFakeDriver({
        onDispose: async () => {
          throw new Error("dispose boom");
        },
        onOutputUpdate: ctx.onOutputUpdate,
      });
    },
  });

  const itemId = useAppStore.getState().actions.agentAsk.start({
    prompt: "Edit something",
  });
  if (itemId === null) {
    throw new Error("Failed to create agent context item.");
  }

  await startAgentSession({
    contextItems: [],
    focusedContextItemId: null,
    itemId,
    prompt: "Edit something",
    root,
  });

  expect(sandboxPath.length).toBeGreaterThan(0);
  expect(existsSync(sandboxPath)).toBe(true);
  await expect(disposeAgentAskSession(itemId)).rejects.toThrow("dispose boom");
  expect(existsSync(sandboxPath)).toBe(false);
});

test("sendAgentAskMessage rehydrates driver from persisted harness after soft release", async () => {
  const root = await createGitRoot();
  await configureFakeAgentHarness();
  const calls = { drivers: 0, prompts: [] as string[] };
  resetFactories = setAgentHarnessFactoriesForTest({
    createSession: async () => ({ agentId: "agent-rehydrate" }),
    createSessionDriver: async ({ ctx }) => {
      calls.drivers += 1;
      return createFakeDriver({
        onOutputUpdate: ctx.onOutputUpdate,
        onPrompt: (message) => {
          calls.prompts.push(message);
        },
      });
    },
  });

  const itemId = useAppStore.getState().actions.agentAsk.start({
    prompt: "first",
  });
  if (itemId === null) {
    throw new Error("Failed to create agent context item.");
  }

  await startAgentSession({
    contextItems: [],
    focusedContextItemId: null,
    itemId,
    prompt: "first",
    root,
  });
  await releaseAllAgentHandles();
  expect(calls.drivers).toBe(1);

  await sendAgentAskMessage({ itemId, message: "follow-up after release" });
  expect(calls.drivers).toBe(2);
  expect(calls.prompts.at(-1)).toBe("follow-up after release");
  expect(
    (useAppStore.getState().workspace.contextItems[0] as PiAgentContextItem)
      .status,
  ).toBe("idle");

  await disposeAgentAskSession(itemId);
});

test("releaseAllAgentHandles soft-releases drivers without deleting sandbox", async () => {
  await configureFakeAgentHarness();
  const root = await createGitRoot();
  let sandboxPath = "";
  let disposed = 0;
  resetFactories = setAgentHarnessFactoriesForTest({
    createSession: async () => ({ agentId: "agent-soft" }),
    createSessionDriver: async ({ ctx }) => {
      sandboxPath = ctx.cwd;
      return createFakeDriver({
        onDispose: () => {
          disposed += 1;
        },
        onOutputUpdate: ctx.onOutputUpdate,
      });
    },
  });

  const itemId = useAppStore.getState().actions.agentAsk.start({
    prompt: "soft release",
  });
  if (itemId === null) {
    throw new Error("Failed to create agent context item.");
  }

  await startAgentSession({
    contextItems: [],
    focusedContextItemId: null,
    itemId,
    prompt: "soft release",
    root,
  });

  expect(existsSync(sandboxPath)).toBe(true);
  await releaseAllAgentHandles();
  expect(disposed).toBe(1);
  expect(existsSync(sandboxPath)).toBe(true);

  const item = useAppStore.getState().workspace.contextItems[0];
  expect(item).toBeInstanceOf(PiAgentContextItem);
  expect((item as PiAgentContextItem).harness?.session).toEqual({
    agentId: "agent-soft",
  });

  await disposeAgentAskSession(itemId);
  expect(existsSync(sandboxPath)).toBe(false);
});

function createFakeDriver({
  onDispose,
  onOutputUpdate,
  onPrompt,
}: {
  onDispose?: () => void | Promise<void>;
  onOutputUpdate: (update: AgentOutputUpdate) => void;
  onPrompt?: (message: string) => void;
}): AgentSessionDriver {
  let latest: string | null = null;
  return {
    async dispose() {
      await onDispose?.();
    },
    latestAssistantText() {
      return latest;
    },
    async prompt(message: string) {
      onPrompt?.(message);
      latest = `reply: ${message.slice(0, 40)}`;
      const id = createAgentOutputId();
      onOutputUpdate({
        id,
        kind: "reconcile-stream",
        streamKind: "assistant",
        text: latest,
        timestamp: Date.now(),
      });
    },
  };
}

async function configureFakeAgentHarness() {
  const configDir = await mkdtemp(join(tmpdir(), "clutch-agent-harness-"));
  process.env[CLUTCH_CONFIG_DIR_ENV] = configDir;
  await writeFile(
    join(configDir, "settings.json"),
    JSON.stringify({
      agentHarness: {
        kind: "cursor",
        config: { model: "composer-2.5" },
      },
    }),
  );
  await writeFile(
    join(configDir, "auth.json"),
    JSON.stringify({
      [CURSOR_AUTH_PROVIDER_ID]: { key: "cursor_test_key", type: "api_key" },
    }),
  );
}

async function createGitRoot() {
  const root = await mkdtemp(join(tmpdir(), "clutch-agent-git-"));
  execFileSync("git", ["init"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  await writeFile(join(root, "README.md"), "hello\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root });
  return root;
}
