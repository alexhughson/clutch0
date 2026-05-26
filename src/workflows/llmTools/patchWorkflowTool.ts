import { validatePatchProposal } from "../../lib/patch/patchEngine";
import {
  getPatchProposalFromToolCalls,
  PROPOSE_PATCH_TOOL_NAME,
  proposePatchTool,
} from "../../lib/llm/patchTool";
import type { LlmWorkflowToolController } from "./types";

export const patchWorkflowTool: LlmWorkflowToolController = {
  slashCommand: {
    description: "Ask the LLM to propose a code edit using the patch workflow.",
    name: "edit",
    promptDirective:
      "The user invoked /edit. Use the propose_patch tool to propose code edits if the request is actionable with the available context. If more context is needed, explain what is missing.",
    title: "Edit code",
  },
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
