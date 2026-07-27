import { invariant } from "../invariant";
import type { PatchProposal } from "../patch/types";
import type { LlmTool, LlmToolCall } from "./types";

export const APPLY_PATCH_TOOL_NAME = "apply_patch";

export const applyPatchTool: LlmTool = {
  name: APPLY_PATCH_TOOL_NAME,
  description:
    "Edit files with one complete Codex apply_patch patch.",
  parameters: {
    type: "object",
    properties: {
      input: {
        type: "string",
        description:
          "Raw patch body from *** Begin Patch through *** End Patch.",
      },
    },
    required: ["input"],
  },
};

export function patchProposalFromToolCall(toolCall: LlmToolCall): PatchProposal {
  invariant(
    toolCall.name === APPLY_PATCH_TOOL_NAME,
    `apply_patch received unexpected tool ${toolCall.name}`,
  );

  const arguments_ = toolCall.arguments;
  const patch = patchInputFromToolArguments(arguments_);
  const summary =
    typeof arguments_.summary === "string" ? arguments_.summary : "Apply patch";

  return {
    patch,
    summary,
    toolCallId: toolCall.id.split("|")[0] ?? toolCall.id,
  };
}

export function patchInputFromToolArguments(
  arguments_: LlmToolCall["arguments"],
): string {
  if (typeof arguments_.input === "string") {
    return arguments_.input;
  }
  if (typeof arguments_.patch === "string") {
    return arguments_.patch;
  }

  invariant(
    false,
    "apply_patch.input must be a string. Legacy apply_patch.patch is still accepted for saved responses.",
  );
}
