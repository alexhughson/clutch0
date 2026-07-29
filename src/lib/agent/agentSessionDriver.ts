export type AgentSessionDriver = {
  /** Kill in-flight child only. Must NOT burn session id or delete worktree. */
  dispose(): Promise<void>;
  latestAssistantText(): string | null;
  prompt(message: string): Promise<void>;
};
