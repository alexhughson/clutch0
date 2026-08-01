import type {
  AppState,
  AppTask,
  ComposerState,
  ContextItemReplacementTarget,
  LlmRequestState,
  RelevantFileCandidate,
  ShellCommandReplacementTarget,
  WorkspaceState,
} from "../../app/appTypes";
import { getAgentHarness } from "../agent/harnessRegistry";
import { registerBuiltinAgentHarnesses } from "../agent/harnesses/registerBuiltinHarnesses";
import { createAutomaticContextItems } from "../context/automaticContextItems";
import {
  LiveLlmResponseContextItem,
  PiAgentContextItem,
  type PersistentContextItemState,
  parseAgentOutputBlock,
  restoreContextItem,
  serializeContextItem,
} from "../context/contextItems";
import type { CreateFileValidationResult } from "../createFile/createFile";
import { patchProposalFromLegacyEdits } from "../patch/patchEngine";
import type { PatchProgressState, PatchReviewState } from "../patch/types";
import type { ShellCommandResult } from "../shell/shellCommand";
import type { ContextItem } from "../../types";
import { existsSync } from "node:fs";

export const APP_SNAPSHOT_SCHEMA_VERSION = 1;

export type SerializedWorkspace = {
  composer: AppState["workspace"]["composer"];
  contextItems: PersistentContextItemState[];
  focusedContextItemId: string | null;
};

export type SerializedLlmRequestState = Omit<
  LlmRequestState,
  "contextItems"
> & {
  contextItems: PersistentContextItemState[];
};

type SerializedResponseTaskState = {
  kind: "response";
  rejectComposer?: ComposerState;
  request: SerializedLlmRequestState;
};

export type SerializedAppTask =
  | Exclude<AppTask, { kind: "config" | "response" }>
  | SerializedResponseTaskState;

export type AppSnapshot = {
  activeTask: SerializedAppTask | null;
  nextContextItemId: number;
  nextLlmRequestId: number;
  schemaVersion: typeof APP_SNAPSHOT_SCHEMA_VERSION;
  workspace: SerializedWorkspace;
  workspaceRoot: string;
};

export function serializeAppSnapshot({
  state,
  workspaceRoot,
}: {
  state: AppState;
  workspaceRoot: string;
}): AppSnapshot {
  return {
    activeTask: serializeAppTask(state.activeTask),
    nextContextItemId: state.nextContextItemId,
    nextLlmRequestId: state.nextLlmRequestId,
    schemaVersion: APP_SNAPSHOT_SCHEMA_VERSION,
    workspace: {
      composer: state.workspace.composer,
      contextItems: serializeContextItems(state.workspace.contextItems),
      focusedContextItemId: state.workspace.focusedContextItemId,
    },
    workspaceRoot,
  };
}

export function serializeInterruptedAppSnapshot({
  state,
  workspaceRoot,
}: {
  state: AppState;
  workspaceRoot: string;
}): AppSnapshot {
  const normalized = normalizeRestoredState({
    activeTask: state.activeTask,
    nextContextItemId: state.nextContextItemId,
    nextLlmRequestId: state.nextLlmRequestId,
    workspace: state.workspace,
  });

  return serializeAppSnapshot({
    state: { ...normalized, actions: state.actions },
    workspaceRoot,
  });
}

export function restoreAppStateFromSnapshot(
  snapshot: AppSnapshot,
): Omit<AppState, "actions"> {
  const contextItems = snapshot.workspace.contextItems.map(restoreContextItem);
  const workspace: WorkspaceState = {
    automaticContextItems: createAutomaticContextItems(),
    composer: snapshot.workspace.composer,
    contextItems,
    focusedContextItemId: hasContextItem(
      contextItems,
      snapshot.workspace.focusedContextItemId,
    )
      ? snapshot.workspace.focusedContextItemId
      : null,
  };

  const activeTask = restoreAppTask(snapshot.activeTask);
  const normalized = normalizeRestoredState({
    activeTask,
    nextContextItemId: snapshot.nextContextItemId,
    nextLlmRequestId: snapshot.nextLlmRequestId,
    workspace,
  });

  return {
    ...normalized,
    nextContextItemId: Math.max(
      normalized.nextContextItemId,
      nextNumericId(restoredContextItemsForCounters(normalized)),
    ),
    nextLlmRequestId: Math.max(
      normalized.nextLlmRequestId,
      nextRequestId(
        normalized.activeTask,
        restoredContextItemsForCounters(normalized),
      ),
    ),
  };
}

