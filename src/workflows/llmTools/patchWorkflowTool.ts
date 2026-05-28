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
      "The user invoked /edit. If the request is actionable with the available context, you must call the propose_patch tool with exact edits. Do not answer with a prose-only implementation plan when you can produce a patch. If more context is needed, briefly explain what is missing instead of calling the tool.",
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
