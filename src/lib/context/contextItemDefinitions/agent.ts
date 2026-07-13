import type {
  ContextItemAction,
  ContextItemDetailView,
  ContextItemSummarizationInput,
  ContextItemSummaryView,
  FormattedContextItem,
  FormatContextItemForLlmOptions,
} from "../../../types";
import type { ContextItemDefinition } from "../contextItemDefinition";
import type { PiAgentContextItem } from "../contextItemTypes";
import {
  openContextItemAction,
  removeContextItemAction,
  saveAgentSandboxDiffAction,
} from "../contextItemActions";
import {
  formatAgentOutputBlocks,
  formatAttributes,
  getGeneratedSummaryView,
  getLatestAgentAssistantMessage,
  hashContent,
  MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS,
  MAX_SAVED_CONTEXT_CHARACTERS,
  summarize,
  truncateContent,
} from "../contextItemFormatting";

export const piAgentContextItemDefinition: ContextItemDefinition<"pi-agent"> = {
  getSummaryView(item: PiAgentContextItem): ContextItemSummaryView {
    return getGeneratedSummaryView(item.summaryState, {
      detail:
        item.status === "running"
          ? "Agent is running…"
          : summarize(formatAgentOutputBlocks(item.blocks)),
      title: `${item.mode === "edit" ? "Agent edit" : "Agent"}: ${summarize(item.prompt)}`,
    });
  },

  getActions(item: PiAgentContextItem): readonly ContextItemAction[] {
    return [
      openContextItemAction(item.id),
      ...(item.mode === "edit" &&
      item.status !== "running" &&
      item.sessionAvailability === "live"
        ? [saveAgentSandboxDiffAction(item.id)]
        : []),
      removeContextItemAction(item.id),
    ];
  },

  async getSummarizationInput(
    item: PiAgentContextItem,
  ): Promise<ContextItemSummarizationInput | null> {
    if (item.status === "running") {
      return null;
    }

    const output = formatAgentOutputBlocks(item.blocks);
    if (output.trim().length === 0 && item.errorMessage === undefined) {
      return null;
    }

    const sourceText = `Prompt:\n${truncateContent(item.prompt, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nStatus: ${item.status}\n\nOutput:\n${truncateContent(output, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nError:\n${item.errorMessage ?? ""}`;

    return {
      content: sourceText,
      itemId: item.id,
      label: `Agent: ${summarize(item.prompt)}`,
      sourceHash: hashContent(sourceText),
      type: item.type,
    };
  },

  getLiveDetailView(
    item: PiAgentContextItem,
  ): Extract<ContextItemDetailView, { kind: "agent-output" }> {
    return {
      blocks: item.blocks,
      errorMessage: item.errorMessage,
      itemId: item.id,
      kind: "agent-output" as const,
      prompt: item.prompt,
      sandbox: item.sandbox,
      sessionAvailability: item.sessionAvailability,
      status: item.status,
      title: `${item.mode === "edit" ? "Agent edit" : "Agent"}: ${summarize(item.prompt)}`,
    };
  },

  async getDetailView(
    item: PiAgentContextItem,
  ): Promise<ContextItemDetailView> {
    return {
      blocks: item.blocks,
      errorMessage: item.errorMessage,
      itemId: item.id,
      kind: "agent-output" as const,
      prompt: item.prompt,
      sandbox: item.sandbox,
      sessionAvailability: item.sessionAvailability,
      status: item.status,
      title: `${item.mode === "edit" ? "Agent edit" : "Agent"}: ${summarize(item.prompt)}`,
    };
  },

  async formatForLlm(
    item: PiAgentContextItem,
    { focused }: FormatContextItemForLlmOptions,
  ): Promise<FormattedContextItem> {
    const latestMessage = getLatestAgentAssistantMessage(item.blocks);

    return {
      consumedFileCharacters: 0,
      text: `<agent_session${formatAttributes({ focused, created_at: new Date(item.createdAt).toISOString(), mode: item.mode, sandbox_path: item.sandbox?.path, sandbox_diff_status: item.sandbox?.diffStatus, status: item.status })}>\n<question>\n${truncateContent(item.prompt, MAX_SAVED_CONTEXT_CHARACTERS)}\n</question>\n<response>\n${truncateContent(latestMessage ?? "No agent message yet.", MAX_SAVED_CONTEXT_CHARACTERS)}\n</response>\n</agent_session>`,
    };
  },
};
