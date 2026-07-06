import type { AgentOutputBlock } from "../lib/agentOutput/agentOutputTypes";
import { splitAgentOutputBlocksForDisplay } from "../lib/agentOutput/agentOutputDisplay";
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
  const { activityBlocks, latestAssistantBlock } =
    splitAgentOutputBlocksForDisplay(blocks);
  if (latestAssistantBlock !== null) {
    const activityHeight =
      height === undefined ? "35%" : Math.max(1, Math.floor(height / 3));
    const assistantHeight =
      height === undefined
        ? "65%"
        : Math.max(1, height - Math.max(1, Math.floor(height / 3)));

    return (
      <box
        style={{
          flexDirection: "column",
          flexGrow: height === undefined ? 1 : undefined,
          gap: 1,
          height: height ?? "100%",
          width: "100%",
        }}
      >
        {activityBlocks.length === 0 ? null : (
          <scrollbox
            stickyScroll
            stickyStart="bottom"
            style={{ height: activityHeight, width: "100%" }}
          >
            {activityBlocks.map((block) => (
              <AgentOutputBlockView block={block} key={block.id} />
            ))}
          </scrollbox>
        )}
        <scrollbox
          stickyScroll
          stickyStart="bottom"
          style={{
            flexGrow: activityBlocks.length === 0 ? 1 : undefined,
            height: activityBlocks.length === 0 ? "100%" : assistantHeight,
            width: "100%",
          }}
        >
          <AgentOutputBlockView block={latestAssistantBlock} />
        </scrollbox>
      </box>
    );
  }

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
        activityBlocks.map((block) => (
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
    <box
      style={{
        backgroundColor: "#111827",
        flexDirection: "column",
        paddingX: 2,
        paddingY: 1,
        width: "100%",
      }}
    >
      <HighlightedMarkdown content={block.text} />
    </box>
  );
}

function formatToolBlock(block: Extract<AgentOutputBlock, { kind: "tool" }>) {
  const suffix = block.summary.length === 0 ? "" : `: ${block.summary}`;
  return `tool ${block.toolName} ${block.phase}${suffix}`;
}
