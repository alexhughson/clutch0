import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "bun:test";
import { runAcpBackendSmokeTest } from "./acpBackendSmokeTest";

test("ACP backend smoke test exercises a real child-process backend", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-acp-smoke-"));
  const agentPath = join(root, "fake-acp-agent.mjs");
  await writeFile(agentPath, fakeAgentScript(), "utf-8");

  const result = await runAcpBackendSmokeTest({
    backend: {
      args: [agentPath],
      command: process.execPath,
    },
    cwd: root,
    prompt: "hello",
    timeoutMs: 5_000,
  });

  expect(result.assistantText).toBe("smoke:hello");
  expect(result.configPath).toContain(".clutch/settings.json");
  expect(result.cwd).toBe(root);
  expect(result.sessionId).toBe("fake-session");
  expect(result.stopReason).toBe("end_turn");
  expect(result.updates).toContain("agent_message_chunk:text");
});

test("ACP backend smoke test reports backend stderr when startup fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-acp-smoke-fail-"));
  const agentPath = join(root, "bad-agent.mjs");
  await writeFile(
    agentPath,
    "console.error('backend exploded'); process.exit(12);\n",
    "utf-8",
  );

  await expect(
    runAcpBackendSmokeTest({
      backend: {
        args: [agentPath],
        command: process.execPath,
      },
      cwd: root,
      timeoutMs: 5_000,
    }),
  ).rejects.toThrow("backend exploded");
});

test("ACP backend smoke test fails when a backend requests permission", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-acp-smoke-permission-"));
  const agentPath = join(root, "permission-agent.mjs");
  await writeFile(
    agentPath,
    fakeAgentScript({ requestPermission: true }),
    "utf-8",
  );

  const error = await captureError(() =>
    runAcpBackendSmokeTest({
      backend: {
        args: [agentPath],
        command: process.execPath,
      },
      cwd: root,
      timeoutMs: 5_000,
    }),
  );

  expect(error.message).toContain(
    "ACP smoke test failed during session/prompt.",
  );
  expect(error.message).toContain("backend=");
  expect(error.message).toContain(
    "ACP smoke test prompt completed without assistant text.",
  );
});

test("ACP backend smoke test times out session disposal", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-acp-smoke-dispose-"));
  const agentPath = join(root, "hanging-close-agent.mjs");
  await writeFile(agentPath, fakeAgentScript({ hangClose: true }), "utf-8");

  await expect(
    runAcpBackendSmokeTest({
      backend: {
        args: [agentPath],
        command: process.execPath,
      },
      cwd: root,
      skipPrompt: true,
      timeoutMs: 100,
    }),
  ).rejects.toThrow("session/dispose timed out after 100ms.");
});

function fakeAgentScript({
  hangClose = false,
  requestPermission = false,
}: { hangClose?: boolean; requestPermission?: boolean } = {}): string {
  const acpImport = pathToFileURL(
    join(process.cwd(), "node_modules/@agentclientprotocol/sdk/dist/acp.js"),
  ).href;
  return `
import { Readable, Writable } from "node:stream";
import * as acp from ${JSON.stringify(acpImport)};

function promptText(prompt) {
  return prompt
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("");
}

acp
  .agent({ name: "fake-smoke-agent" })
  .onRequest(acp.methods.agent.initialize, () => ({
    agentCapabilities: { loadSession: false },
    protocolVersion: acp.PROTOCOL_VERSION,
  }))
  .onRequest(acp.methods.agent.session.new, () => ({
    sessionId: "fake-session",
  }))
  .onRequest(acp.methods.agent.session.prompt, async ({ client, params }) => {
    ${
      requestPermission
        ? `
    const permission = await client.request(acp.methods.client.session.requestPermission, {
      options: [{ kind: "allow_once", name: "Allow once", optionId: "allow-once" }],
      sessionId: params.sessionId,
      toolCall: { title: "Permission tool", toolCallId: "permission-tool" },
    });
    if (permission.outcome.outcome !== "selected") {
      return { stopReason: "cancelled" };
    }
`
        : ""
    }
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        content: { text: "smoke:" + promptText(params.prompt), type: "text" },
        messageId: "fake-message",
        sessionUpdate: "agent_message_chunk",
      },
    });
    return { stopReason: "end_turn" };
  })
  .onNotification(acp.methods.agent.session.cancel, () => {})
  .onRequest(acp.methods.agent.session.close, () =>
    ${hangClose ? "new Promise(() => {})" : "{}"}
  )
  .connect(
    acp.ndJsonStream(
      Writable.toWeb(process.stdout),
      Readable.toWeb(process.stdin),
    ),
  );
`;
}

async function captureError(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw new Error(String(error));
  }
  throw new Error("Expected operation to fail.");
}
