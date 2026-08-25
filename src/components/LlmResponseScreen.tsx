import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import {
  LlmTextResponseContent,
  formatOptionalLatency,
} from "./LlmTextResponseContent";
import { HighlightedCode, HighlightedDiff } from "./SyntaxHighlightedContent";
import { isEnterKey } from "../lib/keymap";
import type { PatchProgressFile, PatchProgressState } from "../lib/patch/types";
import { useAppStore, type LlmRequestState } from "../store/appStore";
import { applyPatchProposalWithRuntimeEvents } from "../workflows/patch/patchApplyRuntime";

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
      style={{
        flexDirection: "column",
        flexGrow: 1,
        gap: 1,
        height: "100%",
        padding: 1,
        width: "100%",
      }}
    >
      <text
        style={{ fg: "gray" }}
      >{`Question · ${formatStatus(request.status)}`}</text>
      <text>{request.question}</text>
      <LatencyStats stats={request.latencyStats} />
      {request.patch === undefined && request.patchProgress !== undefined ? (
        <PatchProgress progress={request.patchProgress} />
      ) : null}
      {request.patch === undefined ? <TextResponse request={request} /> : null}
      {request.patch === undefined ? null : <PatchReview request={request} />}
    </box>
  );
}

function LatencyStats({ stats }: { stats?: LlmRequestState["latencyStats"] }) {
  if (stats === undefined) {
    return null;
  }

  return (
    <text style={{ fg: "gray" }}>{`Latency · TTFT ${formatOptionalLatency(
      stats.ttftMs,
      "n/a",
    )} · total ${formatOptionalLatency(stats.totalMs, "pending")}`}</text>
  );
}

function PatchProgress({ progress }: { progress: PatchProgressState }) {
  return (
    <box
      style={{
        flexDirection: "column",
        gap: 0,
        paddingLeft: 1,
        width: "100%",
      }}
    >
      <text style={{ fg: "gray" }}>
        {`Patch draft · ${progress.files.length} ${pluralize("file", progress.files.length)} · ${progress.patchCharacterCount} chars`}
      </text>
      {progress.files.map((file) => (
        <text key={`${file.operation}:${file.path}`} style={{ fg: "gray" }}>
          {formatPatchProgressFile(file)}
        </text>
      ))}
    </box>
  );
}

function TextResponse({ request }: { request: LlmRequestState }) {
  return (
    <LlmTextResponseContent
      errorMessage={
        request.status === "error" ? request.errorMessage : undefined
      }
      hotkeys={getTextResponseHotkeys(request)}
      responseText={request.responseText}
      savedToContext={request.savedContextItemId !== undefined}
      status={request.status}
      streaming={request.status === "loading" || request.status === "streaming"}
    />
  );
}

function PatchReview({ request }: { request: LlmRequestState }) {
  const patch = request.patch;
  if (patch === undefined) {
    return null;
  }

  return (
    <box
      style={{
        flexDirection: "column",
        flexGrow: 1,
        gap: 1,
        minHeight: 1,
        width: "100%",
      }}
    >
      <text style={{ fg: "gray" }}>{getPatchReviewHeading(patch)}</text>
      <text>{patch.proposal.summary}</text>
      {patch.status === "valid" ? (
        <scrollbox
          style={{
            flexGrow: 1,
            height: "100%",
            width: "100%",
          }}
        >
          <HighlightedDiff diff={patch.diffText} />
        </scrollbox>
      ) : (
        <scrollbox
          style={{
            flexGrow: 1,
            height: "100%",
            width: "100%",
          }}
        >
          <box style={{ flexDirection: "column", gap: 1, width: "100%" }}>
            <box style={{ flexDirection: "column" }}>
              <text style={{ fg: "red" }}>{getPatchErrorHeading(patch)}</text>
              {patch.errors.map((error) => (
                <text
                  key={`${error.editIndex}:${error.path}`}
                  style={{ fg: "red" }}
                >
                  {error.path || "<unknown>"}: {error.message}
                </text>
              ))}
            </box>
            <box style={{ flexDirection: "column", width: "100%" }}>
              <text style={{ fg: "gray" }}>Patch debug</text>
              <HighlightedCode
                content={getInvalidPatchDebugText(request) ?? ""}
                filetype="text"
              />
            </box>
          </box>
        </scrollbox>
      )}
      {patch.applyErrorMessage === undefined ? null : (
        <text style={{ fg: "red" }}>{patch.applyErrorMessage}</text>
      )}
      {request.savedContextItemId === undefined ? null : (
        <text style={{ fg: "green" }}>Saved to context.</text>
      )}
      <ResponseHotkeys hotkeys={getPatchReviewHotkeys(request)} />
    </box>
  );
}

