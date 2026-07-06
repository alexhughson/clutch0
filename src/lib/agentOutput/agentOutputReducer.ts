import type {
  AgentOutputBlock,
  AgentOutputStreamKind,
  AgentOutputUpdate,
} from "./agentOutputTypes";

export type AgentOutputReducerOptions = {
  maxBlocks?: number;
  maxStreamCharacters?: number;
  maxStreamCharactersByKind?: Partial<Record<AgentOutputStreamKind, number>>;
};

const DEFAULT_MAX_BLOCKS = 200;
const DEFAULT_MAX_THINKING_STREAM_CHARACTERS = 4_000;

export function applyAgentOutputUpdate(
  blocks: readonly AgentOutputBlock[],
  update: AgentOutputUpdate,
  options: AgentOutputReducerOptions = {},
): AgentOutputBlock[] {
  const maxBlocks = options.maxBlocks ?? DEFAULT_MAX_BLOCKS;
  if (update.kind === "append-block") {
    return capBlocks([...blocks, update.block], maxBlocks);
  }

  if (update.kind === "reconcile-stream") {
    return reconcileStreamText(blocks, update, options);
  }

  if (update.delta.length === 0) {
    return [...blocks];
  }

  const targetIndex = findStreamBlockIndexById(
    blocks,
    update.id,
    update.streamKind,
  );
  if (targetIndex !== -1) {
    const targetBlock = blocks[targetIndex];
    if (targetBlock === undefined || targetBlock.kind !== "stream") {
      throw new Error("Expected stream block for matched stream id.");
    }

    if (targetBlock.truncated) {
      return [...blocks];
    }

    const nextBlock = appendStreamDelta(
      targetBlock,
      update.delta,
      getMaxStreamCharacters(update.streamKind, options),
    );

    return [
      ...blocks.slice(0, targetIndex),
      nextBlock,
      ...blocks.slice(targetIndex + 1),
    ];
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
        getMaxStreamCharacters(update.streamKind, options),
      ),
    ],
    maxBlocks,
  );
}

function reconcileStreamText(
  blocks: readonly AgentOutputBlock[],
  update: Extract<AgentOutputUpdate, { kind: "reconcile-stream" }>,
  options: AgentOutputReducerOptions,
): AgentOutputBlock[] {
  if (update.text.trim().length === 0) {
    return [...blocks];
  }

  const maxStreamCharacters = getMaxStreamCharacters(
    update.streamKind,
    options,
  );
  const nextBlock = streamBlockFromText({
    id: update.id,
    maxStreamCharacters,
    streamKind: update.streamKind,
    text: update.text,
    timestamp: update.timestamp,
  });

  const targetIndex = findStreamBlockIndexById(
    blocks,
    update.id,
    update.streamKind,
  );
  if (targetIndex !== -1) {
    const block = blocks[targetIndex];
    if (block === undefined || block.kind !== "stream") {
      throw new Error("Expected stream block for matched stream id.");
    }

    if (block.text === nextBlock.text && block.truncated === nextBlock.truncated) {
      return [...blocks];
    }

    return [
      ...blocks.slice(0, targetIndex),
      { ...nextBlock, id: block.id },
      ...blocks.slice(targetIndex + 1),
    ];
  }

  if (update.reconcileStrategy === "stream-id") {
    return capBlocks(
      [...blocks, nextBlock],
      options.maxBlocks ?? DEFAULT_MAX_BLOCKS,
    );
  }

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind !== "stream" || block.streamKind !== update.streamKind) {
      continue;
    }

    if (block.text === nextBlock.text && block.truncated === nextBlock.truncated) {
      return [...blocks];
    }

    if (isPartialStreamText(block.text, nextBlock.text)) {
      return [
        ...blocks.slice(0, index),
        { ...nextBlock, id: block.id },
        ...blocks.slice(index + 1),
      ];
    }

    return capBlocks(
      [...blocks, nextBlock],
      options.maxBlocks ?? DEFAULT_MAX_BLOCKS,
    );
  }

  return capBlocks(
    [...blocks, nextBlock],
    options.maxBlocks ?? DEFAULT_MAX_BLOCKS,
  );
}

function isPartialStreamText(existingText: string, finalText: string): boolean {
  return (
    existingText.length === 0 ||
    finalText.startsWith(existingText) ||
    existingText.startsWith(finalText)
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
    text: truncateStreamText(text, block.streamKind, maxStreamCharacters),
    truncated: true,
  };
}

function streamBlockFromText({
  id,
  maxStreamCharacters,
  streamKind,
  text,
  timestamp,
}: {
  id: string;
  maxStreamCharacters: number;
  streamKind: AgentOutputStreamKind;
  text: string;
  timestamp: number;
}): Extract<AgentOutputBlock, { kind: "stream" }> {
  if (text.length <= maxStreamCharacters) {
    return {
      id,
      kind: "stream",
      streamKind,
      text,
      timestamp,
    };
  }

  return {
    id,
    kind: "stream",
    streamKind,
    text: truncateStreamText(text, streamKind, maxStreamCharacters),
    timestamp,
    truncated: true,
  };
}

function getMaxStreamCharacters(
  streamKind: AgentOutputStreamKind,
  options: AgentOutputReducerOptions,
): number {
  return (
    options.maxStreamCharactersByKind?.[streamKind] ??
    options.maxStreamCharacters ??
    getDefaultMaxStreamCharacters(streamKind)
  );
}

function getDefaultMaxStreamCharacters(
  streamKind: AgentOutputStreamKind,
): number {
  return streamKind === "assistant"
    ? Number.POSITIVE_INFINITY
    : DEFAULT_MAX_THINKING_STREAM_CHARACTERS;
}

function truncateStreamText(
  text: string,
  streamKind: AgentOutputStreamKind,
  maxStreamCharacters: number,
): string {
  const marker =
    streamKind === "assistant" ? "\n[Agent output truncated.]" : "…";
  const prefixLength = Math.max(0, maxStreamCharacters - marker.length);
  return `${text.slice(0, prefixLength)}${marker}`;
}

function capBlocks(
  blocks: readonly AgentOutputBlock[],
  maxBlocks: number,
): AgentOutputBlock[] {
  return blocks.slice(-Math.max(1, maxBlocks));
}

function findStreamBlockIndexById(
  blocks: readonly AgentOutputBlock[],
  id: string,
  streamKind: AgentOutputStreamKind,
): number {
  return blocks.findIndex(
    (block) =>
      block.kind === "stream" &&
      block.id === id &&
      block.streamKind === streamKind,
  );
}
