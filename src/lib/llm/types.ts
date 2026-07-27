import type { TSchema } from "@earendil-works/pi-ai";

export type LlmApi =
  | "google-generative-ai"
  | "openai-codex-responses"
  | "openai-completions"
  | "openai-responses"
  | (string & {});

export type LlmProvider =
  | "cerebras"
  | "google"
  | "openai"
  | "openai-codex"
  | "openrouter"
  | "opencode"
  | "opencode-go"
  | "sambanova"
  | (string & {});

export type LlmThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh";
export type LlmModelThinkingLevel = "off" | LlmThinkingLevel;

export type LlmModel<TApi extends LlmApi = LlmApi> = {
  api: TApi;
  baseUrl: string;
  compat?: unknown;
  contextWindow: number;
  cost: {
    cacheRead: number;
    cacheWrite: number;
    input: number;
    output: number;
  };
  headers?: Record<string, string>;
  id: string;
  input: ("image" | "text")[];
  maxTokens: number;
  name: string;
  provider: LlmProvider;
  reasoning: boolean;
  thinkingLevelMap?: Partial<Record<LlmModelThinkingLevel, string | null>>;
};

export type LlmTextContent = {
  text: string;
  textSignature?: string;
  type: "text";
};

export type LlmThinkingContent = {
  redacted?: boolean;
  thinking: string;
  thinkingSignature?: string;
  type: "thinking";
};

export type LlmImageContent = {
  data: string;
  mimeType: string;
  type: "image";
};

export type LlmToolCall = {
  arguments: Record<string, unknown>;
  id: string;
  name: string;
  thoughtSignature?: string;
  type: "toolCall";
};

export type LlmUsage = {
  cacheRead: number;
  cacheWrite: number;
  cost: {
    cacheRead: number;
    cacheWrite: number;
    input: number;
    output: number;
    total: number;
  };
  input: number;
  output: number;
  totalTokens: number;
};

export type LlmStopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export type LlmUserMessage = {
  content: string | (LlmTextContent | LlmImageContent)[];
  role: "user";
  timestamp: number;
};

export type LlmAssistantMessage = {
  api: LlmApi;
  content: (LlmTextContent | LlmThinkingContent | LlmToolCall)[];
  diagnostics?: unknown[];
  errorMessage?: string;
  model: string;
  provider: LlmProvider;
  responseId?: string;
  responseModel?: string;
  role: "assistant";
  stopReason: LlmStopReason;
  timestamp: number;
  usage: LlmUsage;
};

export type LlmToolResultMessage<TDetails = unknown> = {
  content: (LlmTextContent | LlmImageContent)[];
  details?: TDetails;
  isError: boolean;
  role: "toolResult";
  timestamp: number;
  toolCallId: string;
  toolName: string;
};

export type LlmMessage =
  | LlmUserMessage
  | LlmAssistantMessage
  | LlmToolResultMessage;

export type LlmTool<TParameters extends TSchema = TSchema> = {
  description: string;
  name: string;
  parameters: TParameters;
};

export type LlmContext = {
  messages: LlmMessage[];
  systemPrompt?: string;
  tools: readonly LlmTool[];
};

export type AssistantMessageEvent =
  | { partial: LlmAssistantMessage; type: "start" }
  | {
      contentIndex: number;
      partial: LlmAssistantMessage;
      type: "text_start";
    }
  | {
      contentIndex: number;
      delta: string;
      partial: LlmAssistantMessage;
      type: "text_delta";
    }
  | {
      content: string;
      contentIndex: number;
      partial: LlmAssistantMessage;
      type: "text_end";
    }
  | {
      contentIndex: number;
      partial: LlmAssistantMessage;
      type: "thinking_start";
    }
  | {
      contentIndex: number;
      delta: string;
      partial: LlmAssistantMessage;
      type: "thinking_delta";
    }
  | {
      content: string;
      contentIndex: number;
      partial: LlmAssistantMessage;
      type: "thinking_end";
    }
  | {
      contentIndex: number;
      partial: LlmAssistantMessage;
      type: "toolcall_start";
    }
  | {
      contentIndex: number;
      delta: string;
      partial: LlmAssistantMessage;
      type: "toolcall_delta";
    }
  | {
      contentIndex: number;
      partial: LlmAssistantMessage;
      toolCall: LlmToolCall;
      type: "toolcall_end";
    }
  | {
      message: LlmAssistantMessage;
      reason: LlmStopReason;
      type: "done";
    }
  | {
      error: LlmAssistantMessage;
      reason: LlmStopReason;
      type: "error";
    };

export class AssistantMessageEventStream implements AsyncIterable<AssistantMessageEvent> {
  private done = false;
  private readonly finalResult: Promise<LlmAssistantMessage>;
  private queue: AssistantMessageEvent[] = [];
  private resolveFinalResult!: (message: LlmAssistantMessage) => void;
  private waiting: ((result: IteratorResult<AssistantMessageEvent>) => void)[] =
    [];

  constructor() {
    this.finalResult = new Promise((resolve) => {
      this.resolveFinalResult = resolve;
    });
  }

  end(result?: LlmAssistantMessage): void {
    this.done = true;
    if (result !== undefined) {
      this.resolveFinalResult(result);
    }
    while (this.waiting.length > 0) {
      this.waiting.shift()!({ done: true, value: undefined });
    }
  }

  push(event: AssistantMessageEvent): void {
    if (this.done) {
      return;
    }
    if (event.type === "done") {
      this.done = true;
      this.resolveFinalResult(event.message);
    }
    if (event.type === "error") {
      this.done = true;
      this.resolveFinalResult(event.error);
    }

    const waiter = this.waiting.shift();
    if (waiter !== undefined) {
      waiter({ done: false, value: event });
      return;
    }
    this.queue.push(event);
  }

  result(): Promise<LlmAssistantMessage> {
    return this.finalResult;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    while (true) {
      const queued = this.queue.shift();
      if (queued !== undefined) {
        yield queued;
        continue;
      }
      if (this.done) {
        return;
      }
      const next = await new Promise<IteratorResult<AssistantMessageEvent>>(
        (resolve) => this.waiting.push(resolve),
      );
      if (next.done === true) {
        return;
      }
      yield next.value;
    }
  }
}

export function createAssistantMessageEventStream(): AssistantMessageEventStream {
  return new AssistantMessageEventStream();
}

export function emptyLlmUsage(): LlmUsage {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: {
      cacheRead: 0,
      cacheWrite: 0,
      input: 0,
      output: 0,
      total: 0,
    },
    input: 0,
    output: 0,
    totalTokens: 0,
  };
}
