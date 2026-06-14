import { Type, type Tool, type ToolCall } from "@earendil-works/pi-ai";
import { invariant } from "../invariant";
import type { PatchProposal } from "../patch/types";

export const PROPOSE_PATCH_TOOL_NAME = "propose_patch";

export const proposePatchTool: Tool = {
  name: PROPOSE_PATCH_TOOL_NAME,
  description:
    "Propose exact, path-scoped file edits for the user to review. This only proposes a patch; it does not apply changes. Call this as a tool; do not print its JSON arguments as assistant text.",
  parameters: Type.Object({
    summary: Type.String({
      description: "A concise summary of the proposed code changes.",
    }),
    edits: Type.Array(
      Type.Object({
        path: Type.String({
          description:
            "Path to edit, relative to the working directory. Use only focused, explicitly requested, or necessary files.",
        }),
        oldText: Type.String({
          description:
            "Exact existing text copied from this file, with unchanged indentation. It must match once; prefer the enclosing block for small one-line changes or repeated snippets. Empty only for a new file.",
        }),
        newText: Type.String({
          description:
            "Replacement text for oldText, or full file contents for a new file. Must be a string, including for multiline code or Markdown; do not use arrays or objects.",
        }),
      }),
      {
        description:
          "One or more exact search/replace edit objects. Every item must be an object, not a JSON string or placeholder; do not include comments, prose, or extra keys.",
      },
    ),
  }),
};

export function patchProposalFromToolCall(toolCall: ToolCall): PatchProposal {
  invariant(
    toolCall.name === PROPOSE_PATCH_TOOL_NAME,
    `propose_patch received unexpected tool ${toolCall.name}`,
  );

  const arguments_ = toolCall.arguments;
  invariant(
    typeof arguments_.summary === "string",
    "propose_patch.summary must be a string.",
  );
  invariant(
    Array.isArray(arguments_.edits),
    "propose_patch.edits must be an array.",
  );

  return {
    summary: arguments_.summary,
    edits: arguments_.edits.map((edit, index) => {
      invariant(
        typeof edit === "object" && edit !== null,
        `propose_patch.edits[${index}] must be an object.`,
      );
      invariant(
        typeof edit.path === "string",
        `propose_patch.edits[${index}].path must be a string.`,
      );
      invariant(
        typeof edit.oldText === "string",
        `propose_patch.edits[${index}].oldText must be a string.`,
      );
      invariant(
        typeof edit.newText === "string",
        `propose_patch.edits[${index}].newText must be a string.`,
      );

      return {
        path: edit.path,
        oldText: edit.oldText,
        newText: edit.newText,
      };
    }),
  };
}
