import { validatePatchProposal } from "../../lib/patch/patchEngine";
import {
  getPatchProposalFromToolCalls,
  PROPOSE_PATCH_TOOL_NAME,
  proposePatchTool,
} from "../../lib/llm/patchTool";
import type { LlmWorkflowToolController } from "./types";

export const patchWorkflowTool: LlmWorkflowToolController = {
  tool: proposePatchTool,
  async routeToolCall({ root, toolCall }) {
    if (toolCall.name !== PROPOSE_PATCH_TOOL_NAME) {
      return null;
    }

    const proposal = getPatchProposalFromToolCalls([toolCall]);
    if (proposal === null) {
      return null;
    }

    return {
      kind: "patch",
      patch: await validatePatchProposal({ proposal, root }),
    };
  },
};
