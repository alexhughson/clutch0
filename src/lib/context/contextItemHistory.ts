import { getPatchProposalPaths } from "../patch/patchEngine";
import type { SessionEvent } from "../../types";
import type { PersistentContextItem } from "./contextItemTypes";
import { fieldChanged, stateUpdatedEvent } from "./contextItemDefinitions/shared";

type PersistentContextItemPair = {
  item: PersistentContextItem;
  previous: PersistentContextItem;
};

type HistoryRule = {
  changed: (pair: PersistentContextItemPair) => boolean;
  details?: (pair: PersistentContextItemPair) => Record<string, unknown> | undefined;
  kind: string;
};

const persistentContextItemHistoryRules = {
  file: [
    {
      changed: ({ item, previous }) =>
        fieldChanged(previous, item, "summaryState"),
      kind: "file.summary-updated",
    },
  ],
  "llm-response": [
    {
      changed: ({ item, previous }) =>
        previous.type === "llm-response" &&
        item.type === "llm-response" &&
        previous.output !== item.output,
      details: ({ item, previous }) =>
        previous.type === "llm-response" && item.type === "llm-response"
          ? {
              outputLength: item.output.length,
              previousOutputLength: previous.output.length,
            }
          : undefined,
      kind: "llm-response.output-updated",
    },
    {
      changed: ({ item, previous }) =>
        fieldChanged(previous, item, "summaryState"),
      kind: "llm-response.summary-updated",
    },
  ],
  "shell-command-output": [
    {
      changed: ({ item, previous }) =>
        previous.type === "shell-command-output" &&
        item.type === "shell-command-output" &&
        fieldChanged(previous, item, "result"),
      details: ({ item, previous }) =>
        previous.type === "shell-command-output" &&
        item.type === "shell-command-output"
          ? {
              command: item.result.command,
              exitCode: item.result.exitCode,
              stderrLength: item.result.stderr.length,
              stdoutLength: item.result.stdout.length,
            }
          : undefined,
      kind: "shell-command-output.result-updated",
    },
  ],
  "user-text": [
    {
      changed: ({ item, previous }) =>
        previous.type === "user-text" &&
        item.type === "user-text" &&
        previous.text !== item.text,
      details: ({ item, previous }) =>
        previous.type === "user-text" && item.type === "user-text"
          ? {
              previousTextLength: previous.text.length,
              textLength: item.text.length,
            }
          : undefined,
      kind: "user-text.edited",
    },
    {
      changed: ({ item, previous }) =>
        fieldChanged(previous, item, "summaryState"),
      kind: "user-text.summary-updated",
    },
  ],
  "llm-response-live": [
    {
      changed: ({ item, previous }) =>
        previous.type === "llm-response-live" &&
        item.type === "llm-response-live" &&
        previous.output !== item.output,
      details: ({ item, previous }) =>
        previous.type === "llm-response-live" && item.type === "llm-response-live"
          ? {
              outputLength: item.output.length,
              previousOutputLength: previous.output.length,
            }
          : undefined,
      kind: "live-llm-response.output-updated",
    },
    {
      changed: ({ item, previous }) =>
        previous.type === "llm-response-live" &&
        item.type === "llm-response-live" &&
        (previous.status !== item.status ||
          previous.errorMessage !== item.errorMessage),
      details: ({ item, previous }) =>
        previous.type === "llm-response-live" && item.type === "llm-response-live"
          ? {
              errorMessage: item.errorMessage,
              previousStatus: previous.status,
              status: item.status,
            }
          : undefined,
      kind: "live-llm-response.status-changed",
    },
  ],
  "pi-agent": [
    {
      changed: ({ item, previous }) =>
        fieldChanged(previous, item, "blocks"),
      details: ({ item, previous }) =>
        previous.type === "pi-agent" && item.type === "pi-agent"
          ? {
              blockCount: item.blocks.length,
              previousBlockCount: previous.blocks.length,
            }
          : undefined,
      kind: "pi-agent.output-updated",
    },
    {
      changed: ({ item, previous }) =>
        previous.type === "pi-agent" &&
        item.type === "pi-agent" &&
        (previous.status !== item.status ||
          previous.errorMessage !== item.errorMessage ||
          previous.sessionAvailability !== item.sessionAvailability),
      details: ({ item, previous }) =>
        previous.type === "pi-agent" && item.type === "pi-agent"
          ? {
              availability: item.sessionAvailability,
              errorMessage: item.errorMessage,
              previousAvailability: previous.sessionAvailability,
              previousStatus: previous.status,
              status: item.status,
            }
          : undefined,
      kind: "pi-agent.status-changed",
    },
    {
      changed: ({ item, previous }) =>
        fieldChanged(previous, item, "sandbox"),
      details: ({ item }) =>
        item.type === "pi-agent"
          ? {
              diffStatus: item.sandbox?.diffStatus,
              sandboxPath: item.sandbox?.path,
            }
          : undefined,
      kind: "pi-agent.sandbox-updated",
    },
  ],
  diff: [
    {
      changed: ({ item, previous }) =>
        fieldChanged(previous, item, "diffText") ||
        fieldChanged(previous, item, "proposal"),
      details: ({ item }) =>
        item.type === "diff"
          ? {
              editCount: getPatchProposalPaths(item.proposal).length,
              summary: item.summary,
            }
          : undefined,
      kind: "saved-diff.updated",
    },
  ],
  "agent-sandbox-diff": [
    {
      changed: ({ item, previous }) =>
        previous.type === "agent-sandbox-diff" &&
        item.type === "agent-sandbox-diff" &&
        (previous.diffText !== item.diffText || previous.summary !== item.summary),
      details: ({ item }) =>
        item.type === "agent-sandbox-diff"
          ? {
              sourceAgentItemId: item.sourceAgentItemId,
              summary: item.summary,
            }
          : undefined,
      kind: "agent-sandbox-diff.updated",
    },
  ],
} satisfies Record<PersistentContextItem["type"], readonly HistoryRule[]>;

export function getPersistentContextItemHistoryEvents(
  item: PersistentContextItem,
  previous: PersistentContextItem,
): readonly SessionEvent[] {
  const rules = persistentContextItemHistoryRules[item.type];
  const pair = { item, previous };
  const events: SessionEvent[] = [];

  for (const rule of rules) {
    if (!rule.changed(pair)) {
      continue;
    }

    const details = "details" in rule ? rule.details?.(pair) : undefined;
    events.push(
      stateUpdatedEvent({
        ...(details === undefined ? {} : { details }),
        item,
        kind: rule.kind,
      }),
    );
  }

  return events;
}
