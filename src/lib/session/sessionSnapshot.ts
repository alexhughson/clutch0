import type { Static } from "@sinclair/typebox";
import type { AppState, AppTask, WorkspaceState } from "../../app/appTypes";
import {
  snapshotTaskDescriptors,
  taskDescriptors,
} from "../../app/taskDescriptors";
import { createAutomaticContextItems } from "../context/automaticContextItems";
import type { PersistentContextItem } from "../context/contextItemTypes";
import { decodeSchema } from "../schemaDecode";
import type { ContextItem } from "../../types";
import {
  APP_SNAPSHOT_SCHEMA_VERSION,
  CreateFileTaskParseSchema,
  CreateFileTaskSchema,
  FindFilesTaskParseSchema,
  FindFilesTaskSchema,
  RawAppSnapshotSchema,
  decodeAgentOutputBlocks,
  decodeCreateFileValidationResult,
  decodePersistentContextItems,
  type AppSnapshot,
  type RawAppSnapshot,
  type SerializedAppTask,
  type SerializedResponseTaskState,
} from "./sessionSnapshotSchemas";

export {
  APP_SNAPSHOT_SCHEMA_VERSION,
  type AppSnapshot,
  type SerializedAppTask,
  type SerializedLlmRequestState,
  type SerializedResponseTaskState,
  type SerializedWorkspace,
} from "./sessionSnapshotSchemas";

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
      contextItems: state.workspace.contextItems,
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
  const workspace: WorkspaceState = {
    automaticContextItems: createAutomaticContextItems(),
    composer: snapshot.workspace.composer,
    contextItems: snapshot.workspace.contextItems,
    focusedContextItemId: hasContextItem(
      snapshot.workspace.contextItems,
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
  const parsed = decodeSchema<RawAppSnapshot>(
    RawAppSnapshotSchema,
    raw,
    "app snapshot",
  );

  return {
    activeTask: parseSerializedAppTask(parsed.activeTask),
    nextContextItemId: parsed.nextContextItemId,
    nextLlmRequestId: parsed.nextLlmRequestId,
    schemaVersion: parsed.schemaVersion,
    workspace: {
      composer: parsed.workspace.composer,
      contextItems: decodePersistentContextItems(
        parsed.workspace.contextItems,
        "workspace.contextItems",
      ),
      focusedContextItemId: parsed.workspace.focusedContextItemId,
    },
    workspaceRoot: parsed.workspaceRoot,
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

function parseSerializedAppTask(
  value: RawAppSnapshot["activeTask"],
): SerializedAppTask | null {
  if (value === null) {
    return null;
  }

  const kind = value.kind;
  if (kind === "config") {
    throw new Error("Config tasks are not valid session snapshot tasks.");
  }
  if (!Object.hasOwn(snapshotTaskDescriptors, kind)) {
    throw new Error(`Unknown active task kind in session snapshot: ${kind}`);
  }

  const descriptor =
    snapshotTaskDescriptors[kind as keyof typeof snapshotTaskDescriptors];
  const schema =
    kind === "find-files"
      ? FindFilesTaskParseSchema
      : kind === "create-file"
        ? CreateFileTaskParseSchema
        : descriptor.serializedSchema!;
  const decoded = decodeSchema(schema, value, "activeTask");

  if (kind === "create-file") {
    const taskValue = value as { validation: unknown };
    return {
      ...(decoded as Static<typeof CreateFileTaskSchema>),
      kind: "create-file",
      validation: decodeCreateFileValidationResult(
        taskValue.validation,
        "activeTask.validation",
      ),
    };
  }

  if (kind === "find-files") {
    const taskValue = value as { agentOutput: unknown };
    return {
      ...(decoded as Static<typeof FindFilesTaskSchema>),
      agentOutput: decodeAgentOutputBlocks(
        taskValue.agentOutput,
        "activeTask.agentOutput",
      ),
      kind: "find-files",
    };
  }

  if (kind !== "response") {
    return decoded as SerializedAppTask;
  }

  const response = decoded as Omit<SerializedResponseTaskState, "request"> & {
    request: Omit<SerializedResponseTaskState["request"], "contextItems">;
  };
  const requestRecord = (value as { request: { contextItems: unknown } })
    .request;
  if (!Array.isArray(requestRecord.contextItems)) {
    throw new Error("activeTask.request.contextItems must be an array.");
  }

  return {
    ...response,
    request: {
      ...response.request,
      contextItems: decodePersistentContextItems(
        requestRecord.contextItems,
        "activeTask.request.contextItems",
      ),
    },
  };
}

function serializeAppTask(task: AppTask | null): SerializedAppTask | null {
  if (task === null || task.kind === "config") {
    return null;
  }

  return snapshotTaskDescriptors[task.kind].serializeToSnapshot!(
    task as never,
  ) as SerializedAppTask;
}

function restoreAppTask(task: SerializedAppTask | null): AppTask | null {
  if (task === null) {
    return null;
  }

  return snapshotTaskDescriptors[task.kind].restoreFromSnapshot!(
    task as never,
  ) as AppTask;
}

function normalizeRestoredTask(task: AppTask | null): AppTask | null {
  if (task === null) {
    return null;
  }

  const normalized = taskDescriptors[task.kind].normalizeOnRestore(
    task as never,
  ) as AppTask;
  if (normalized.kind !== "response") {
    return normalized;
  }

  return {
    ...normalized,
    request: {
      ...normalized.request,
      contextItems: normalized.request.contextItems.map(normalizeRestoredItem),
    },
  };
}

function normalizeRestoredItem(
  item: PersistentContextItem,
): PersistentContextItem {
  if (item.type === "llm-response-live" && item.status === "running") {
    return {
      ...item,
      errorMessage: "Interrupted while waiting for model response.",
      status: "error",
    };
  }

  if (item.type === "pi-agent") {
    const detached = { ...item, sessionAvailability: "detached" as const };
    return detached.status === "running"
      ? {
          ...detached,
          errorMessage: "Interrupted while running agent session.",
          status: "error" as const,
        }
      : detached;
  }

  return item;
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
    "sourceRequestId" in item && typeof item.sourceRequestId === "number"
      ? [item.sourceRequestId]
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
