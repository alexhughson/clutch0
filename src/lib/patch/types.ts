import type { FilePath } from "../../types";

export type PatchProposal = {
  patch: string;
  summary: string;
  toolCallId?: string;
};

export type PatchFileChange =
  | {
      content: string;
      type: "add";
    }
  | {
      content: string;
      type: "delete";
    }
  | {
      move_path?: FilePath;
      type: "update";
      unified_diff: string;
    };

export type PatchFileChangeMap = Record<FilePath, PatchFileChange>;

export type PatchAffectedPaths = {
  added: FilePath[];
  deleted: FilePath[];
  modified: FilePath[];
};

export type PatchValidationError = {
  editIndex: number;
  message: string;
  path: FilePath;
};

export type PatchValidationResult =
  | {
      diffText: string;
      proposal: PatchProposal;
      status: "valid";
    }
  | {
      errors: PatchValidationError[];
      proposal: PatchProposal;
      status: "invalid";
    };

export type PatchReviewState = PatchValidationResult & {
  applyErrorMessage?: string;
  applyStatus: "pending" | "applying" | "applied" | "rejected" | "apply-error";
};

export type PatchProgressFile = {
  movePath?: FilePath;
  operation: "add" | "delete" | "update";
  path: FilePath;
};

export type PatchProgressState = {
  files: PatchProgressFile[];
  patchCharacterCount: number;
};
