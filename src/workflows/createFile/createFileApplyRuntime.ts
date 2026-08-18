import {
  applyCreateFileProposal,
  type CreateFileProposal,
  type CreateFileValidationResult,
} from "../../lib/createFile/createFile";
import { recordSessionRuntimeEvent } from "../../store/appStore";

export async function applyCreateFileProposalWithRuntimeEvents({
  proposal,
  requestId,
  root,
}: {
  proposal: CreateFileProposal;
  requestId?: number;
  root?: string;
}): Promise<CreateFileValidationResult> {
  recordSessionRuntimeEvent({
    kind: "create-file.apply.begin",
    path: proposal.path,
    requestId,
  });

  try {
    const result = await applyCreateFileProposal({ proposal, root });
    recordSessionRuntimeEvent({
      kind: "create-file.apply.end",
      path: proposal.path,
      requestId,
      success: result.status === "valid",
    });
    return result;
  } catch (error) {
    recordSessionRuntimeEvent({
      errorMessage: error instanceof Error ? error.message : String(error),
      kind: "create-file.apply.end",
      path: proposal.path,
      requestId,
      success: false,
    });
    throw error;
  }
}
