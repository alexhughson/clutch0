import { createAgentPlatform } from "@cursor/sdk";
import { randomUUID } from "node:crypto";

const CURSOR_CUSTOM_TOOLS_PROVIDER = "custom-user-tools";

try {
  const request = parseWorkerRequest(JSON.parse(await readStdin()));
  await runCursorCompletion(request);
} catch (error) {
  emit({
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    type: "error",
  });
  process.exitCode = 1;
}

async function runCursorCompletion(request) {
  const platform = await createAgentPlatform();
  const lease = await platform.acquireLocalExecutor({
    apiKey: request.apiKey,
    mcpServers: {},
    sandboxOptions: { enabled: false },
    settingSources: [],
    workingDirectory: request.root,
  });

  try {
    let controller = null;
    let capturedToolCall = false;
    const captureToolCall = (toolCall) => {
      if (capturedToolCall) {
        return;
      }

      capturedToolCall = true;
      emit({ toolCall, type: "tool-call" });
      controller?.abort();
    };

    controller = await lease.handle.run(
      { text: request.prompt },
      {
        apiKey: request.apiKey,
        customTools: customToolsFromRequestTools({
          captureToolCall,
          tools: request.tools,
        }),
        mcpServersOverride: {},
        mode: "plan",
        model: request.modelSelection,
        sessionId: randomUUID(),
      },
      {
        sendUpdate: async (update) => {
          if (update.type === "text-delta") {
            emit({ text: update.text, type: "text-delta" });
            return;
          }

          const toolCall = toolCallFromCursorUpdate(update);
          if (toolCall !== null) {
            captureToolCall(toolCall);
            return;
          }

          if (isCursorBuiltinToolCall(update)) {
            throw new Error(
              "Cursor Composer tried to call a Cursor built-in tool. Clutch only supports routed Clutch workflow tools through this adapter.",
            );
          }
        },
      },
    );
    if (capturedToolCall) {
      controller.abort();
    }
    await controller.done.catch((error) => {
      if (!capturedToolCall) {
        throw error;
      }
    });
    emit({ type: "done" });
  } finally {
    await lease.release();
  }
}

function customToolsFromRequestTools({ captureToolCall, tools }) {
  if (tools.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: (args) => {
          captureToolCall({
            arguments: args,
            id: `cursor-${randomUUID()}`,
            name: tool.name,
            type: "toolCall",
          });
          return "Tool call captured by Clutch.";
        },
      },
    ]),
  );
}

function toolCallFromCursorUpdate(update) {
  if (
    update.type !== "tool-call-started" &&
    update.type !== "tool-call-completed"
  ) {
    return null;
  }

  const toolCall = update.toolCall;
  if (toolCall.type !== "mcp") {
    return null;
  }

  if (toolCall.args.providerIdentifier !== CURSOR_CUSTOM_TOOLS_PROVIDER) {
    return null;
  }

  const name = toolCall.args.toolName;
  if (typeof name !== "string" || name.length === 0) {
    return null;
  }

  const args = toolCall.args.args;
  if (args === undefined) {
    return null;
  }
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`Cursor custom tool ${name} args must be an object.`);
  }

  return {
    arguments: args,
    id: update.callId,
    name,
    type: "toolCall",
  };
}

function isCursorBuiltinToolCall(update) {
  return (
    (update.type === "tool-call-started" ||
      update.type === "partial-tool-call" ||
      update.type === "tool-call-completed") &&
    update.toolCall.type !== "mcp"
  );
}

function parseWorkerRequest(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Cursor worker request must be an object.");
  }

  const request = raw;
  if (typeof request.apiKey !== "string" || request.apiKey.length === 0) {
    throw new Error("Cursor worker request must include apiKey.");
  }
  if (typeof request.prompt !== "string" || request.prompt.length === 0) {
    throw new Error("Cursor worker request must include prompt.");
  }
  if (typeof request.root !== "string" || request.root.length === 0) {
    throw new Error("Cursor worker request must include root.");
  }
  if (
    request.modelSelection === null ||
    typeof request.modelSelection !== "object" ||
    Array.isArray(request.modelSelection) ||
    typeof request.modelSelection.id !== "string" ||
    request.modelSelection.id.length === 0
  ) {
    throw new Error("Cursor worker request must include modelSelection.");
  }
  if (!Array.isArray(request.tools)) {
    throw new Error("Cursor worker request tools must be an array.");
  }

  return {
    apiKey: request.apiKey,
    modelSelection: request.modelSelection,
    prompt: request.prompt,
    root: request.root,
    tools: request.tools.map(parseRequestTool),
  };
}

function parseRequestTool(rawTool, index) {
  if (
    rawTool === null ||
    typeof rawTool !== "object" ||
    Array.isArray(rawTool)
  ) {
    throw new Error(`Cursor worker request tools[${index}] must be an object.`);
  }
  if (typeof rawTool.name !== "string" || rawTool.name.length === 0) {
    throw new Error(
      `Cursor worker request tools[${index}].name must be a string.`,
    );
  }
  if (
    rawTool.description !== undefined &&
    typeof rawTool.description !== "string"
  ) {
    throw new Error(
      `Cursor worker request tools[${index}].description must be a string when provided.`,
    );
  }
  if (
    rawTool.inputSchema !== undefined &&
    (rawTool.inputSchema === null ||
      typeof rawTool.inputSchema !== "object" ||
      Array.isArray(rawTool.inputSchema))
  ) {
    throw new Error(
      `Cursor worker request tools[${index}].inputSchema must be an object when provided.`,
    );
  }

  return {
    description: rawTool.description,
    inputSchema: rawTool.inputSchema,
    name: rawTool.name,
  };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => {
      resolve(input);
    });
    process.stdin.on("error", reject);
  });
}

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
