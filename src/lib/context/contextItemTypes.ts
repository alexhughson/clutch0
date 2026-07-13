import type {
  FileContextItemState,
  LiveLlmResponseContextItemState,
  PiAgentContextItemState,
  SavedAgentSandboxDiffContextItemState,
  SavedDiffContextItemState,
  SavedLlmResponseContextItemState,
  ShellCommandOutputContextItemState,
  UserTextContextItemState,
} from "./contextItemSchemas";
import type { ContextItemSummaryState, FilePath } from "../../types";

export type {
  FileContextItemState,
  LiveLlmResponseContextItemState,
  PiAgentContextItemState,
  SavedAgentSandboxDiffContextItemState,
  SavedDiffContextItemState,
  SavedLlmResponseContextItemState,
  ShellCommandOutputContextItemState,
  UserTextContextItemState,
} from "./contextItemSchemas";

export type { ContextItemSummaryState } from "../../types";

export const MISSING_SUMMARY_STATE: ContextItemSummaryState = {
  status: "missing",
};

export type PiAgentSessionAvailability = "detached" | "live";

export type FileContextItem = FileContextItemState;
export type SavedLlmResponseContextItem = SavedLlmResponseContextItemState;
export type ShellCommandOutputContextItem = ShellCommandOutputContextItemState;
export type UserTextContextItem = UserTextContextItemState;
export type LiveLlmResponseContextItem = LiveLlmResponseContextItemState;
export type PiAgentContextItem = PiAgentContextItemState;
export type SavedDiffContextItem = SavedDiffContextItemState;
export type SavedAgentSandboxDiffContextItem =
  SavedAgentSandboxDiffContextItemState;

type AutomaticContextItemBase<Type extends string> = {
  readonly id: string;
  readonly summaryState: ContextItemSummaryState;
  readonly type: Type;
};

export type AutomaticUnstagedChangesContextItem =
  AutomaticContextItemBase<"automatic-unstaged-changes">;

export type AutomaticFileListContextItem =
  AutomaticContextItemBase<"automatic-file-list">;

export type PersistentContextItem =
  | FileContextItem
  | LiveLlmResponseContextItem
  | PiAgentContextItem
  | SavedAgentSandboxDiffContextItem
  | SavedDiffContextItem
  | SavedLlmResponseContextItem
  | ShellCommandOutputContextItem
  | UserTextContextItem;

export type AutomaticContextItem =
  | FileContextItem
  | AutomaticUnstagedChangesContextItem
  | AutomaticFileListContextItem;

export type ContextItem =
  | FileContextItem
  | SavedLlmResponseContextItem
  | ShellCommandOutputContextItem
  | UserTextContextItem
  | LiveLlmResponseContextItem
  | PiAgentContextItem
  | SavedDiffContextItem
  | SavedAgentSandboxDiffContextItem
  | AutomaticUnstagedChangesContextItem
  | AutomaticFileListContextItem;

export type { FilePath };
