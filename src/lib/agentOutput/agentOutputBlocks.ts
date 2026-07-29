import type { AgentOutputBlock } from "./agentOutputTypes";

let nextAgentOutputId = 1;

export function createAgentOutputId(): string {
  const id = `agent-output-${nextAgentOutputId}`;
  nextAgentOutputId += 1;
  return id;
}

export function createAgentStatusBlock(message: string): AgentOutputBlock {
  return {
    id: createAgentOutputId(),
    kind: "status",
    message,
    timestamp: Date.now(),
  };
}

export function createAgentToolBlock({
  isError,
  phase,
  summary,
  toolName,
}: {
  isError?: boolean;
  phase: "end" | "start" | "update";
  summary: string;
  toolName: string;
}): AgentOutputBlock {
  return {
    id: createAgentOutputId(),
    isError,
    kind: "tool",
    phase,
    summary,
    timestamp: Date.now(),
    toolName,
  };
}
