import { createHash } from "node:crypto";
import type { AgentOutputBlock } from "../agentOutput/agentOutputTypes";
import type { McpToolOutput } from "../mcp/mcpTypes";
import type { ShellCommandResult } from "../shell/shellCommand";
import type { ContextItemSummaryState, LlmFileContext } from "../../types";

export const MAX_FILE_CONTEXT_CHARACTERS = 60_000;
export const MAX_TOTAL_FILE_CONTEXT_CHARACTERS = 200_000;
export const MAX_SAVED_CONTEXT_CHARACTERS = 60_000;
export const MAX_CONTEXT_ITEM_DETAIL_CHARACTERS = 20_000;
export const MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS = 30_000;

export function getLatestAgentAssistantMessage(
  blocks: readonly AgentOutputBlock[],
): string | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind === "stream" && block.streamKind === "assistant") {
      return block.text;
    }
  }

  return null;
}

export function formatAgentOutputBlocks(
  blocks: readonly AgentOutputBlock[],
): string {
  return blocks
    .map((block) => {
      if (block.kind === "status") {
        return block.message;
      }

      if (block.kind === "tool") {
        const suffix = block.summary.length === 0 ? "" : `: ${block.summary}`;
        return `tool ${block.toolName} ${block.phase}${suffix}`;
      }

      return `${block.streamKind}: ${block.text}`;
    })
    .join("\n");
}

export function formatMcpToolOutputForDisplay(output: McpToolOutput): string {
  return [
    "# MCP tool output",
    "",
    `Server: \`${output.serverName}\``,
    `Tool: \`${output.toolName}\``,
    `Status: ${output.isError ? "tool returned an error" : "ok"}`,
    "",
    "## Arguments",
    "```json",
    truncateContent(
      safeJsonStringify(output.arguments),
      MAX_CONTEXT_ITEM_DETAIL_CHARACTERS,
    ),
    "```",
    "",
    "## Content",
    output.contentText.trim().length === 0
      ? "(none)"
      : truncateContent(output.contentText, MAX_CONTEXT_ITEM_DETAIL_CHARACTERS),
    "",
    "## Structured content",
    output.structuredContent === undefined
      ? "(none)"
      : `\`\`\`json\n${truncateContent(safeJsonStringify(output.structuredContent), MAX_CONTEXT_ITEM_DETAIL_CHARACTERS)}\n\`\`\``,
    "",
    "## Raw result",
    "```json",
    truncateContent(
      safeJsonStringify(output.rawResult),
      MAX_CONTEXT_ITEM_DETAIL_CHARACTERS,
    ),
    "```",
  ].join("\n");
}

export function formatMcpToolOutputForLlm(output: McpToolOutput): string {
  return [
    output.isError ? "MCP tool returned an error." : "MCP tool succeeded.",
    "",
    output.contentText.trim().length === 0
      ? "(no text content)"
      : output.contentText,
    output.structuredContent === undefined
      ? ""
      : `\nStructured content:\n${safeJsonStringify(output.structuredContent)}`,
  ].join("\n");
}

export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return `Could not serialize value: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function formatShellCommandOutput(result: ShellCommandResult): string {
  const metadata = [
    `$ ${result.command}`,
    `exit code: ${result.exitCode ?? "signal"}`,
    result.signal === undefined ? null : `signal: ${result.signal}`,
    `duration: ${result.durationMs}ms`,
    result.timedOut ? "timed out" : null,
    result.truncated ? "output truncated" : null,
  ].filter((line): line is string => line !== null);

  return `${metadata.join("\n")}\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`;
}

export function formatFile(
  file: LlmFileContext,
  { focused }: { focused: boolean },
): string {
  const attributes = formatAttributes({
    path: file.filePath,
    focused,
    status: file.status === "skipped" ? "skipped" : undefined,
  });

  if (file.status === "skipped") {
    return `<file${attributes}>\n${file.errorMessage ?? "Skipped."}\n</file>`;
  }

  const truncatedNote = file.truncated
    ? "\n[File truncated because the selected file context limit was reached.]"
    : "";

  return `<file${attributes}>\n${file.content}${truncatedNote}\n</file>`;
}

export function formatAttributes(
  attributes: Record<string, boolean | number | string | undefined>,
): string {
  const formatted = Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([key, value]) =>
      value === true ? `${key}="true"` : `${key}=${JSON.stringify(value)}`,
    );

  return formatted.length === 0 ? "" : ` ${formatted.join(" ")}`;
}

export function truncateContent(
  content: string,
  maxCharacters: number,
): string {
  if (content.length <= maxCharacters) {
    return content;
  }

  return `${content.slice(0, maxCharacters)}\n[Context truncated.]`;
}

export function getGeneratedSummaryView(
  summaryState: ContextItemSummaryState,
  fallback: { detail: string; title: string },
) {
  if (summaryState.status === "ready") {
    return {
      detail: summaryState.summary.details,
      label: fallback.title,
      status: summaryState.status,
      title: summaryState.summary.oneLine,
    };
  }

  if (summaryState.status === "pending") {
    return {
      detail: "Summarizing…",
      label: fallback.title,
      status: summaryState.status,
      title: fallback.title,
    };
  }

  if (summaryState.status === "error") {
    return {
      detail: `Summary unavailable: ${summaryState.errorMessage}`,
      label: fallback.title,
      status: summaryState.status,
      title: fallback.title,
    };
  }

  return {
    ...fallback,
    label: fallback.title,
    status: summaryState.status,
  };
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function summarize(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 60) {
    return normalized.length > 0 ? normalized : "Untitled";
  }

  return `${normalized.slice(0, 57)}…`;
}
