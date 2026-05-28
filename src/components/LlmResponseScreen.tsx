import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import {
  HighlightedDiff,
  HighlightedMarkdown,
} from "./SyntaxHighlightedContent";
import { applyPatchProposal } from "../lib/patch/patchEngine";
import { useAppStore, type LlmRequestState } from "../store/appStore";

type LlmResponseScreenProps = {
  request: LlmRequestState;
};

type ResponseActions = ReturnType<typeof useAppStore.getState>["actions"];

export function LlmResponseScreen({ request }: LlmResponseScreenProps) {
  const actions = useAppStore((state) => state.actions);

  useKeyboard((event) => {
    handleResponseKey({ actions, event, request });
  });

  return (
    <box
      borderStyle="rounded"
      style={{
        border: true,
        flexDirection: "column",
        gap: 1,
        padding: 1,
        width: "100%",
      }}
    >
      <box
        title="Question"
        borderStyle="rounded"
        style={{ border: true, flexDirection: "column", padding: 1 }}
      >
        <text>{request.question}</text>
      </box>
      {request.patch === undefined ? <TextResponse request={request} /> : null}
      {request.patch === undefined ? null : <PatchReview request={request} />}
    </box>
  );
}

function TextResponse({ request }: { request: LlmRequestState }) {
  return (
    <box
      title={`Response (${formatStatus(request.status)})`}
      bottomTitle={getTextResponseHotkeys(request)}
      bottomTitleAlignment="right"
      borderStyle="rounded"
      style={{ border: true, flexDirection: "column", padding: 1 }}
    >
      {request.responseText.length > 0 ? (
        <scrollbox style={{ height: 36, width: "100%" }}>
          <HighlightedMarkdown
            content={request.responseText}
            streaming={request.status === "loading"}
          />
        </scrollbox>
      ) : (
        <text>
          {request.status === "loading" ? "Waiting for model..." : ""}
        </text>
      )}
      {request.status === "error" ? (
        <text style={{ fg: "red" }}>{request.errorMessage}</text>
      ) : null}
      {request.savedContextItemId === undefined ? null : (
        <text style={{ fg: "green" }}>Saved to context.</text>
      )}
    </box>
  );
}

function PatchReview({ request }: { request: LlmRequestState }) {
  const patch = request.patch;
  if (patch === undefined) {
    return null;
  }

  return (
    <box
      title={`Patch (${formatPatchStatus(patch.applyStatus)})`}
      bottomTitle={getPatchReviewHotkeys(request)}
      bottomTitleAlignment="right"
      borderStyle="rounded"
      style={{ border: true, flexDirection: "column", padding: 1 }}
    >
      <text>{patch.proposal.summary}</text>
      {patch.status === "valid" ? (
        <scrollbox
          style={{
            height: 30,
            width: "100%",
          }}
        >
          <HighlightedDiff diff={patch.diffText} />
        </scrollbox>
      ) : (
        <box style={{ flexDirection: "column" }}>
          <text style={{ fg: "red" }}>Patch could not be applied cleanly:</text>
          {patch.errors.map((error) => (
            <text
              key={`${error.editIndex}:${error.path}`}
              style={{ fg: "red" }}
            >
              {error.path || "<unknown>"}: {error.message}
            </text>
          ))}
        </box>
      )}
      {patch.applyErrorMessage === undefined ? null : (
        <text style={{ fg: "red" }}>{patch.applyErrorMessage}</text>
      )}
      {request.savedContextItemId === undefined ? null : (
        <text style={{ fg: "green" }}>Saved to context.</text>
      )}
    </box>
  );
}

function handleResponseKey({
  actions,
  event,
  request,
}: {
  actions: ResponseActions;
  event: KeyEvent;
  request: LlmRequestState;
}) {
  if (request.patch !== undefined) {
    handlePatchReviewKey({ actions, event, request });
    return;
  }

  handleTextResponseKey({ actions, event, request });
}

