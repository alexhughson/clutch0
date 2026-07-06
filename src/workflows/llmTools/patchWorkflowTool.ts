import { invariant } from "../../lib/invariant";
import { editCommandPromptDirective } from "../../lib/llm/prompts";
import {
  APPLY_PATCH_TOOL_NAME,
  applyPatchTool,
  patchProposalFromToolCall,
} from "../../lib/llm/patchTool";
import { validatePatchProposal } from "../../lib/patch/patchEngine";
import type { LlmWorkflowToolController } from "./types";

export const patchWorkflowTool: LlmWorkflowToolController = {
  resultKind: "patch",
  slashCommand: {
    description: "Ask the LLM to propose a code edit using the patch workflow.",
    name: "edit",
    patchToolMode: "review",
    promptDirective: editCommandPromptDirective,
    title: "Edit code",
  },
  tool: applyPatchTool,
  handleResult({ actions, requestId, result }) {
    invariant(
      result.kind === "patch",
      `apply_patch cannot handle ${result.kind} results`,
    );

    actions.response.finish({
      requestId,
      responseKind: "patch",
      responseText: result.responseText,
    });
    actions.response.setPatch({
      patch: {
        ...result.patch,
        applyStatus: result.applyStatus ?? "pending",
      },
      requestId,
    });
  },
  async routeToolCall({ root, toolCall }) {
    invariant(
      toolCall.name === APPLY_PATCH_TOOL_NAME,
      `apply_patch routed unexpected tool ${toolCall.name}`,
    );

    const proposal = patchProposalFromToolCall(toolCall);
    return {
      kind: "patch",
      patch: await validatePatchProposal({ proposal, root }),
    };
  },
};
