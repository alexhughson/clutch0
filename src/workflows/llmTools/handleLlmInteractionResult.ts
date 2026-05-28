import type { AppActions } from "../../app/appTypes";
import type { StreamLlmInteractionResult } from "../../lib/llm/streamResponse";

type LlmInteractionResultHandler = {
  kind: StreamLlmInteractionResult["kind"];
  handle: (options: {
    actions: AppActions;
    requestId: number;
    result: StreamLlmInteractionResult;
  }) => void;
};

const llmInteractionResultHandlers: LlmInteractionResultHandler[] = [
  {
    kind: "text",
    handle: ({ actions, requestId, result }) => {
      actions.response.finish({
        requestId,
        responseKind: "text",
        responseText: result.responseText,
      });
    },
  },
  {
    kind: "patch",
    handle: ({ actions, requestId, result }) => {
      if (result.kind !== "patch") {
        return;
      }

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
  },
  {
    kind: "find-files",
    handle: ({ actions, result }) => {
      if (result.kind !== "find-files") {
        return;
      }

      actions.findFiles.showSearch({
        goal: result.goal,
        hints: result.hints,
      });
    },
  },
  {
    kind: "create-file",
    handle: ({ actions, requestId, result }) => {
      if (result.kind !== "create-file") {
        return;
      }

      actions.createFile.showReview({
        requestId,
        validation: result.validation,
      });
    },
  },
];

export function handleLlmInteractionResult({
  actions,
  requestId,
  result,
}: {
  actions: AppActions;
  requestId: number;
  result: StreamLlmInteractionResult;
}) {
  const handler = llmInteractionResultHandlers.find(
    (candidate) => candidate.kind === result.kind,
  );
  handler?.handle({ actions, requestId, result });
}