export function parseAppSnapshot(raw: unknown): AppSnapshot {
  const record = assertRecord(raw, "app snapshot");
  const schemaVersion = assertNumber(record.schemaVersion, "schemaVersion");
  if (schemaVersion !== APP_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported app snapshot schema version: ${schemaVersion}`,
    );
  }

  const workspace = assertRecord(record.workspace, "workspace");
  return {
    activeTask: parseSerializedAppTask(record.activeTask),
    nextContextItemId: assertPositiveSafeInteger(
      record.nextContextItemId,
      "nextContextItemId",
    ),
    nextLlmRequestId: assertPositiveSafeInteger(
      record.nextLlmRequestId,
      "nextLlmRequestId",
    ),
    schemaVersion: APP_SNAPSHOT_SCHEMA_VERSION,
    workspace: {
      composer: parseComposer(workspace.composer),
      contextItems: parsePersistentContextItemStates(
        workspace.contextItems,
        "workspace.contextItems",
      ),
      focusedContextItemId:
        workspace.focusedContextItemId === null
          ? null
          : assertString(
              workspace.focusedContextItemId,
              "workspace.focusedContextItemId",
            ),
    },
    workspaceRoot: assertString(record.workspaceRoot, "workspaceRoot"),
  };
}

function parseSerializedAppTask(value: unknown): SerializedAppTask | null {
  if (value === null) {
    return null;
  }

  const record = assertRecord(value, "activeTask");
  const kind = assertString(record.kind, "activeTask.kind");
  switch (kind) {
    case "config":
      throw new Error("Config tasks are not valid session snapshot tasks.");
    case "context-item-viewer":
      return parseContextItemViewerTask(record);
    case "create-file":
      return parseCreateFileTask(record);
    case "find-files":
      return parseFindFilesTask(record);
    case "shell-command":
      return parseShellCommandTask(record);
    case "show-context":
      return parseShowContextTask(record);
    case "response":
      return parseResponseTask(record);
    default:
      throw new Error(`Unknown active task kind in session snapshot: ${kind}`);
  }
}

function parseContextItemViewerTask(
  record: Record<string, unknown>,
): Extract<SerializedAppTask, { kind: "context-item-viewer" }> {
  return {
    ...(record.applyErrorMessage === undefined
      ? {}
      : {
          applyErrorMessage: assertString(
            record.applyErrorMessage,
            "activeTask.applyErrorMessage",
          ),
        }),
    applyStatus: assertOneOf(
      record.applyStatus,
      ["apply-error", "applying", "idle"],
      "activeTask.applyStatus",
    ),
    itemId: assertString(record.itemId, "activeTask.itemId"),
    kind: "context-item-viewer",
    ...(record.rejectComposer === undefined
      ? {}
      : { rejectComposer: parseComposer(record.rejectComposer) }),
  };
}

function parseCreateFileTask(
  record: Record<string, unknown>,
): Extract<SerializedAppTask, { kind: "create-file" }> {
  return {
    ...(record.applyErrorMessage === undefined
      ? {}
      : {
          applyErrorMessage: assertString(
            record.applyErrorMessage,
            "activeTask.applyErrorMessage",
          ),
        }),
    applyStatus: assertOneOf(
      record.applyStatus,
      ["apply-error", "applying", "pending"],
      "activeTask.applyStatus",
    ),
    id: assertPositiveSafeInteger(record.id, "activeTask.id"),
    kind: "create-file",
    prompt: assertString(record.prompt, "activeTask.prompt"),
    ...(record.rejectComposer === undefined
      ? {}
      : { rejectComposer: parseComposer(record.rejectComposer) }),
    validation: parseCreateFileValidation(record.validation),
  };
}

function parseFindFilesTask(
  record: Record<string, unknown>,
): Extract<SerializedAppTask, { kind: "find-files" }> {
  return {
    agentOutput: assertArray(record.agentOutput, "activeTask.agentOutput").map(
      (block, index) =>
        parseAgentOutputBlock(block, `activeTask.agentOutput[${index}]`),
    ),
    candidates: assertArray(record.candidates, "activeTask.candidates").map(
      parseRelevantFileCandidate,
    ),
    ...(record.errorMessage === undefined
      ? {}
      : {
          errorMessage: assertString(
            record.errorMessage,
            "activeTask.errorMessage",
          ),
        }),
    goal: assertString(record.goal, "activeTask.goal"),
    hints: assertArray(record.hints, "activeTask.hints").map((hint, index) =>
      assertString(hint, `activeTask.hints[${index}]`),
    ),
    kind: "find-files",
    ...(record.rejectComposer === undefined
      ? {}
      : { rejectComposer: parseComposer(record.rejectComposer) }),
    selectedIndex: assertNonNegativeSafeInteger(
      record.selectedIndex,
      "activeTask.selectedIndex",
    ),
    status: assertOneOf(
      record.status,
      ["error", "results", "searching"],
      "activeTask.status",
    ),
  };
}

function parseShellCommandTask(
  record: Record<string, unknown>,
): Extract<SerializedAppTask, { kind: "shell-command" }> {
  return {
    ...(record.errorMessage === undefined
      ? {}
      : {
          errorMessage: assertString(
            record.errorMessage,
            "activeTask.errorMessage",
          ),
        }),
    id: assertPositiveSafeInteger(record.id, "activeTask.id"),
    kind: "shell-command",
    prompt: assertString(record.prompt, "activeTask.prompt"),
    ...(record.rejectComposer === undefined
      ? {}
      : { rejectComposer: parseComposer(record.rejectComposer) }),
    ...(record.replacement === undefined
      ? {}
      : { replacement: parseShellCommandReplacement(record.replacement) }),
    ...(record.result === undefined
      ? {}
      : { result: parseShellCommandResult(record.result) }),
    ...(record.savedContextItemId === undefined
      ? {}
      : {
          savedContextItemId: assertString(
            record.savedContextItemId,
            "activeTask.savedContextItemId",
          ),
        }),
    status: assertOneOf(
      record.status,
      ["done", "error", "running"],
      "activeTask.status",
    ),
  };
}

function parseShowContextTask(
  record: Record<string, unknown>,
): Extract<SerializedAppTask, { kind: "show-context" }> {
  return {
    ...(record.content === undefined
      ? {}
      : { content: assertString(record.content, "activeTask.content") }),
    ...(record.errorMessage === undefined
      ? {}
      : {
          errorMessage: assertString(
            record.errorMessage,
            "activeTask.errorMessage",
          ),
        }),
    id: assertPositiveSafeInteger(record.id, "activeTask.id"),
    kind: "show-context",
    question: assertString(record.question, "activeTask.question"),
    ...(record.rejectComposer === undefined
      ? {}
      : { rejectComposer: parseComposer(record.rejectComposer) }),
    status: assertOneOf(
      record.status,
      ["done", "error", "loading"],
      "activeTask.status",
    ),
  };
}

function parseResponseTask(
  record: Record<string, unknown>,
): SerializedResponseTaskState {
  return {
    kind: "response",
    ...(record.rejectComposer === undefined
      ? {}
      : { rejectComposer: parseComposer(record.rejectComposer) }),
    request: parseLlmRequestState(record.request),
  };
}

function parseLlmRequestState(value: unknown): SerializedLlmRequestState {
  const record = assertRecord(value, "activeTask.request");
  const status = assertOneOf(
    record.status,
    ["done", "error", "loading", "streaming"],
    "activeTask.request.status",
  );
  return {
    contextItems: parsePersistentContextItemStates(
      record.contextItems,
      "activeTask.request.contextItems",
    ),
    focusedContextItemId:
      record.focusedContextItemId === null
        ? null
        : assertString(
            record.focusedContextItemId,
            "activeTask.request.focusedContextItemId",
          ),
    id: assertPositiveSafeInteger(record.id, "activeTask.request.id"),
    ...(record.latencyStats === undefined
      ? {}
      : {
          latencyStats: parseLlmRequestLatencyStats(
            record.latencyStats,
            "activeTask.request.latencyStats",
          ),
        }),
    ...(record.patch === undefined
      ? {}
      : { patch: parsePatchReviewState(record.patch) }),
    ...(record.patchProgress === undefined
      ? {}
      : {
          patchProgress: parsePatchProgressState(
            record.patchProgress,
            "activeTask.request.patchProgress",
          ),
        }),
    question: assertString(record.question, "activeTask.request.question"),
    ...(record.replacement === undefined
      ? {}
      : { replacement: parseContextItemReplacement(record.replacement) }),
    responseText: assertString(
      record.responseText,
      "activeTask.request.responseText",
    ),
    ...(record.savedContextItemId === undefined
      ? {}
      : {
          savedContextItemId: assertString(
            record.savedContextItemId,
            "activeTask.request.savedContextItemId",
          ),
        }),
    ...(status === "error"
      ? {
          errorMessage: assertString(
            record.errorMessage,
            "activeTask.request.errorMessage",
          ),
        }
      : record.errorMessage === undefined
        ? {}
        : {
            errorMessage: assertString(
              record.errorMessage,
              "activeTask.request.errorMessage",
            ),
          }),
    status,
  } as SerializedLlmRequestState;
}

function parseLlmRequestLatencyStats(
  value: unknown,
  label: string,
): SerializedLlmRequestState["latencyStats"] {
  const record = assertRecord(value, label);
  return {
    ...(record.totalMs === undefined
      ? {}
      : {
          totalMs: assertNonNegativeNumber(record.totalMs, `${label}.totalMs`),
        }),
    ...(record.ttftMs === undefined
      ? {}
      : {
          ttftMs: assertNonNegativeNumber(record.ttftMs, `${label}.ttftMs`),
        }),
  };
}

function parseComposer(value: unknown): ComposerState {
  const record = assertRecord(value, "workspace.composer");
  return {
    cursorPosition: assertNonNegativeSafeInteger(
      record.cursorPosition,
      "workspace.composer.cursorPosition",
    ),
    message: assertString(record.message, "workspace.composer.message"),
  };
}

function parsePersistentContextItemStates(
  value: unknown,
  label: string,
): PersistentContextItemState[] {
  const ids = new Set<string>();
  return assertArray(value, label).map((snapshot, index) => {
    const item = restoreContextItem(snapshot);
    const serialized = serializeContextItem(item);
    if (serialized === null) {
      throw new Error(`${label}[${index}] must be persistent.`);
    }
    if (ids.has(serialized.id)) {
      throw new Error(`${label}[${index}].id duplicates ${serialized.id}.`);
    }

    ids.add(serialized.id);
    return serialized;
  });
}

function parseContextItemReplacement(
  value: unknown,
): ContextItemReplacementTarget {
  const record = assertRecord(value, "replacement");
  return {
    contextItemId: assertString(
      record.contextItemId,
      "replacement.contextItemId",
    ),
    expectedResult: assertOneOf(
      record.expectedResult,
      ["diff", "text"],
      "replacement.expectedResult",
    ),
  };
}

function parseShellCommandReplacement(
  value: unknown,
): ShellCommandReplacementTarget {
  const record = assertRecord(value, "replacement");
  return {
    contextItemId: assertString(
      record.contextItemId,
      "replacement.contextItemId",
    ),
  };
}

function parseRelevantFileCandidate(value: unknown): RelevantFileCandidate {
  const record = assertRecord(value, "activeTask.candidates[]");
  return {
    ...(record.confidence === undefined
      ? {}
      : {
          confidence: assertOneOf(
            record.confidence,
            ["high", "low", "medium"],
            "activeTask.candidates[].confidence",
          ),
        }),
    path: assertString(record.path, "activeTask.candidates[].path"),
    reason: assertString(record.reason, "activeTask.candidates[].reason"),
  };
}

function parseCreateFileValidation(value: unknown): CreateFileValidationResult {
  const record = assertRecord(value, "activeTask.validation");
  const status = assertOneOf(
    record.status,
    ["invalid", "valid"],
    "activeTask.validation.status",
  );
  const proposalRecord = assertRecord(
    record.proposal,
    "activeTask.validation.proposal",
  );
  const proposal = {
    content: assertString(
      proposalRecord.content,
      "activeTask.validation.proposal.content",
    ),
    path: assertString(
      proposalRecord.path,
      "activeTask.validation.proposal.path",
    ),
    summary: assertString(
      proposalRecord.summary,
      "activeTask.validation.proposal.summary",
    ),
  };

  if (status === "valid") {
    return { proposal, status };
  }

  return {
    errors: assertArray(record.errors, "activeTask.validation.errors").map(
      (error, index) => {
        const errorRecord = assertRecord(
          error,
          `activeTask.validation.errors[${index}]`,
        );
        return {
          message: assertString(
            errorRecord.message,
            `activeTask.validation.errors[${index}].message`,
          ),
          path: assertString(
            errorRecord.path,
            `activeTask.validation.errors[${index}].path`,
          ),
        };
      },
    ),
    proposal,
    status,
  };
}

function parsePatchReviewState(value: unknown): PatchReviewState {
  const record = assertRecord(value, "activeTask.request.patch");
  const status = assertOneOf(
    record.status,
    ["invalid", "valid"],
    "activeTask.request.patch.status",
  );
  const proposalRecord = assertRecord(
    record.proposal,
    "activeTask.request.patch.proposal",
  );
  const proposal =
    proposalRecord.patch === undefined
      ? patchProposalFromLegacyEdits({
          edits: assertArray(
            proposalRecord.edits,
            "activeTask.request.patch.proposal.edits",
          ).map((edit, index) => {
            const editRecord = assertRecord(
              edit,
              `activeTask.request.patch.proposal.edits[${index}]`,
            );
            return {
              newText: assertString(
                editRecord.newText,
                `activeTask.request.patch.proposal.edits[${index}].newText`,
              ),
              oldText: assertString(
                editRecord.oldText,
                `activeTask.request.patch.proposal.edits[${index}].oldText`,
              ),
              path: assertString(
                editRecord.path,
                `activeTask.request.patch.proposal.edits[${index}].path`,
              ),
            };
          }),
          summary: assertString(
            proposalRecord.summary,
            "activeTask.request.patch.proposal.summary",
          ),
        })
      : {
          patch: assertString(
            proposalRecord.patch,
            "activeTask.request.patch.proposal.patch",
          ),
          summary: assertString(
            proposalRecord.summary,
            "activeTask.request.patch.proposal.summary",
          ),
          ...(proposalRecord.toolCallId === undefined
            ? {}
            : {
                toolCallId: assertString(
                  proposalRecord.toolCallId,
                  "activeTask.request.patch.proposal.toolCallId",
                ),
              }),
        };
  const applyStatus = assertOneOf(
    record.applyStatus,
    ["applied", "apply-error", "applying", "pending", "rejected"],
    "activeTask.request.patch.applyStatus",
  );

  if (status === "valid") {
    return {
      ...(record.applyErrorMessage === undefined
        ? {}
        : {
            applyErrorMessage: assertString(
              record.applyErrorMessage,
              "activeTask.request.patch.applyErrorMessage",
            ),
          }),
      applyStatus,
      diffText: assertString(
        record.diffText,
        "activeTask.request.patch.diffText",
      ),
      proposal,
      status,
    };
  }

  return {
    ...(record.applyErrorMessage === undefined
      ? {}
      : {
          applyErrorMessage: assertString(
            record.applyErrorMessage,
            "activeTask.request.patch.applyErrorMessage",
          ),
        }),
    applyStatus,
    errors: assertArray(record.errors, "activeTask.request.patch.errors").map(
      (error, index) => {
        const errorRecord = assertRecord(
          error,
          `activeTask.request.patch.errors[${index}]`,
        );
        return {
          editIndex: assertNonNegativeSafeInteger(
            errorRecord.editIndex,
            `activeTask.request.patch.errors[${index}].editIndex`,
          ),
          message: assertString(
            errorRecord.message,
            `activeTask.request.patch.errors[${index}].message`,
          ),
          path: assertString(
            errorRecord.path,
            `activeTask.request.patch.errors[${index}].path`,
          ),
        };
      },
    ),
    proposal,
    status,
  };
}

function parsePatchProgressState(
  value: unknown,
  label: string,
): PatchProgressState {
  const record = assertRecord(value, label);
  return {
    files: assertArray(record.files, `${label}.files`).map((file, index) => {
      const fileRecord = assertRecord(file, `${label}.files[${index}]`);
      return {
        ...(fileRecord.movePath === undefined
          ? {}
          : {
              movePath: assertString(
                fileRecord.movePath,
                `${label}.files[${index}].movePath`,
              ),
            }),
        operation: assertOneOf(
          fileRecord.operation,
          ["add", "delete", "update"],
          `${label}.files[${index}].operation`,
        ),
        path: assertString(fileRecord.path, `${label}.files[${index}].path`),
      };
    }),
    patchCharacterCount: assertNonNegativeSafeInteger(
      record.patchCharacterCount,
      `${label}.patchCharacterCount`,
    ),
  };
}

function parseShellCommandResult(value: unknown): ShellCommandResult {
  const record = assertRecord(value, "activeTask.result");
  return {
    command: assertString(record.command, "activeTask.result.command"),
    durationMs: assertNonNegativeNumber(
      record.durationMs,
      "activeTask.result.durationMs",
    ),
    exitCode:
      record.exitCode === null
        ? null
        : assertNonNegativeSafeInteger(
            record.exitCode,
            "activeTask.result.exitCode",
          ),
    ...(record.signal === undefined
      ? {}
      : { signal: assertString(record.signal, "activeTask.result.signal") }),
    stderr: assertString(record.stderr, "activeTask.result.stderr"),
    stdout: assertString(record.stdout, "activeTask.result.stdout"),
    timedOut: assertBoolean(record.timedOut, "activeTask.result.timedOut"),
    truncated: assertBoolean(record.truncated, "activeTask.result.truncated"),
  };
}

export function normalizeRestoredState(
  state: Omit<AppState, "actions">,
): Omit<AppState, "actions"> {
  return {
    ...state,
    activeTask: normalizeRestoredTask(state.activeTask),
    workspace: {
      ...state.workspace,
      contextItems: state.workspace.contextItems.map(normalizeRestoredItem),
    },
  };
}

function serializeAppTask(task: AppTask | null): SerializedAppTask | null {
  if (task === null || task.kind === "config") {
    return null;
  }

  if (task.kind !== "response") {
    return task;
  }

  return {
    ...task,
    request: {
      ...task.request,
      contextItems: serializeContextItems(task.request.contextItems),
    },
  };
}

function restoreAppTask(task: SerializedAppTask | null): AppTask | null {
  if (task === null) {
    return null;
  }

  if (task.kind !== "response") {
    return task;
  }

  return {
    ...task,
    request: {
      ...task.request,
      contextItems: task.request.contextItems.map(restoreContextItem),
    } as LlmRequestState,
  };
}

function serializeContextItems(
  contextItems: readonly ContextItem[],
): PersistentContextItemState[] {
  return contextItems.flatMap((item) => {
    const serialized = serializeContextItem(item);
    return serialized === null ? [] : [serialized];
  });
}

function normalizeRestoredTask(task: AppTask | null): AppTask | null {
  if (task === null) {
    return null;
  }

  switch (task.kind) {
    case "config":
      return null;
    case "context-item-viewer":
      return task.applyStatus === "applying"
        ? {
            ...task,
            applyErrorMessage: "Interrupted while applying changes.",
            applyStatus: "apply-error",
          }
        : task;
    case "create-file":
      return task.applyStatus === "applying"
        ? {
            ...task,
            applyErrorMessage: "Interrupted while creating file.",
            applyStatus: "apply-error",
          }
        : task;
    case "find-files":
      return task.status === "searching"
        ? {
            ...task,
            errorMessage: "Interrupted while searching for files.",
            status: "error",
          }
        : task;
    case "response":
      return normalizeRestoredResponseTask(task);
    case "shell-command":
      return task.status === "running"
        ? {
            ...task,
            errorMessage: "Interrupted while running shell command.",
            status: "error",
          }
        : task;
    case "show-context":
      return task.status === "loading"
        ? {
            ...task,
            errorMessage: "Interrupted while rendering context.",
            status: "error",
          }
        : task;
  }
}

function normalizeRestoredResponseTask(
  task: Extract<AppTask, { kind: "response" }>,
): Extract<AppTask, { kind: "response" }> {
  const request = task.request;
  const nextRequest =
    request.status === "loading" || request.status === "streaming"
      ? {
          ...request,
          errorMessage: "Interrupted while waiting for model response.",
          status: "error" as const,
        }
      : request;

  return {
    ...task,
    request: {
      ...nextRequest,
      contextItems: nextRequest.contextItems.map(normalizeRestoredItem),
      patch:
        nextRequest.patch === undefined
          ? undefined
          : normalizePatchReviewState(nextRequest.patch),
    },
  };
}

function normalizePatchReviewState(patch: PatchReviewState): PatchReviewState {
  return patch.applyStatus === "applying"
    ? {
        ...patch,
        applyErrorMessage: "Interrupted while applying patch.",
        applyStatus: "apply-error",
      }
    : patch;
}

function normalizeRestoredItem(item: ContextItem): ContextItem {
  if (item instanceof LiveLlmResponseContextItem && item.status === "running") {
    return item.withError("Interrupted while waiting for model response.");
  }

  if (item instanceof PiAgentContextItem) {
    const availability = resolveRestoredAgentAvailability(item);
    const restored = item.withSessionAvailability(availability);
    if (restored.status !== "running") {
      return restored;
    }
    if (availability !== "live") {
      return restored.withStatus(
        "error",
        "Interrupted while running agent session.",
      );
    }
    // Live + running: allow follow-up only if the agent already produced text.
    // Otherwise the first deck-backed prompt never completed.
    const hasAssistantText = restored.blocks.some(
      (block) =>
        block.kind === "stream" &&
        block.streamKind === "assistant" &&
        block.text.trim().length > 0,
    );
    return hasAssistantText
      ? restored.withStatus("idle")
      : restored.withStatus(
          "error",
          "Interrupted before the agent produced a reply.",
        );
  }

  return item;
}

function resolveRestoredAgentAvailability(
  item: PiAgentContextItem,
): "detached" | "live" {
  if (item.harness === undefined) {
    return "detached";
  }
  try {
    registerBuiltinAgentHarnesses();
    const definition = getAgentHarness(item.harness.kind);
    const session = definition.parseSession(item.harness.session);
    const cwd = item.sandbox?.path;
    if (cwd === undefined || !existsSync(cwd)) {
      return "detached";
    }
    const resume = definition.canResume(session, { cwd });
    return resume.ok ? "live" : "detached";
  } catch {
    return "detached";
  }
}

function hasContextItem(
  contextItems: readonly ContextItem[],
  itemId: string | null,
): boolean {
  return itemId !== null && contextItems.some((item) => item.id === itemId);
}

function restoredContextItemsForCounters(
  state: Omit<AppState, "actions">,
): readonly ContextItem[] {
  if (state.activeTask?.kind !== "response") {
    return state.workspace.contextItems;
  }

  return [
    ...state.workspace.contextItems,
    ...state.activeTask.request.contextItems,
  ];
}

function nextNumericId(contextItems: readonly ContextItem[]): number {
  const highest = contextItems.reduce((max, item) => {
    const match = /:(\d+)$/.exec(item.id);
    return match === null ? max : Math.max(max, Number(match[1]));
  }, 0);

  return highest + 1;
}

function nextRequestId(
  activeTask: AppTask | null,
  contextItems: readonly ContextItem[],
): number {
  const requestIds = contextItems.flatMap((item) =>
    "sourceRequestId" in item.state &&
    typeof item.state.sourceRequestId === "number"
      ? [item.state.sourceRequestId]
      : [],
  );

  if (activeTask?.kind === "response") {
    requestIds.push(activeTask.request.id);
  }

  if (
    activeTask?.kind === "create-file" ||
    activeTask?.kind === "shell-command" ||
    activeTask?.kind === "show-context"
  ) {
    requestIds.push(activeTask.id);
  }

  return Math.max(0, ...requestIds) + 1;
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function assertArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function assertNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return value;
}

function assertNonNegativeNumber(value: unknown, label: string): number {
  const number = assertNumber(value, label);
  if (number < 0) {
    throw new Error(`${label} must be non-negative.`);
  }

  return number;
}

function assertPositiveSafeInteger(value: unknown, label: string): number {
  const number = assertNumber(value, label);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }

  return number;
}

function assertNonNegativeSafeInteger(value: unknown, label: string): number {
  const number = assertNumber(value, label);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }

  return number;
}

function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
}

function assertOneOf<const Value extends string>(
  value: unknown,
  values: readonly Value[],
  label: string,
): Value {
  if (typeof value !== "string" || !values.includes(value as Value)) {
    throw new Error(`${label} must be one of: ${values.join(", ")}.`);
  }

  return value as Value;
}
