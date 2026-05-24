import type { FilePath } from "../../types";

export type PatchEdit = {
  path: FilePath;
  oldText: string;
  newText: string;
};

export type PatchProposal = {
  summary: string;
  edits: PatchEdit[];
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
