import {
  createAgentPlatform,
  type InteractionUpdate,
  type ModelSelection,
  type SDKCustomTool,
  type SDKJsonValue,
} from "@cursor/sdk";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  Api,
  Context,
  Message,
  Model,
  Tool,
  ToolCall,
} from "@earendil-works/pi-ai";

export const CURSOR_AGENT_API = "cursor-agent";

export type CursorCompletionAgentApi = {
  createAgentPlatform(): Promise<CursorPlatform>;
};

type StreamCursorCompletionOptions = {
  agentApi?: CursorCompletionAgentApi;
  apiKey: string;
  context: Context;
  model: Model<Api>;
  onDelta?: (delta: string) => void;
  root?: string;
  signal?: AbortSignal;
  workerTimeoutMs?: number;
};

const CURSOR_CUSTOM_TOOLS_PROVIDER = "custom-user-tools";
const CURSOR_COMPLETION_WORKER_PATH = fileURLToPath(
  new URL("./cursorCompletionWorker.mjs", import.meta.url),
);
const DEFAULT_CURSOR_WORKER_TIMEOUT_MS = 120_000;

type CursorPlatform = {
  acquireLocalExecutor(
    options: CursorLocalExecutorOptions,
  ): Promise<CursorExecutorLease>;
};

type CursorLocalExecutorOptions = {
  apiKey?: string;
  autoReview?: boolean;
  mcpServers?: Record<string, never>;
  sandboxOptions?: { enabled: boolean };
  settingSources?: readonly [];
  workingDirectory: string;
};

type CursorExecutorLease = {
  handle: {
    run(
      input: { text: string },
      options: CursorRunOptions,
      listener: CursorInteractionListener,
    ): Promise<CursorRunController>;
  };
  release(): Promise<void>;
};

type CursorRunOptions = {
  apiKey: string;
  customTools?: Record<string, SDKCustomTool>;
  mcpServersOverride?: Record<string, never>;
  mode?: "agent" | "plan";
  model: ModelSelection;
  sessionId: string;
};

type CursorInteractionListener = {
  sendUpdate(update: InteractionUpdate): Promise<void>;
};

type CursorRunController = {
  abort(): void;
  done: Promise<void>;
};

export type CursorCompletionResult =
  | {
      kind: "text";
      responseText: string;
    }
  | {
      kind: "toolCalls";
      responseText: string;
      toolCalls: ToolCall[];
    };

export function isCursorAgentModel(model: Model<Api>): boolean {
  return model.provider === "cursor" && model.api === CURSOR_AGENT_API;
}

export async function streamCursorCompletion({
  agentApi,
  apiKey,
  context,
  model,
  onDelta,
  root = process.cwd(),
  signal,
  workerTimeoutMs = DEFAULT_CURSOR_WORKER_TIMEOUT_MS,
}: StreamCursorCompletionOptions): Promise<CursorCompletionResult> {
  const modelSelection = cursorModelSelectionFromMetadata(model);
  const prompt = formatCursorCompletionPrompt(context);
  const tools = cursorCompletionToolDefinitions(context.tools ?? []);
  if (agentApi === undefined) {
    return streamCursorCompletionWithWorker({
      apiKey,
      modelSelection,
      onDelta,
      prompt,
      root,
      signal,
      tools,
      workerTimeoutMs,
    });
  }

  return streamCursorCompletionInProcess({
    agentApi,
    apiKey,
    modelSelection,
    onDelta,
    prompt,
    root,
    signal,
    tools,
  });
}

