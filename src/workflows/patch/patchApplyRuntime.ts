import {
  applyPatchProposal,
  getPatchProposalAffectedPaths,
  getPatchProposalFileChanges,
} from "../../lib/patch/patchEngine";
import {
  buildFailedPatchToolOutput,
  buildPatchValidationFailureToolOutput,
  buildSuccessfulPatchToolOutput,
  type PatchToolOutput,
} from "../../lib/patch/patchToolOutput";
import type {
  PatchFileChangeMap,
  PatchProposal,
  PatchValidationResult,
} from "../../lib/patch/types";
import { recordSessionRuntimeEvent } from "../../store/appStore";

export type PatchApplyRuntimeResult = PatchValidationResult & {
  toolOutput: PatchToolOutput;
};

export async function applyPatchProposalWithRuntimeEvents({
  contextItemId,
  proposal,
  requestId,
  root,
}: {
  contextItemId?: string;
  proposal: PatchProposal;
  requestId?: number;
  root?: string;
}): Promise<PatchApplyRuntimeResult> {
  const startedAt = Date.now();
  const callId =
    proposal.toolCallId ??
    fallbackPatchCallId({
      contextItemId,
      requestId,
    });
  const changes = getPatchProposalFileChanges(proposal);
  const affectedPaths = getPatchProposalAffectedPaths(proposal);

  recordPatchApplyBegin({
    callId,
    changes,
    contextItemId,
    requestId,
  });

  try {
    const result = await applyPatchProposal({ proposal, root });
    if (result.status === "valid") {
      const toolOutput = buildSuccessfulPatchToolOutput({
        affectedPaths,
        changes,
        durationMs: Date.now() - startedAt,
      });
      recordPatchApplyEnd({
        callId,
        changes,
        contextItemId,
        requestId,
        status: "completed",
        toolOutput,
      });
      return { ...result, toolOutput };
    }

    const toolOutput = buildPatchValidationFailureToolOutput({
      result,
    });
    recordPatchApplyEnd({
      callId,
      changes,
      contextItemId,
      requestId,
      status: "failed",
      toolOutput,
    });
    return { ...result, toolOutput };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const toolOutput = buildFailedPatchToolOutput({
      errorMessage,
    });
    recordPatchApplyEnd({
      callId,
      changes,
      contextItemId,
      requestId,
      status: "failed",
      toolOutput,
    });
    return {
      errors: [
        {
          editIndex: 0,
          message: errorMessage,
        },
      ],
      proposal,
      status: "invalid",
      toolOutput,
    };
  }
}

function recordPatchApplyBegin({
  callId,
  changes,
  contextItemId,
  requestId,
}: {
  callId: string;
  changes: PatchFileChangeMap;
  contextItemId?: string;
  requestId?: number;
}) {
  recordSessionRuntimeEvent({
    auto_approved: false,
    call_id: callId,
    changes,
    contextItemId,
    kind: "patch-apply.begin",
    requestId,
  });
}

function recordPatchApplyEnd({
  callId,
  changes,
  contextItemId,
  requestId,
  status,
  toolOutput,
}: {
  callId: string;
  changes: PatchFileChangeMap;
  contextItemId?: string;
  requestId?: number;
  status: "completed" | "failed";
  toolOutput: PatchToolOutput;
}) {
  recordSessionRuntimeEvent({
    call_id: callId,
    changes,
    contextItemId,
    kind: "patch-apply.end",
    requestId,
    status,
    stderr: toolOutput.stderr,
    stdout: toolOutput.stdout,
    success: toolOutput.success,
    toolOutput: {
      content: toolOutput.content,
      success: toolOutput.success,
    },
  });
}

function fallbackPatchCallId({
  contextItemId,
  requestId,
}: {
  contextItemId?: string;
  requestId?: number;
}): string {
  if (requestId !== undefined) {
    return `request:${requestId}:apply_patch`;
  }
  if (contextItemId !== undefined) {
    return `context:${contextItemId}:apply_patch`;
  }

  return "apply_patch";
}
