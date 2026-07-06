import type { AgentOutputBlock } from "./agentOutputTypes";

export type AgentOutputDisplayBlocks = {
  activityBlocks: readonly AgentOutputBlock[];
  latestAssistantBlock: AgentOutputBlock | null;
};

export function orderAgentOutputBlocksForDisplay(
  blocks: readonly AgentOutputBlock[],
): readonly AgentOutputBlock[] {
  const { activityBlocks, latestAssistantBlock } =
    splitAgentOutputBlocksForDisplay(blocks);
  return latestAssistantBlock === null
    ? activityBlocks
    : [...activityBlocks, latestAssistantBlock];
}

export function splitAgentOutputBlocksForDisplay(
  blocks: readonly AgentOutputBlock[],
): AgentOutputDisplayBlocks {
  const latestAssistantIndex = findLatestAssistantBlockIndex(blocks);
  if (latestAssistantIndex === -1) {
    return { activityBlocks: blocks, latestAssistantBlock: null };
  }

  return {
    activityBlocks: [
      ...blocks.slice(0, latestAssistantIndex),
      ...blocks.slice(latestAssistantIndex + 1),
    ],
    latestAssistantBlock: blocks[latestAssistantIndex] ?? null,
  };
}

function findLatestAssistantBlockIndex(
  blocks: readonly AgentOutputBlock[],
): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind === "stream" && block.streamKind === "assistant") {
      return index;
    }
  }

  return -1;
}
