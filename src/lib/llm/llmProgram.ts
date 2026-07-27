import {
  GeminiTranslator,
  OpenAIChatTranslator,
  OpenAIResponsesTranslator,
  type Program,
  type ThinkingEffort,
  type Translator,
} from "fiat";
import type { ClutchModelEffortLevel } from "../config/clutchConfigSchemas";
import type {
  LlmContext,
  LlmModel,
  LlmThinkingLevel,
  LlmUserMessage,
} from "./types";

export type LlmRequestOptions = {
  apiKey: string;
  effortLevel?: ClutchModelEffortLevel;
  headers?: Record<string, string>;
  maxTokens?: number;
  onPayload?: (
    payload: unknown,
    model: LlmModel,
  ) => unknown | undefined | Promise<unknown | undefined>;
  onResponse?: (
    response: { headers: Record<string, string>; status: number },
    model: LlmModel,
  ) => void | Promise<void>;
  reasoning?: LlmThinkingLevel;
  reasoningEffort?: LlmThinkingLevel;
  serviceTier?: "priority";
  signal?: AbortSignal;
  temperature?: number;
};

const OPENROUTER_GEMINI_PREFIX = "google/gemini-3";
const OPENROUTER_OPENAI_PREFIXES = [
  "openai/gpt-5",
  "openai/o",
  "xai/grok",
] as const;

export function translatorForModel(model: LlmModel): Translator {
  if (model.api === "openai-completions") return OpenAIChatTranslator;
  if (model.api === "openai-responses") return OpenAIResponsesTranslator;
  if (model.api === "google-generative-ai") return GeminiTranslator;
  throw new Error(
    `Unsupported direct LLM provider/api combination: provider=${model.provider} model=${model.id} api=${model.api}.`,
  );
}

export function clientVariantForModel(
  model: LlmModel,
): "openrouter" | undefined {
  return model.provider === "openrouter" && model.api === "openai-completions"
    ? "openrouter"
    : undefined;
}

export function buildLlmProgram(
  model: LlmModel,
  context: LlmContext,
  options: LlmRequestOptions,
): Program {
  const program: Program = [{ op: "llm.model", model: model.id }];
  if (options.maxTokens !== undefined) {
    program.push({ op: "llm.max_output_tokens", value: options.maxTokens });
  }
  appendThinkingOp(program, model, options);
  if (options.serviceTier !== undefined) {
    program.push({ op: "llm.service_tier", value: options.serviceTier });
  }
  if (model.api === "openai-responses") {
    program.push({ op: "request.store", value: false });
  }
  if (options.temperature !== undefined) {
    program.push({ op: "llm.temperature", value: options.temperature });
  }
  if (context.systemPrompt !== undefined) {
    program.push({
      op: "llm.text",
      role: "system",
      content: context.systemPrompt,
    });
  }
  for (const message of context.messages) {
    if (message.role === "user") {
      program.push({
        op: "llm.text",
        role: "user",
        content: textFromMessageContent(message.content, "user"),
      });
      continue;
    }
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "text") {
          program.push({
            op: "llm.text",
            role: "assistant",
            content: block.text,
          });
        }
        if (block.type === "toolCall") {
          program.push({
            op: "llm.tool_call",
            id: block.id,
            name: block.name,
            arguments: block.arguments,
          });
        }
      }
      continue;
    }
    program.push({
      op: "llm.tool_result",
      id: message.toolCallId,
      content: textFromMessageContent(message.content, "tool result"),
    });
  }
  for (const tool of context.tools) {
    program.push({
      op: "llm.tool",
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
    });
  }
  if (context.tools.length > 0) {
    program.push({ op: "llm.tool_choice", value: "auto" });
  }
  return program;
}

function appendThinkingOp(
  program: Program,
  model: LlmModel,
  options: LlmRequestOptions,
): void {
  const effortLevel = resolveEffortLevel(options);
  if (effortLevel === undefined) return;
  if (model.provider === "openrouter" && model.api === "openai-completions") {
    if (!openRouterReasoningModel(model.id)) return;
    program.push({
      op: "llm.thinking",
      effort: mapThinkingEffort(model, effortLevel),
    });
    return;
  }
  if (
    (model.api === "openai-responses" ||
      model.api === "google-generative-ai") &&
    model.reasoning
  ) {
    program.push({
      op: "llm.thinking",
      effort: mapThinkingEffort(model, effortLevel),
    });
  }
}

function resolveEffortLevel(
  options: LlmRequestOptions,
): ClutchModelEffortLevel | undefined {
  if (options.effortLevel !== undefined) return options.effortLevel;
  const effort = options.reasoningEffort ?? options.reasoning;
  return effort === undefined ? undefined : effort;
}

function openRouterReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (id.startsWith(OPENROUTER_GEMINI_PREFIX)) return true;
  return OPENROUTER_OPENAI_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function mapThinkingEffort(
  model: LlmModel,
  effort: ClutchModelEffortLevel | LlmThinkingLevel,
): ThinkingEffort {
  if (effort === "off") return "off";
  const mapped =
    model.thinkingLevelMap?.[effort as keyof typeof model.thinkingLevelMap];
  if (mapped === null) {
    throw new Error(
      `Model ${model.provider}/${model.id} cannot use effort level ${effort}.`,
    );
  }
  const resolved = mapped ?? effort;
  if (
    resolved === "low" ||
    resolved === "medium" ||
    resolved === "high" ||
    resolved === "xhigh" ||
    resolved === "max" ||
    resolved === "minimal" ||
    resolved === "off"
  ) {
    return resolved;
  }
  throw new Error(
    `Model ${model.provider}/${model.id} maps thinking effort to unsupported fiat effort ${resolved}.`,
  );
}

function textFromMessageContent(
  content: LlmUserMessage["content"],
  label: string,
): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (block.type !== "text") {
        throw new Error(`Cannot serialize ${label} image content to fiat.`);
      }
      return block.text;
    })
    .join("\n");
}
