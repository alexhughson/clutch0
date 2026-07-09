import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import * as acp from "@agentclientprotocol/sdk";
import {
  createAcpAgentSessionDriver,
  createInProcessAcpAgentSessionDriverForTest,
  type AgentSessionDriver,
} from "./acpAgentSessionDriver";
import type { AgentOutputUpdate } from "../agentOutput/agentOutputTypes";

test("ACP driver starts a session, prompts, follows up, and disposes", async () => {
  const calls = {
    cancelled: 0,
    closed: 0,
    cwd: "",
    initialized: 0,
    prompts: [] as string[],
  };
  const updates: AgentOutputUpdate[] = [];
  const driver = await createInProcessAcpAgentSessionDriverForTest({
    agent: createFakeAgent(calls),
    cwd: "/tmp/clutch-acp-test",
    onOutputUpdate: (update) => updates.push(update),
  });

  await driver.prompt("first");
  await driver.prompt("second");
  await driver.dispose();

  expect(calls).toEqual({
    cancelled: 1,
    closed: 1,
    cwd: "/tmp/clutch-acp-test",
    initialized: 1,
    prompts: ["first", "second"],
  });
  expect(driver.latestAssistantText()).toBe("reply:second");
  expect(updates).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        delta: "reply:first",
        id: "acp-message:message-1",
        kind: "append-stream-delta",
      }),
      expect.objectContaining({
        delta: "reply:second",
        id: "acp-message:message-2",
        kind: "append-stream-delta",
      }),
      expect.objectContaining({
        block: expect.objectContaining({
          kind: "status",
          message: "agent stopped: end_turn",
        }),
        kind: "append-block",
      }),
    ]),
  );
});

test("ACP driver exposes missing assistant text to the registry", async () => {
  const updates: AgentOutputUpdate[] = [];
  const driver = await createInProcessAcpAgentSessionDriverForTest({
    agent: acp
      .agent({ name: "silent-agent" })
      .onRequest(acp.methods.agent.initialize, () => ({
        agentCapabilities: { loadSession: false },
        protocolVersion: acp.PROTOCOL_VERSION,
      }))
      .onRequest(acp.methods.agent.session.new, () => ({
        sessionId: "session-1",
      }))
      .onRequest(acp.methods.agent.session.prompt, () => ({
        stopReason: "end_turn",
      })),
    cwd: "/tmp/clutch-acp-test",
    onOutputUpdate: (update) => updates.push(update),
  });

  await driver.prompt("quiet");

  expect(driver.latestAssistantText()).toBeNull();
  expect(updates).toEqual([
    expect.objectContaining({
      block: expect.objectContaining({
        kind: "status",
        message: "agent stopped: end_turn",
      }),
      kind: "append-block",
    }),
  ]);
  await driver.dispose();
});

test("ACP driver auto-allows permission requests and records the decision", async () => {
  const calls = { selectedOptionId: "" };
  const updates: AgentOutputUpdate[] = [];
  const driver = await createInProcessAcpAgentSessionDriverForTest({
    agent: createPermissionAgent(calls),
    cwd: "/tmp/clutch-acp-test",
    onOutputUpdate: (update) => updates.push(update),
  });

  await driver.prompt("needs permission");

  expect(calls.selectedOptionId).toBe("allow-once");
  expect(driver.latestAssistantText()).toBe("permission:allow-once");
  expect(updates).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        block: expect.objectContaining({
          kind: "tool",
          phase: "end",
          summary: "auto-allowed Permission tool: Allow once",
          toolName: "permission",
        }),
        kind: "append-block",
      }),
      expect.objectContaining({
        delta: "permission:allow-once",
        kind: "append-stream-delta",
      }),
    ]),
  );
  await driver.dispose();
});

test("ACP driver reports backend stderr when startup protocol closes", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-acp-driver-fail-"));
  const agentPath = join(root, "bad-agent.mjs");
  await writeFile(
    agentPath,
    "console.error('backend rejected --acp'); process.exit(12);\n",
    "utf-8",
  );

  await expect(
    createAcpAgentSessionDriver({
      backend: {
        args: [agentPath],
        command: process.execPath,
      },
      cwd: root,
      onOutputUpdate: () => {},
    }),
  ).rejects.toThrow("backend rejected --acp");
});

function createFakeAgent(calls: {
  cancelled: number;
  closed: number;
  cwd: string;
  initialized: number;
  prompts: string[];
}) {
  return acp
    .agent({ name: "fake-agent" })
    .onRequest(acp.methods.agent.initialize, () => {
      calls.initialized += 1;
      return {
        agentCapabilities: { loadSession: false },
        protocolVersion: acp.PROTOCOL_VERSION,
      };
    })
    .onRequest(acp.methods.agent.session.new, ({ params }) => {
      calls.cwd = params.cwd;
      return { sessionId: "session-1" };
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ client, params }) => {
      const text = promptText(params.prompt);
      calls.prompts.push(text);
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          content: { text: `reply:${text}`, type: "text" },
          messageId: `message-${calls.prompts.length}`,
          sessionUpdate: "agent_message_chunk",
        },
      });
      return { stopReason: "end_turn" };
    })
    .onNotification(acp.methods.agent.session.cancel, () => {
      calls.cancelled += 1;
    })
    .onRequest(acp.methods.agent.session.close, () => {
      calls.closed += 1;
    });
}

function createPermissionAgent(calls: { selectedOptionId: string }) {
  return acp
    .agent({ name: "permission-agent" })
    .onRequest(acp.methods.agent.initialize, () => ({
      agentCapabilities: { loadSession: false },
      protocolVersion: acp.PROTOCOL_VERSION,
    }))
    .onRequest(acp.methods.agent.session.new, () => ({
      sessionId: "session-1",
    }))
    .onRequest(acp.methods.agent.session.prompt, async ({ client, params }) => {
      const response = await client.request(
        acp.methods.client.session.requestPermission,
        {
          options: [
            {
              kind: "allow_always",
              name: "Allow always",
              optionId: "allow-always",
            },
            {
              kind: "allow_once",
              name: "Allow once",
              optionId: "allow-once",
            },
          ],
          sessionId: params.sessionId,
          toolCall: {
            title: "Permission tool",
            toolCallId: "permission-tool",
          },
        },
      );
      calls.selectedOptionId =
        response.outcome.outcome === "selected"
          ? response.outcome.optionId
          : "cancelled";
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          content: {
            text: `permission:${calls.selectedOptionId}`,
            type: "text",
          },
          messageId: "permission-message",
          sessionUpdate: "agent_message_chunk",
        },
      });
      return { stopReason: "end_turn" };
    })
    .onNotification(acp.methods.agent.session.cancel, () => {})
    .onRequest(acp.methods.agent.session.close, () => {});
}

function promptText(prompt: acp.PromptRequest["prompt"]): string {
  return prompt
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("");
}