async function streamCursorCompletionInProcess({
  agentApi,
  apiKey,
  modelSelection,
  onDelta,
  prompt,
  root,
  signal,
  tools,
}: {
  agentApi: CursorCompletionAgentApi;
  apiKey: string;
  modelSelection: ModelSelection;
  onDelta?: (delta: string) => void;
  prompt: string;
  root: string;
  signal?: AbortSignal;
  tools: readonly CursorCompletionToolDefinition[];
}): Promise<CursorCompletionResult> {
  throwIfAborted(signal);

  const platform = await agentApi.createAgentPlatform();
  const lease = await platform.acquireLocalExecutor({
    apiKey,
    mcpServers: {},
    sandboxOptions: { enabled: false },
    settingSources: [],
    workingDirectory: root,
  });

  try {
    throwIfAborted(signal);
    let streamedText = "";
    let controller: CursorRunController | null = null;
    let capturedToolCall: ToolCall | null = null;
    const captureToolCall = (toolCall: ToolCall) => {
      if (capturedToolCall !== null) {
        return;
      }

      capturedToolCall = toolCall;
      controller?.abort();
    };
    const controllerResult = await lease.handle.run(
      { text: prompt },
      {
        apiKey,
        customTools: cursorCustomToolsFromClutchTools({
          captureToolCall,
          tools,
        }),
        mcpServersOverride: {},
        mode: "plan",
        model: modelSelection,
        sessionId: crypto.randomUUID(),
      },
      {
        sendUpdate: async (update) => {
          if (update.type === "text-delta") {
            streamedText += update.text;
            onDelta?.(update.text);
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
    controller = controllerResult;
    if (capturedToolCall !== null) {
      controller.abort();
    }
    await waitForCursorRun(controller, signal).catch((error) => {
      if (capturedToolCall !== null) {
        return;
      }
      throw error;
    });

    if (capturedToolCall !== null) {
      return {
        kind: "toolCalls",
        responseText: streamedText,
        toolCalls: [capturedToolCall],
      };
    }

    return {
      kind: "text",
      responseText: streamedText,
    };
  } finally {
    await lease.release();
  }
}

async function streamCursorCompletionWithWorker({
  apiKey,
  modelSelection,
  onDelta,
  prompt,
  root,
  signal,
  tools,
  workerTimeoutMs,
}: {
  apiKey: string;
  modelSelection: ModelSelection;
  onDelta?: (delta: string) => void;
  prompt: string;
  root: string;
  signal?: AbortSignal;
  tools: readonly CursorCompletionToolDefinition[];
  workerTimeoutMs: number;
}): Promise<CursorCompletionResult> {
  throwIfAborted(signal);

  const worker = spawn("node", [CURSOR_COMPLETION_WORKER_PATH], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  let stdoutBuffer = "";
  let streamedText = "";
  let capturedToolCall: ToolCall | null = null;

  const workerDone = new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish(
        new Error(
          `Cursor Composer worker timed out after ${workerTimeoutMs}ms.`,
        ),
      );
    }, workerTimeoutMs);
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (error === undefined) {
        resolve();
      } else {
        worker.kill();
        reject(error);
      }
    };
    const onAbort = () => {
      worker.kill();
      finish(abortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    worker.on("error", (error) => {
      finish(error);
    });
    worker.stdin.on("error", (error) => {
      finish(error);
    });
    worker.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    worker.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        try {
          const event = parseCursorWorkerEvent(line);
          if (event.type === "text-delta") {
            streamedText += event.text;
            onDelta?.(event.text);
          } else if (event.type === "tool-call") {
            capturedToolCall ??= event.toolCall;
          } else if (event.type === "error") {
            finish(new Error(formatCursorWorkerError(event)));
          }
        } catch (error) {
          finish(
            new Error(
              `Cursor worker emitted malformed output: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });
    worker.on("close", (code, closeSignal) => {
      if (code === 0) {
        if (stdoutBuffer.trim().length > 0) {
          finish(
            new Error(
              `Cursor worker emitted trailing malformed output: ${stdoutBuffer.trim().slice(0, 300)}`,
            ),
          );
          return;
        }
        finish();
        return;
      }

      finish(
        new Error(
          formatCursorWorkerExitError({
            code,
            signal: closeSignal,
            stderr,
          }),
        ),
      );
    });
  });

  worker.stdin.end(
    `${JSON.stringify({
      apiKey,
      modelSelection,
      prompt,
      root,
      tools,
    } satisfies CursorWorkerRequest)}\n`,
  );

  await workerDone;
  if (capturedToolCall !== null) {
    return {
      kind: "toolCalls",
      responseText: streamedText,
      toolCalls: [capturedToolCall],
    };
  }

  return {
    kind: "text",
    responseText: streamedText,
  };
}

type CursorCompletionToolDefinition = {
  description?: string;
  inputSchema?: Record<string, SDKJsonValue>;
  name: string;
};

type CursorWorkerRequest = {
  apiKey: string;
  modelSelection: ModelSelection;
  prompt: string;
  root: string;
  tools: readonly CursorCompletionToolDefinition[];
};

type CursorWorkerEvent =
  | {
      text: string;
      type: "text-delta";
    }
  | {
      toolCall: ToolCall;
      type: "tool-call";
    }
  | {
      message: string;
      stack?: string;
      type: "error";
    }
  | {
      type: "done";
    };

function cursorCompletionToolDefinitions(
  tools: readonly Tool[],
): CursorCompletionToolDefinition[] {
  return tools.map((tool) => ({
    description: tool.description,
    inputSchema: tool.parameters as unknown as Record<string, SDKJsonValue>,
    name: tool.name,
  }));
}

function cursorCustomToolsFromClutchTools({
  captureToolCall,
  tools,
}: {
  captureToolCall: (toolCall: ToolCall) => void;
  tools: readonly CursorCompletionToolDefinition[];
}): Record<string, SDKCustomTool> | undefined {
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
            id: `cursor-${crypto.randomUUID()}`,
            name: tool.name,
            type: "toolCall",
          });
          return "Tool call captured by Clutch.";
        },
      } satisfies SDKCustomTool,
    ]),
  );
}

function parseCursorWorkerEvent(line: string): CursorWorkerEvent {
  if (line.trim().length === 0) {
    throw new Error("empty event line");
  }

  const parsed = JSON.parse(line) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("event must be an object");
  }

  const event = parsed as Record<string, unknown>;
  if (event.type === "text-delta") {
    if (typeof event.text !== "string") {
      throw new Error("text-delta event must include text");
    }
    return { text: event.text, type: "text-delta" };
  }

  if (event.type === "tool-call") {
    return {
      toolCall: parseCursorWorkerToolCall(event.toolCall),
      type: "tool-call",
    };
  }

  if (event.type === "error") {
    if (typeof event.message !== "string" || event.message.length === 0) {
      throw new Error("error event must include message");
    }
    return {
      message: event.message,
      stack: typeof event.stack === "string" ? event.stack : undefined,
      type: "error",
    };
  }

  if (event.type === "done") {
    return { type: "done" };
  }

  throw new Error(`unknown event type ${String(event.type)}`);
}

function parseCursorWorkerToolCall(raw: unknown): ToolCall {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("tool-call event must include a toolCall object");
  }

  const toolCall = raw as Record<string, unknown>;
  if (
    toolCall.type !== "toolCall" ||
    typeof toolCall.id !== "string" ||
    typeof toolCall.name !== "string" ||
    toolCall.arguments === null ||
    typeof toolCall.arguments !== "object" ||
    Array.isArray(toolCall.arguments)
  ) {
    throw new Error("tool-call event has malformed toolCall");
  }

  return {
    arguments: toolCall.arguments as Record<string, unknown>,
    id: toolCall.id,
    name: toolCall.name,
    type: "toolCall",
  };
}

function formatCursorWorkerError(
  event: Extract<CursorWorkerEvent, { type: "error" }>,
): string {
  return [
    `Cursor Composer worker failed: ${event.message}`,
    event.stack === undefined ? undefined : `\nStack:\n${event.stack}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join("");
}

function formatCursorWorkerExitError({
  code,
  signal,
  stderr,
}: {
  code: number | null;
  signal: string | null;
  stderr: string;
}): string {
  const stderrSummary = stderr.trim().slice(0, 4_000);
  return [
    `Cursor Composer worker exited with ${signal === null ? `code ${code}` : `signal ${signal}`}.`,
    stderrSummary.length === 0
      ? undefined
      : `\nWorker stderr:\n${stderrSummary}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join("");
}

function toolCallFromCursorUpdate(update: InteractionUpdate): ToolCall | null {
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
    arguments: args as Record<string, unknown>,
    id: update.callId,
    name,
    type: "toolCall",
  };
}

function isCursorBuiltinToolCall(update: InteractionUpdate): boolean {
  return (
    (update.type === "tool-call-started" ||
      update.type === "partial-tool-call" ||
      update.type === "tool-call-completed") &&
    update.toolCall.type !== "mcp"
  );
}

async function waitForCursorRun(
  controller: CursorRunController,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal === undefined) {
    await controller.done;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      controller.abort();
      reject(abortError());
      return;
    }

    const onAbort = () => {
      controller.abort();
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    controller.done.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export function formatCursorCompletionPrompt(context: Context): string {
  return [
    context.systemPrompt === undefined
      ? null
      : `<system>\n${context.systemPrompt}\n</system>`,
    ...context.messages.map(formatCursorPromptMessage),
    formatCursorCompletionInstruction(context),
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n");
}

function formatCursorCompletionInstruction(context: Context): string {
  if (context.tools === undefined || context.tools.length === 0) {
    return "Respond with only the assistant message for this Clutch request. Do not modify files, run commands, or call tools.";
  }

  return "Respond with assistant text, or call exactly one available Clutch custom tool when the request needs a Clutch workflow. Do not modify files, run commands, or use Cursor built-in tools directly.";
}

export function cursorModelSelectionFromMetadata(
  model: Model<Api>,
): ModelSelection {
  if (!isCursorAgentModel(model)) {
    throw new Error(
      `Cursor completion adapter received non-Cursor model ${model.provider}/${model.id}.`,
    );
  }

  const compat = recordField(
    model as unknown as Record<string, unknown>,
    "compat",
  );
  if (compat === undefined) {
    return { id: model.id };
  }

  const selection = recordField(compat, "cursorModelSelection");
  if (selection === undefined) {
    return { id: model.id };
  }

  const id = selection.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error("Cursor model metadata selection id must be a string.");
  }

  return normalizeCursorModelSelectionFromMetadata({
    modelId: model.id,
    selection: {
      id,
      params: parseCursorModelSelectionParams(selection.params),
    },
  });
}

function normalizeCursorModelSelectionFromMetadata({
  modelId,
  selection,
}: {
  modelId: string;
  selection: ModelSelection;
}): ModelSelection {
  if (
    modelId === `${selection.id}:${selection.id.replaceAll(".", "-")}` &&
    selection.params?.some(
      (param) => param.id === "fast" && param.value === "false",
    ) === true
  ) {
    return {
      id: selection.id,
      params: selection.params.map((param) =>
        param.id === "fast" ? { ...param, value: "true" } : param,
      ),
    };
  }

  return selection;
}

function formatCursorPromptMessage(message: Message): string {
  switch (message.role) {
    case "user":
      return `<user>\n${formatCursorPromptContent(message.content)}\n</user>`;
    case "assistant":
      return `<assistant>\n${formatCursorPromptContent(message.content)}\n</assistant>`;
    case "toolResult":
      throw new Error(
        "Cursor Composer completions do not support tool-result context messages.",
      );
  }
}

function formatCursorPromptContent(
  content: string | readonly unknown[],
): string {
  if (typeof content === "string") {
    return content;
  }

  return content.map(formatCursorPromptContentBlock).join("\n");
}

function formatCursorPromptContentBlock(block: unknown): string {
  if (block === null || typeof block !== "object" || Array.isArray(block)) {
    throw new Error("Cursor Composer text content blocks must be objects.");
  }

  if ((block as Record<string, unknown>).type === "text") {
    const text = (block as Record<string, unknown>).text;
    if (typeof text !== "string") {
      throw new Error("Cursor Composer text content must include text.");
    }
    return text;
  }

  throw new Error("Cursor Composer completions only support text context.");
}

function parseCursorModelSelectionParams(
  rawParams: unknown,
): ModelSelection["params"] | undefined {
  if (rawParams === undefined) {
    return undefined;
  }
  if (!Array.isArray(rawParams)) {
    throw new Error("Cursor model metadata selection params must be an array.");
  }

  return rawParams.map((param, index) => {
    if (param === null || typeof param !== "object" || Array.isArray(param)) {
      throw new Error(
        `Cursor model metadata selection params[${index}] must be an object.`,
      );
    }

    const id = (param as Record<string, unknown>).id;
    const value = (param as Record<string, unknown>).value;
    if (typeof id !== "string" || typeof value !== "string") {
      throw new Error(
        `Cursor model metadata selection params[${index}] must include id and value strings.`,
      );
    }

    return { id, value };
  });
}

function recordField(
  record: Record<string, unknown>,
  field: string,
): Record<string, unknown> | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Cursor model metadata ${field} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted === true) {
    throw abortError();
  }
}

function abortError(): Error {
  const error = new Error("Cursor completion aborted.");
  error.name = "AbortError";
  return error;
}
