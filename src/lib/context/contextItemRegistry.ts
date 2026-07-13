import type {
  ContextItemAction,
  ContextItemDetailView,
  ContextItemSummarizationInput,
  ContextItemSummaryView,
  FormattedContextItem,
  FormatContextItemForLlmOptions,
  GetContextItemDetailViewOptions,
  GetContextItemSummaryInputOptions,
  SessionEvent,
} from "../../types";
import type {
  ContextItemDefinition,
  ContextItemDefinitions,
} from "./contextItemDefinition";
import { piAgentContextItemDefinition } from "./contextItemDefinitions/agent";
import { automaticFileListContextItemDefinition } from "./contextItemDefinitions/automaticFileList";
import { automaticUnstagedChangesContextItemDefinition } from "./contextItemDefinitions/automaticUnstagedChanges";
import { fileContextItemDefinition } from "./contextItemDefinitions/file";
import { liveLlmResponseContextItemDefinition } from "./contextItemDefinitions/liveLlmResponse";
import { savedAgentSandboxDiffContextItemDefinition } from "./contextItemDefinitions/savedAgentSandboxDiff";
import { savedDiffContextItemDefinition } from "./contextItemDefinitions/savedDiff";
import { savedLlmResponseContextItemDefinition } from "./contextItemDefinitions/savedLlmResponse";
import { shellCommandOutputContextItemDefinition } from "./contextItemDefinitions/shellCommand";
import { userTextContextItemDefinition } from "./contextItemDefinitions/userText";
import { getPersistentContextItemHistoryEvents } from "./contextItemHistory";
import type { ContextItem, PersistentContextItem } from "./contextItemTypes";

const contextItemDefinitions = {
  file: fileContextItemDefinition,
  "llm-response": savedLlmResponseContextItemDefinition,
  "llm-response-live": liveLlmResponseContextItemDefinition,
  "shell-command-output": shellCommandOutputContextItemDefinition,
  "user-text": userTextContextItemDefinition,
  "pi-agent": piAgentContextItemDefinition,
  diff: savedDiffContextItemDefinition,
  "agent-sandbox-diff": savedAgentSandboxDiffContextItemDefinition,
  "automatic-unstaged-changes": automaticUnstagedChangesContextItemDefinition,
  "automatic-file-list": automaticFileListContextItemDefinition,
} satisfies ContextItemDefinitions;

function definitionFor(
  item: ContextItem,
): ContextItemDefinition<ContextItem["type"]> {
  return contextItemDefinitions[item.type] as ContextItemDefinition<
    ContextItem["type"]
  >;
}

export function getContextItemSummaryView(
  item: ContextItem,
): ContextItemSummaryView {
  return definitionFor(item).getSummaryView(item);
}

export function getContextItemActions(
  item: ContextItem,
): readonly ContextItemAction[] {
  return definitionFor(item).getActions(item);
}

export async function getContextItemSummarizationInput(
  item: ContextItem,
  options: GetContextItemSummaryInputOptions,
): Promise<ContextItemSummarizationInput | null> {
  return definitionFor(item).getSummarizationInput(item, options);
}

export async function getContextItemDetailView(
  item: ContextItem,
  options: GetContextItemDetailViewOptions,
): Promise<ContextItemDetailView | null> {
  return definitionFor(item).getDetailView(item, options);
}

export function getContextItemLiveDetailView(
  item: ContextItem,
): ContextItemDetailView | null {
  const definition = definitionFor(item);
  return definition.getLiveDetailView?.(item) ?? null;
}

export function getContextItemHistoryEvents(
  item: ContextItem,
  previous: ContextItem | null,
): readonly SessionEvent[] {
  const baseEvents = getCommonContextItemHistoryEvents(item, previous);
  if (baseEvents !== null) {
    return baseEvents;
  }

  if (previous === null || previous.type !== item.type) {
    return [];
  }

  if (!isPersistentHistoryItem(item) || !isPersistentHistoryItem(previous)) {
    return [];
  }

  return getPersistentContextItemHistoryEvents(item, previous);
}

export async function formatContextItemForLlm(
  item: ContextItem,
  options: FormatContextItemForLlmOptions,
): Promise<FormattedContextItem> {
  return definitionFor(item).formatForLlm(item, options);
}

function getCommonContextItemHistoryEvents(
  item: ContextItem,
  previous: ContextItem | null,
): readonly SessionEvent[] | null {
  if (previous === null) {
    return [
      {
        at: Date.now(),
        details: { type: item.type },
        itemId: item.id,
        kind: "context-item.created",
        schemaVersion: 1,
      },
    ];
  }

  if (previous.type !== item.type) {
    return [
      {
        at: Date.now(),
        details: { fromType: previous.type, toType: item.type },
        itemId: item.id,
        kind: "context-item.replaced",
        schemaVersion: 1,
      },
    ];
  }

  return null;
}

function isPersistentHistoryItem(
  item: ContextItem,
): item is PersistentContextItem {
  return (
    item.type !== "automatic-unstaged-changes" &&
    item.type !== "automatic-file-list"
  );
}
