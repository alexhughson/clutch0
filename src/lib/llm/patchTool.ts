import { Type, type Tool, type ToolCall } from "@earendil-works/pi-ai";
import { invariant } from "../invariant";
import type { PatchProposal } from "../patch/types";

export const APPLY_PATCH_TOOL_NAME = "apply_patch";

export const applyPatchTool: Tool = {
  name: APPLY_PATCH_TOOL_NAME,
  description:
    "Use a Codex apply_patch patch to edit files. The patch must be complete and ready to apply.",
  parameters: Type.Object({
    input: Type.String({
      description:
        "The complete raw Codex patch body. It must start with *** Begin Patch and end with *** End Patch.",
    }),
  }),
};

export function patchProposalFromToolCall(toolCall: ToolCall): PatchProposal {
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
  arguments_: ToolCall["arguments"],
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
