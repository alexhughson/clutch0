import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import * as acp from "@agentclientprotocol/sdk";
import { createInitialAppState } from "../../app/appInitialState";
import {
  createInProcessAcpAgentSessionDriverForTest,
  type CreateAcpAgentSessionDriverOptions,
} from "../../lib/agent/acpAgentSessionDriver";
import { CLUTCH_CONFIG_DIR_ENV } from "../../lib/config/clutchConfig";
import { PiAgentContextItem } from "../../lib/context/contextItems";
import { hydrateAppStore, useAppStore } from "../../store/appStore";
import {
  disposeAgentAskSession,
  sendAgentAskMessage,
  setCreateAgentSessionDriverForTest,
  startAgentAskSession,
} from "./agentAskSessionRegistry";

let resetDriverFactory: (() => void) | null = null;
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
  resetDriverFactory?.();
  resetDriverFactory = null;
  await disposeAgentAskSession("agent:1");
  hydrateAppStore(createInitialAppState());
});

test("agent ask registry records ACP startup, prompt, follow-up, and dispose", async () => {
  await configureFakeAgentBackend();
  const calls = { closed: 0, cwd: "", prompts: [] as string[] };
  resetDriverFactory = setCreateAgentSessionDriverForTest(
    async (options: CreateAcpAgentSessionDriverOptions) =>
      await createInProcessAcpAgentSessionDriverForTest({
        agent: createRegistryAgent(calls),
        cwd: options.cwd,
        onOutputUpdate: options.onOutputUpdate,
      }),
  );
  const itemId = useAppStore.getState().actions.agentAsk.start({
    mode: "ask",
    prompt: "Investigate routing",
  });
  if (itemId === null) {
    throw new Error("Failed to create agent context item.");
  }

  await startAgentAskSession({
    contextItems: [],
    focusedContextItemId: null,
    itemId,
    mode: "ask",
    prompt: "Investigate routing",
    root: process.cwd(),
  });
  await sendAgentAskMessage({ itemId, message: "Now check tests" });
  await disposeAgentAskSession(itemId);

  const item = useAppStore.getState().workspace.contextItems[0];
  expect(item).toBeInstanceOf(PiAgentContextItem);
  expect((item as PiAgentContextItem).status).toBe("idle");
  expect((item as PiAgentContextItem).blocks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "tool",
        summary: "agent ask session",
        toolName: "agent",
      }),
      expect.objectContaining({
        kind: "stream",
        streamKind: "assistant",
        text: expect.stringContaining("reply:"),
      }),
    ]),
  );
  expect(calls.prompts).toHaveLength(2);
  expect(calls.cwd).toBe(process.cwd());
  expect(calls.prompts[0]).toContain("Investigate routing");
  expect(calls.prompts[1]).toBe("Now check tests");
  expect(calls.closed).toBe(1);
});

test("agent edit dispose removes sandbox even when driver dispose fails", async () => {
  await configureFakeAgentBackend();
  const root = await createGitRoot();
  let driverCwd = "";
  resetDriverFactory = setCreateAgentSessionDriverForTest(async (options) => {
    driverCwd = options.cwd;
    return {
      dispose: async () => {
        throw new Error("dispose boom");
      },
      latestAssistantText: () => "done",
      prompt: async () => {},
    };
  });
  const itemId = useAppStore.getState().actions.agentAsk.start({
    mode: "edit",
    prompt: "Fix routing",
  });
  if (itemId === null) {
    throw new Error("Failed to create agent context item.");
  }

  await startAgentAskSession({
    contextItems: [],
    focusedContextItemId: null,
    itemId,
    mode: "edit",
    prompt: "Fix routing",
    root,
  });
  const item = useAppStore.getState().workspace.contextItems[0];
  expect(item).toBeInstanceOf(PiAgentContextItem);
  const sandboxPath = (item as PiAgentContextItem).sandbox?.path;
  expect(typeof sandboxPath).toBe("string");
  if (sandboxPath === undefined) {
    throw new Error("Expected edit session to attach a sandbox.");
  }
  expect(driverCwd).toBe(sandboxPath);
  expect(existsSync(sandboxPath)).toBe(true);

  await expect(disposeAgentAskSession(itemId)).rejects.toThrow("dispose boom");

  expect(existsSync(sandboxPath)).toBe(false);
});

function createRegistryAgent(calls: {
  closed: number;
  cwd: string;
  prompts: string[];
}) {
  return acp
    .agent({ name: "registry-agent" })
    .onRequest(acp.methods.agent.initialize, () => ({
      agentCapabilities: { loadSession: false },
      protocolVersion: acp.PROTOCOL_VERSION,
    }))
    .onRequest(acp.methods.agent.session.new, ({ params }) => {
      calls.cwd = params.cwd;
      return {
        sessionId: "session-1",
      };
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ client, params }) => {
      const text = promptText(params.prompt);
      calls.prompts.push(text);
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          content: { text: `reply:${calls.prompts.length}`, type: "text" },
          messageId: `message-${calls.prompts.length}`,
          sessionUpdate: "agent_message_chunk",
        },
      });
      return { stopReason: "end_turn" };
    })
    .onNotification(acp.methods.agent.session.cancel, () => {})
    .onRequest(acp.methods.agent.session.close, () => {
      calls.closed += 1;
    });
}

function promptText(prompt: acp.PromptRequest["prompt"]): string {
  return prompt
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("");
}

async function createGitRoot() {
  const root = await mkdtemp(join(tmpdir(), "clutch-agent-registry-"));
  git(root, "init");
  git(root, "config", "user.email", "clutch@example.test");
  git(root, "config", "user.name", "Clutch Test");
  await writeFile(join(root, "tracked.txt"), "base\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "initial");
  return root;
}

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

async function configureFakeAgentBackend() {
  const configDir = await mkdtemp(join(tmpdir(), "clutch-agent-config-"));
  process.env[CLUTCH_CONFIG_DIR_ENV] = configDir;
  await writeFile(
    join(configDir, "settings.json"),
    JSON.stringify({
      agentBackend: {
        args: ["--fake-acp"],
        command: "fake-agent",
      },
    }),
    "utf-8",
  );
}
