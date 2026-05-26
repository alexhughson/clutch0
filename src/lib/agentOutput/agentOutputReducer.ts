import type { AgentOutputBlock, AgentOutputUpdate } from "./agentOutputTypes";

export type AgentOutputReducerOptions = {
  maxBlocks?: number;
  maxStreamCharacters?: number;
};

const DEFAULT_MAX_BLOCKS = 200;
const DEFAULT_MAX_STREAM_CHARACTERS = 4_000;

export function applyAgentOutputUpdate(
  blocks: readonly AgentOutputBlock[],
  update: AgentOutputUpdate,
  options: AgentOutputReducerOptions = {},
): AgentOutputBlock[] {
  const maxBlocks = options.maxBlocks ?? DEFAULT_MAX_BLOCKS;
  const maxStreamCharacters =
    options.maxStreamCharacters ?? DEFAULT_MAX_STREAM_CHARACTERS;

  if (update.kind === "append-block") {
    return capBlocks([...blocks, update.block], maxBlocks);
  }

  if (update.delta.length === 0) {
    return [...blocks];
  }

  const lastBlock = blocks[blocks.length - 1];
  if (
    lastBlock?.kind === "stream" &&
    lastBlock.streamKind === update.streamKind
  ) {
    if (lastBlock.truncated) {
      return [...blocks];
    }

    const nextBlock = appendStreamDelta(
      lastBlock,
      update.delta,
      maxStreamCharacters,
    );

    return [...blocks.slice(0, -1), nextBlock];
  }

  if (update.delta.trim().length === 0) {
    return [...blocks];
  }

  return capBlocks(
    [
      ...blocks,
      appendStreamDelta(
        {
          id: update.id,
          kind: "stream",
          streamKind: update.streamKind,
          text: "",
          timestamp: update.timestamp,
        },
        update.delta,
        maxStreamCharacters,
      ),
    ],
    maxBlocks,
  );
}

function appendStreamDelta(
  block: Extract<AgentOutputBlock, { kind: "stream" }>,
  delta: string,
  maxStreamCharacters: number,
): Extract<AgentOutputBlock, { kind: "stream" }> {
  const text = block.text + delta;
  if (text.length <= maxStreamCharacters) {
    return {
      ...block,
      text,
    };
  }

  return {
    ...block,
    text: `${text.slice(0, Math.max(0, maxStreamCharacters - 1))}…`,
    truncated: true,
  };
}

function capBlocks(
  blocks: readonly AgentOutputBlock[],
  maxBlocks: number,
): AgentOutputBlock[] {
  return blocks.slice(-Math.max(1, maxBlocks));
}
