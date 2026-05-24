import { Type, type Tool, type ToolCall } from "@earendil-works/pi-ai";
import type { PatchProposal } from "../patch/types";

export const PROPOSE_PATCH_TOOL_NAME = "propose_patch";

export const proposePatchTool: Tool = {
  name: PROPOSE_PATCH_TOOL_NAME,
  description:
    "Propose exact file edits for the user to review. This only proposes a patch; it does not apply changes.",
  parameters: Type.Object({
    summary: Type.String({
      description: "A concise summary of the proposed code changes.",
    }),
    edits: Type.Array(
      Type.Object({
        path: Type.String({
          description:
            "Path to the file to edit, relative to the working directory.",
        }),
        oldText: Type.String({
          description:
            "Exact existing text to replace. Must match the current file exactly and uniquely. Use an empty string only to create a new file.",
        }),
        newText: Type.String({
          description:
            "Replacement text for oldText, or full file contents for a new file.",
        }),
      }),
      { description: "One or more exact search/replace edits." },
    ),
  }),
};

export function getPatchProposalFromToolCalls(
  toolCalls: readonly ToolCall[],
): PatchProposal | null {
  const toolCall = toolCalls.find(
    (call) => call.name === PROPOSE_PATCH_TOOL_NAME,
  );
  if (toolCall === undefined) {
    return null;
  }

  return normalizePatchProposal(toolCall.arguments);
}

function normalizePatchProposal(
  arguments_: Record<string, unknown>,
): PatchProposal {
  const summary =
    typeof arguments_.summary === "string"
      ? arguments_.summary
      : "Proposed changes";
  const rawEdits = Array.isArray(arguments_.edits) ? arguments_.edits : [];

  return {
    summary,
    edits: rawEdits
      .filter(
        (edit): edit is Record<string, unknown> =>
          typeof edit === "object" && edit !== null,
      )
      .map((edit) => ({
        path: typeof edit.path === "string" ? edit.path : "",
        oldText: typeof edit.oldText === "string" ? edit.oldText : "",
        newText: typeof edit.newText === "string" ? edit.newText : "",
      })),
  };
}
