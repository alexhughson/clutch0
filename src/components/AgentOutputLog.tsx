import type { AgentOutputBlock } from "../lib/agentOutput/agentOutputTypes";

type AgentOutputLogProps = {
  blocks: readonly AgentOutputBlock[];
  emptyMessage?: string;
  height?: number;
};

export function AgentOutputLog({
  blocks,
  emptyMessage = "Waiting for agent output...",
  height = 24,
}: AgentOutputLogProps) {
  return (
    <scrollbox
      stickyScroll
      stickyStart="bottom"
      style={{ height, width: "100%" }}
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

  const label = block.streamKind === "thinking" ? "thinking" : "assistant";
  return (
    <box style={{ flexDirection: "column" }}>
      <text
        style={{ fg: block.streamKind === "thinking" ? "gray" : undefined }}
      >
        {`${label}: ${block.text}`}
      </text>
    </box>
  );
}

function formatToolBlock(block: Extract<AgentOutputBlock, { kind: "tool" }>) {
  const suffix = block.summary.length === 0 ? "" : `: ${block.summary}`;
  return `tool ${block.toolName} ${block.phase}${suffix}`;
}
