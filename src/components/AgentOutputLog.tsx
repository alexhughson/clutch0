import type { AgentOutputBlock } from "../lib/agentOutput/agentOutputTypes";
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
  return (
    <scrollbox
      stickyScroll
      stickyStart="bottom"
      style={{
        flexGrow: height === undefined ? 1 : undefined,
        height: height ?? "100%",
        width: "100%",
      }}
    >
      {blocks.length === 0 ? (
        <text style={{ fg: "gray" }}>{emptyMessage}</text>
      ) : (
        blocks.map((block) => (
          <AgentOutputBlockView block={block} key={block.id} />
        ))
      )}
    </scrollbox>
  );
}

function AgentOutputBlockView({ block }: { block: AgentOutputBlock }) {
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
    return <text style={{ fg: "gray" }}>{`thinking: ${block.text}`}</text>;
  }

  return (
    <box style={{ flexDirection: "column" }}>
      <text style={{ fg: "gray" }}>assistant:</text>
      <HighlightedMarkdown content={block.text} />
    </box>
  );
}

function formatToolBlock(block: Extract<AgentOutputBlock, { kind: "tool" }>) {
  const suffix = block.summary.length === 0 ? "" : `: ${block.summary}`;
  return `tool ${block.toolName} ${block.phase}${suffix}`;
}
