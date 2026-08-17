import type { ContextItemReplacementTarget } from "../../app/appTypes";
import type { ComposerState } from "../../app/appTypes";
import { assembleLlmContextInput } from "../../lib/llm/context";
import { getPatchProposalPaths } from "../../lib/patch/patchEngine";
import {
  LlmCompletionError,
  type PatchToolMode,
  streamLlmInteraction,
} from "../../lib/llm/streamResponse";
import { recordSessionRuntimeEvent, useAppStore } from "../../store/appStore";
import { handleLlmWorkflowResult } from "../llmTools/toolRegistry";
import { createRuntimeAbortHandle } from "../../lib/session/runtimeInterrupts";
import { markContextItemRerunStarted } from "../contextItems/regenerateContextItem";

let streamLlmInteractionForStart: typeof streamLlmInteraction =
  streamLlmInteraction;

export function setStartLlmRequestStreamForTest(
  streamer: typeof streamLlmInteraction,
): () => void {
  const previous = streamLlmInteractionForStart;
  streamLlmInteractionForStart = streamer;
  return () => {
    streamLlmInteractionForStart = previous;
  };
}

export function startLlmRequest(
  question: string,
  options: {
    allowedToolNames?: readonly string[];
    commandDirective?: string;
    patchToolMode?: PatchToolMode;
    rejectComposer?: ComposerState;
    replacement?: ContextItemReplacementTarget;
  } = {},
) {
  const currentState = useAppStore.getState();
  const { contextItems, focusedContextItemId } = assembleLlmContextInput({
    automaticContextItems: currentState.workspace.automaticContextItems,
    contextItems: currentState.workspace.contextItems,
    excludedContextItemId: options.replacement?.contextItemId,
    focusedContextItemId: currentState.workspace.focusedContextItemId,
  });
  const requestId = currentState.actions.compose.startLlmRequest({
    question,
    rejectComposer: options.rejectComposer,
    replacement: options.replacement,
  });
  if (requestId === null) {
    return;
  }

  if (options.replacement !== undefined) {
    markContextItemRerunStarted(options.replacement.contextItemId);
  }

  const abortHandle = createRuntimeAbortHandle();
  recordSessionRuntimeEvent({
    contextItemIds: contextItems.map((item) => item.id),
    focusedContextItemId,
    kind: "llm.started",
    requestId,
    toolNames: options.allowedToolNames ?? null,
  });
  void streamLlmInteractionForStart({
    allowedToolNames: options.allowedToolNames,
    commandDirective: options.commandDirective,
    question,
    contextItems,
    focusedContextItemId,
    onDelta: (delta) => {
      recordSessionRuntimeEvent({
        deltaLength: delta.length,
        kind: "llm.delta",
        requestId,
      });
      useAppStore.getState().actions.response.appendDelta({ delta, requestId });
    },
    onCompletionLatency: (latencyStats) => {
      useAppStore
        .getState()
        .actions.response.setLatencyStats({ latencyStats, requestId });
    },
    onPatchProgress: (progress) => {
      recordSessionRuntimeEvent({
        fileCount: progress.files.length,
        files: progress.files,
        kind: "llm.patch-progress",
        patchCharacterCount: progress.patchCharacterCount,
        requestId,
      });
      useAppStore
        .getState()
        .actions.response.setPatchProgress({ progress, requestId });
    },
    patchToolMode: options.patchToolMode,
    requestId,
    signal: abortHandle.signal,
  }).then(
    (result) => {
      abortHandle.dispose();
      if (result.kind === "text") {
        recordSessionRuntimeEvent({
          kind: "llm.finished",
          requestId,
          responseKind: "text",
          responseLength: result.responseText.length,
        });
        useAppStore.getState().actions.response.finish({
          requestId,
          responseKind: "text",
          responseText: result.responseText,
        });
        return;
      }

      recordSessionRuntimeEvent({
        kind: "llm.finished",
        requestId,
        responseKind: result.kind,
        ...runtimeDetailsForWorkflowResult(result),
      });
      handleLlmWorkflowResult({
        actions: useAppStore.getState().actions,
        requestId,
        result,
      });
    },
    (error: unknown) => {
      abortHandle.dispose();
      recordSessionRuntimeEvent({
        errorMessage: error instanceof Error ? error.message : String(error),
        kind: "llm.failed",
        requestId,
      });
      useAppStore.getState().actions.response.fail({
        errorMessage: error instanceof Error ? error.message : String(error),
        requestId,
        responseText:
          error instanceof LlmCompletionError ? error.debugOutput : undefined,
      });
    },
  );
}

function runtimeDetailsForWorkflowResult(
  result: Exclude<
    Awaited<ReturnType<typeof streamLlmInteraction>>,
    { kind: "text" }
  >,
): Record<string, unknown> {
  switch (result.kind) {
    case "add-files":
      return { pathCount: result.paths.length };
    case "command-output":
      return {
        command: result.result.command,
        exitCode: result.result.exitCode,
        signal: result.result.signal,
      };
    case "create-file":
      return {
        path: result.validation.proposal.path,
        validationStatus: result.validation.status,
      };
    case "find-files":
      return { goal: result.goal, hintCount: result.hints.length };
    case "patch":
      return {
        editCount: getPatchProposalPaths(result.patch.proposal).length,
        validationStatus: result.patch.status,
      };
  }
}