function handleTextResponseKey({
  actions,
  event,
  request,
}: {
  actions: ResponseActions;
  event: KeyEvent;
  request: LlmRequestState;
}) {
  if (
    (request.status === "loading" || request.status === "streaming") &&
    event.name === "s"
  ) {
    event.preventDefault();
    event.stopPropagation();
    actions.response.saveTextToContext({ requestId: request.id });
    return;
  }

  if (request.status === "loading" || request.status === "streaming") {
    return;
  }

  if (request.status === "done" && event.name === "s") {
    event.preventDefault();
    event.stopPropagation();
    actions.response.saveTextToContext({ requestId: request.id });
    return;
  }

  if (event.name === "escape") {
    event.preventDefault();
    event.stopPropagation();
    actions.navigation.showComposer();
    return;
  }

  if (isEnterKey(event.name)) {
    event.preventDefault();
    event.stopPropagation();
    actions.navigation.clearResponseAndMessage();
  }
}

function handlePatchReviewKey({
  actions,
  event,
  request,
}: {
  actions: ResponseActions;
  event: KeyEvent;
  request: LlmRequestState;
}) {
  const patch = request.patch;
  if (patch === undefined || request.status !== "done") {
    return;
  }

  if (patch.applyStatus === "applying" || patch.applyStatus === "applied") {
    return;
  }

  if (patch.status === "valid" && event.name === "a") {
    event.preventDefault();
    event.stopPropagation();
    void applyPatch(request, actions.response);
    return;
  }

  if (
    patch.status === "valid" &&
    request.savedContextItemId === undefined &&
    event.name === "s"
  ) {
    event.preventDefault();
    event.stopPropagation();
    actions.response.saveDiffToContext({ requestId: request.id });
    return;
  }

  if (event.name === "e") {
    event.preventDefault();
    event.stopPropagation();
    actions.navigation.showComposer();
    return;
  }

  if (event.name === "escape") {
    event.preventDefault();
    event.stopPropagation();
    actions.navigation.rejectResponse();
  }
}

function getTextResponseHotkeys(request: LlmRequestState): string | undefined {
  if (request.status === "loading" || request.status === "streaming") {
    return request.savedContextItemId === undefined
      ? "s save to context"
      : undefined;
  }

  if (request.status === "error") {
    return "Enter clear · Esc return";
  }

  return request.savedContextItemId === undefined
    ? "s save to context · Enter clear · Esc return"
    : "Enter clear · Esc return";
}

function getPatchReviewHotkeys(request: LlmRequestState): string | undefined {
  const patch = request.patch;
  if (
    patch === undefined ||
    request.status !== "done" ||
    patch.applyStatus === "applying" ||
    patch.applyStatus === "applied"
  ) {
    return undefined;
  }

  if (patch.status !== "valid") {
    return "e edit message · Esc reject";
  }

  return [
    patch.applyStatus === "apply-error" ? "a retry apply" : "a apply",
    request.savedContextItemId === undefined ? "s save diff to context" : null,
    "e edit message",
    "Esc reject",
  ]
    .filter((item): item is string => item !== null)
    .join(" · ");
}

function formatStatus(status: string): string {
  if (status === "done") {
    return "complete";
  }

  return status;
}

function formatPatchStatus(status: string): string {
  if (status === "apply-error") {
    return "apply error";
  }

  return status;
}

async function applyPatch(
  request: LlmRequestState,
  responseActions: ResponseActions["response"],
) {
  if (
    request.patch === undefined ||
    request.patch.status !== "valid" ||
    request.patch.applyStatus === "applying" ||
    request.patch.applyStatus === "applied"
  ) {
    return;
  }

  responseActions.startPatchApply({ requestId: request.id });

  try {
    const result = await applyPatchProposal({
      proposal: request.patch.proposal,
    });

    if (result.status === "invalid") {
      responseActions.failPatchApply({
        errorMessage: result.errors
          .map((error) => `${error.path || "<unknown>"}: ${error.message}`)
          .join("\n"),
        requestId: request.id,
      });
      return;
    }

    responseActions.finishPatchApply({ requestId: request.id });
  } catch (error) {
    responseActions.failPatchApply({
      errorMessage: error instanceof Error ? error.message : String(error),
      requestId: request.id,
    });
  }
}

function isEnterKey(keyName: string): boolean {
  return (
    keyName === "return" || keyName === "kpenter" || keyName === "linefeed"
  );
}
