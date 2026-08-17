import type { AgentOutputBlock } from "../lib/agentOutput/agentOutputTypes";
import {
  orderAgentOutputBlocksForDisplay,
  stripAgentSandboxPathPrefix,
} from "../lib/agentOutput/agentOutputDisplay";
import { HighlightedMarkdown } from "./SyntaxHighlightedContent";

type AgentOutputLogProps = {
  blocks: readonly AgentOutputBlock[];
  emptyMessage?: string;
  height?: number;
};

export function AgentOutputLog({
  blocks,
  emptyMessage = "Waiting for agent output...",
  height,
}: AgentOutputLogProps) {
  const orderedBlocks = orderAgentOutputBlocksForDisplay(blocks);
  const latestAssistantId = findLatestAssistantBlockId(orderedBlocks);

  return (
    <scrollbox
      stickyScroll
      stickyStart="bottom"
      style={{
        flexGrow: height === undefined ? 1 : undefined,
        height: height ?? "100%",
        minHeight: 0,
        width: "100%",
      }}
    >
      {orderedBlocks.length === 0 ? (
        <text style={{ fg: "gray" }}>{emptyMessage}</text>
      ) : (
        <box style={{ flexDirection: "column", gap: 0, width: "100%" }}>
          {orderedBlocks.map((block) => (
            <AgentOutputBlockView
              block={block}
              key={block.id}
              isFinalAssistant={block.id === latestAssistantId}
            />
          ))}
        </box>
      )}
    </scrollbox>
  );
}

function AgentOutputBlockView({
  block,
  isFinalAssistant,
}: {
  block: AgentOutputBlock;
  isFinalAssistant: boolean;
}) {
  if (block.kind === "status") {
    return <text style={{ fg: "gray" }}>{block.message}</text>;
  }

  if (block.kind === "tool") {
    return (
      <text
        truncate
        wrapMode="none"
        style={{ fg: block.isError ? "red" : "cyan" }}
      >
        {formatToolBlock(block)}
      </text>
    );
  }

  if (block.streamKind === "thinking") {
    return (
      <text truncate wrapMode="none" style={{ fg: "gray" }}>
        {formatThinkingLine(block.text)}
      </text>
    );
  }

  if (!isFinalAssistant) {
    return (
      <text truncate wrapMode="none" style={{ fg: "#94a3b8" }}>
        {formatAssistantPreview(block.text)}
      </text>
    );
  }

  return (
    <box style={{ flexDirection: "column", gap: 1, width: "100%" }}>
      <text style={{ fg: "#64748b" }}>── response ──</text>
      <box
        style={{
          backgroundColor: "#111827",
          flexDirection: "column",
          paddingX: 1,
          paddingY: 1,
          width: "100%",
        }}
      >
        <HighlightedMarkdown content={block.text} streaming />
      </box>
    </box>
  );
}

function findLatestAssistantBlockId(
  blocks: readonly AgentOutputBlock[],
): string | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind === "stream" && block.streamKind === "assistant") {
      return block.id;
    }
  }
  return null;
}

function formatToolBlock(block: Extract<AgentOutputBlock, { kind: "tool" }>) {
  const summary = stripAgentSandboxPathPrefix(
    block.summary.replace(/\s+/g, " ").trim(),
  );
  const detail =
    summary.length === 0 || summary === block.toolName
      ? block.toolName
      : `${block.toolName}  ${summary}`;
  if (block.phase === "end") {
    return block.isError === true ? `✗ ${detail}` : `✓ ${detail}`;
  }
  return `▸ ${detail}`;
}

function formatThinkingLine(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return "thinking";
  }
  if (collapsed.length <= 100) {
    return `thinking · ${collapsed}`;
  }
  return `thinking · …${collapsed.slice(-97)}`;
}

function formatAssistantPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return "assistant";
  }
  if (collapsed.length <= 100) {
    return `assistant · ${collapsed}`;
  }
  return `assistant · ${collapsed.slice(0, 97)}…`;
}