function ResponseHotkeys({ hotkeys }: { hotkeys: string | undefined }) {
  if (hotkeys === undefined) {
    return null;
  }

  return <text style={{ fg: "gray" }}>{hotkeys}</text>;
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
    request.autoSaveTextToContext !== true &&
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

  if (
    request.autoSaveTextToContext !== true &&
    request.status === "done" &&
    event.name === "s"
  ) {
    event.preventDefault();
    event.stopPropagation();
    actions.response.saveTextToContext({ requestId: request.id });
    return;
  }

  if (event.name === "escape") {
    event.preventDefault();
    event.stopPropagation();
    actions.navigation.rejectToEdit();
    return;
  }

  if (isEnterKey(event.name)) {
    event.preventDefault();
    event.stopPropagation();
    actions.navigation.acceptAndClose();
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

  if (patch.applyStatus === "applying") {
    return;
  }

  if (patch.applyStatus === "applied") {
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

    if (event.name === "escape" || isEnterKey(event.name)) {
      event.preventDefault();
      event.stopPropagation();
      actions.navigation.acceptAndClose();
    }
    return;
  }

  if (
    patch.status === "valid" &&
    (event.name === "a" || isEnterKey(event.name))
  ) {
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
    actions.navigation.rejectToEdit();
    return;
  }

  if (event.name === "escape") {
    event.preventDefault();
    event.stopPropagation();
    actions.navigation.rejectToEdit();
  }
}

function getTextResponseHotkeys(request: LlmRequestState): string | undefined {
  if (request.status === "loading" || request.status === "streaming") {
    return request.autoSaveTextToContext === true ||
      request.savedContextItemId !== undefined
      ? undefined
      : "s save to context";
  }

  if (request.status === "error") {
    return "Enter clear · Esc edit prompt";
  }

  return request.autoSaveTextToContext === true ||
    request.savedContextItemId !== undefined
    ? "Enter clear · Esc edit prompt"
    : "s save to context · Enter clear · Esc edit prompt";
}

export function getPatchReviewHotkeys(
  request: LlmRequestState,
): string | undefined {
  const patch = request.patch;
  if (
    patch === undefined ||
    request.status !== "done" ||
    patch.applyStatus === "applying"
  ) {
    return undefined;
  }

  if (patch.applyStatus === "applied") {
    return [
      request.savedContextItemId === undefined
        ? "s save diff to context"
        : null,
      "Enter clear",
      "Esc close",
    ]
      .filter((item): item is string => item !== null)
      .join(" · ");
  }

  if (patch.status !== "valid") {
    return "e/Esc edit prompt";
  }

  return [
    patch.applyStatus === "apply-error"
      ? "Enter/a retry apply"
      : "Enter/a apply",
    request.savedContextItemId === undefined ? "s save diff to context" : null,
    "e edit prompt",
    "Esc edit prompt",
  ]
    .filter((item): item is string => item !== null)
    .join(" · ");
}

export function getPatchReviewHeading(
  patch: NonNullable<LlmRequestState["patch"]>,
): string {
  if (patch.status === "invalid") {
    return "Patch · invalid draft";
  }

  return `Patch · ${formatPatchStatus(patch.applyStatus)}`;
}

export function getPatchErrorHeading(
  patch: NonNullable<LlmRequestState["patch"]>,
): string {
  return patch.status === "invalid"
    ? "Patch draft could not be validated:"
    : "Patch could not be applied cleanly:";
}

export function getInvalidPatchDebugText(
  request: LlmRequestState,
): string | undefined {
  const patch = request.patch;
  if (patch === undefined || patch.status !== "invalid") {
    return undefined;
  }

  return [
    "Question:",
    request.question,
    "",
    "Patch summary:",
    patch.proposal.summary,
    "",
    ...(patch.proposal.toolCallId === undefined
      ? []
      : ["Tool call id:", patch.proposal.toolCallId, ""]),
    "Validation errors:",
    ...patch.errors.map(
      (error) =>
        `- ${error.path || "<unknown>"} [edit ${error.editIndex}]: ${error.message}`,
    ),
    "",
    ...(request.responseText.trim().length === 0
      ? []
      : ["Assistant text:", request.responseText, ""]),
    "Raw apply_patch input:",
    patch.proposal.patch,
  ].join("\n");
}

function formatStatus(status: string): string {
  if (status === "done") {
    return "complete";
  }

  return status;
}

export { formatOptionalLatency } from "./LlmTextResponseContent";

function formatPatchStatus(status: string): string {
  if (status === "apply-error") {
    return "apply error";
  }

  return status;
}

function formatPatchProgressFile(file: PatchProgressFile): string {
  if (file.movePath !== undefined) {
    return `${file.operation} ${file.path} -> ${file.movePath}`;
  }

  return `${file.operation} ${file.path}`;
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
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
    const result = await applyPatchProposalWithRuntimeEvents({
      proposal: request.patch.proposal,
      requestId: request.id,
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
