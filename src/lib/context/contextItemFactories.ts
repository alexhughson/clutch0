import type { AgentAskMode } from "../../types";
import type { PatchProposal } from "../patch/types";
import type { ShellCommandResult } from "../shell/shellCommand";
import type { FilePath } from "../../types";
import type {
  AutomaticContextItem,
  ContextItem,
  FileContextItem,
  LiveLlmResponseContextItem,
  PersistentContextItem,
  PiAgentContextItem,
  SavedAgentSandboxDiffContextItem,
  SavedDiffContextItem,
  SavedLlmResponseContextItem,
  ShellCommandOutputContextItem,
  UserTextContextItem,
} from "./contextItemTypes";
import { MISSING_SUMMARY_STATE } from "./contextItemTypes";

export {
  MAX_CONTEXT_ITEM_DETAIL_CHARACTERS,
  MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS,
  MAX_FILE_CONTEXT_CHARACTERS,
  MAX_SAVED_CONTEXT_CHARACTERS,
  MAX_TOTAL_FILE_CONTEXT_CHARACTERS,
} from "./contextItemFormatting";

export function getFileContextItemId(filePath: FilePath): string {
  return `file:${filePath}`;
}

export function createFileContextItem(filePath: FilePath): FileContextItem {
  return {
    filePath,
    id: getFileContextItemId(filePath),
    schemaVersion: 1,
    summaryState: MISSING_SUMMARY_STATE,
    type: "file",
  };
}

export function createLiveLlmResponseContextItem({
  createdAt,
  id,
  output = "",
  prompt,
  sourceRequestId,
}: {
  createdAt: number;
  id: string;
  output?: string;
  prompt: string;
  sourceRequestId: number;
}): LiveLlmResponseContextItem {
  return {
    createdAt,
    id,
    output,
    prompt,
    schemaVersion: 1,
    sourceRequestId,
    status: "running",
    summaryState: MISSING_SUMMARY_STATE,
    type: "llm-response-live",
  };
}

export function createPiAgentContextItem({
  createdAt,
  id,
  mode = "ask",
  prompt,
}: {
  createdAt: number;
  id: string;
  mode?: AgentAskMode;
  prompt: string;
}): PiAgentContextItem {
  return {
    blocks: [],
    createdAt,
    id,
    mode,
    prompt,
    schemaVersion: 1,
    sessionAvailability: "live",
    status: "running",
    summaryState: MISSING_SUMMARY_STATE,
    type: "pi-agent",
  };
}

export function createSavedLlmResponseContextItem({
  createdAt,
  id,
  output,
  prompt,
  sourceRequestId,
}: {
  createdAt: number;
  id: string;
  output: string;
  prompt: string;
  sourceRequestId: number;
}): SavedLlmResponseContextItem {
  return {
    createdAt,
    id,
    output,
    prompt,
    schemaVersion: 1,
    sourceRequestId,
    summaryState: MISSING_SUMMARY_STATE,
    type: "llm-response",
  };
}

export function createShellCommandOutputContextItem({
  createdAt,
  id,
  result,
  sourceRequestId,
}: {
  createdAt: number;
  id: string;
  result: ShellCommandResult;
  sourceRequestId: number;
}): ShellCommandOutputContextItem {
  return {
    createdAt,
    id,
    result,
    schemaVersion: 1,
    sourceRequestId,
    summaryState: MISSING_SUMMARY_STATE,
    type: "shell-command-output",
  };
}

export function createUserTextContextItem({
  createdAt,
  id,
  text,
}: {
  createdAt: number;
  id: string;
  text: string;
}): UserTextContextItem {
  return {
    createdAt,
    id,
    schemaVersion: 1,
    summaryState: MISSING_SUMMARY_STATE,
    text,
    type: "user-text",
  };
}

export function createSavedDiffContextItem({
  createdAt,
  diffText,
  id,
  prompt,
  proposal,
  sourceRequestId,
  summary,
}: {
  createdAt: number;
  diffText: string;
  id: string;
  prompt: string;
  proposal: PatchProposal;
  sourceRequestId: number;
  summary: string;
}): SavedDiffContextItem {
  return {
    createdAt,
    diffText,
    id,
    prompt,
    proposal,
    schemaVersion: 1,
    sourceRequestId,
    summary,
    summaryState: MISSING_SUMMARY_STATE,
    type: "diff",
  };
}

export function createSavedAgentSandboxDiffContextItem({
  createdAt,
  diffText,
  id,
  prompt,
  sourceAgentItemId,
  summary,
}: {
  createdAt: number;
  diffText: string;
  id: string;
  prompt: string;
  sourceAgentItemId: string;
  summary: string;
}): SavedAgentSandboxDiffContextItem {
  return {
    createdAt,
    diffText,
    id,
    prompt,
    schemaVersion: 1,
    sourceAgentItemId,
    summary,
    summaryState: MISSING_SUMMARY_STATE,
    type: "agent-sandbox-diff",
  };
}

export function isAutomaticContextItem(
  item: ContextItem,
): item is AutomaticContextItem {
  return (
    item.type === "file" ||
    item.type === "automatic-unstaged-changes" ||
    item.type === "automatic-file-list"
  );
}

export function isPersistentContextItem(
  item: ContextItem,
): item is PersistentContextItem {
  return (
    item.type !== "automatic-unstaged-changes" &&
    item.type !== "automatic-file-list"
  );
}

export function getSelectedFilePaths(
  contextItems: readonly ContextItem[],
): FilePath[] {
  return contextItems
    .filter((item): item is FileContextItem => item.type === "file")
    .map((item) => item.filePath);
}

export function hasContextItem(
  contextItems: readonly ContextItem[],
  itemId: string,
): boolean {
  return contextItems.some((item) => item.id === itemId);
}

export function getContextItemById(
  contextItems: readonly ContextItem[],
  itemId: string | null,
): ContextItem | null {
  return contextItems.find((item) => item.id === itemId) ?? null;
}

export type { AutomaticContextItem };
