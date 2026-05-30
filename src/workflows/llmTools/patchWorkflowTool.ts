import { invariant } from "../../lib/invariant";
import { editCommandPromptDirective } from "../../lib/llm/prompts";
import {
  patchProposalFromToolCall,
  PROPOSE_PATCH_TOOL_NAME,
  proposePatchTool,
} from "../../lib/llm/patchTool";
import { validatePatchProposal } from "../../lib/patch/patchEngine";
import type { LlmWorkflowToolController } from "./types";

export const patchWorkflowTool: LlmWorkflowToolController = {
  resultKind: "patch",
  slashCommand: {
    description: "Ask the LLM to propose a code edit using the patch workflow.",
    name: "edit",
    promptDirective: editCommandPromptDirective,
    title: "Edit code",
  },
  tool: proposePatchTool,
  handleResult({ actions, requestId, result }) {
    invariant(
      result.kind === "patch",
      `propose_patch cannot handle ${result.kind} results`,
    );

    actions.response.finish({
      requestId,
      responseKind: "patch",
      responseText: result.responseText,
    });
    actions.response.setPatch({
      patch: { ...result.patch, applyStatus: "pending" },
      requestId,
    });
  },
  async routeToolCall({ root, toolCall }) {
    invariant(
      toolCall.name === PROPOSE_PATCH_TOOL_NAME,
      `propose_patch routed unexpected tool ${toolCall.name}`,
    );

    const proposal = patchProposalFromToolCall(toolCall);
    return {
      kind: "patch",
      patch: await validatePatchProposal({ proposal, root }),
    };
  },
};
