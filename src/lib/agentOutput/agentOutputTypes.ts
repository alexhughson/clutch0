export type AgentOutputStreamKind = "assistant" | "thinking";

export type AgentOutputBlock =
  | {
      id: string;
      kind: "status";
      message: string;
      timestamp: number;
    }
  | {
      id: string;
      kind: "stream";
      streamKind: AgentOutputStreamKind;
      text: string;
      timestamp: number;
      truncated?: boolean;
    }
  | {
      id: string;
      isError?: boolean;
      kind: "tool";
      phase: "end" | "start" | "update";
      summary: string;
      timestamp: number;
      toolName: string;
    };

export type AgentOutputUpdate =
  | {
      block: AgentOutputBlock;
      kind: "append-block";
    }
  | {
      delta: string;
      id: string;
      kind: "append-stream-delta";
      streamKind: AgentOutputStreamKind;
      timestamp: number;
    };
