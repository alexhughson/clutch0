import { LlmResponseScreen } from "../components/LlmResponseScreen";
import {
  ContextItemViewerTaskSchema,
  CreateFileTaskParseSchema,
  FindFilesTaskParseSchema,
  ResponseTaskSchema,
  ShellCommandTaskSchema,
  ShowContextTaskSchema,
  encodePersistentContextItems,
} from "../lib/session/sessionSnapshotSchemas";
import { ConfigScreen } from "../workflows/config/ConfigScreen";
import { ContextItemViewerScreen } from "../workflows/contextItems/ContextItemViewerScreen";
import { CreateFileScreen } from "../workflows/createFile/CreateFileScreen";
import { FindFilesScreen } from "../workflows/findFiles/FindFilesScreen";
import { ShellCommandScreen } from "../workflows/shellCommand/ShellCommandScreen";
import { ShowContextScreen } from "../workflows/showContext/ShowContextScreen";
import type { AppTask } from "./appTypes";
import type { TaskDescriptor, TaskDescriptors } from "./taskDescriptor";

const identitySerialize = <Task extends AppTask>(task: Task) => task;
const identityRestore = <Task extends AppTask>(task: Task) => task;

const contextItemViewerTaskDescriptor = {
  canCloseWithCtrlC: (task) => task.applyStatus !== "applying",
  canUseContextListKeyboardWithPane: true,
  isWorkspacePaneTask: () => true,
  kind: "context-item-viewer",
  normalizeOnRestore: (task) =>
    task.applyStatus === "applying"
      ? {
          ...task,
          applyErrorMessage: "Interrupted while applying changes.",
          applyStatus: "apply-error",
        }
      : task,
  presentationTitle: "Context item",
  render: (task) => <ContextItemViewerScreen screen={task} />,
  restoreFromSnapshot: identityRestore,
  serializedSchema: ContextItemViewerTaskSchema,
  serializeToSnapshot: identitySerialize,
} satisfies TaskDescriptor<"context-item-viewer">;

const configTaskDescriptor = {
  canCloseWithCtrlC: (task) => task.mode === "settings",
  canUseContextListKeyboardWithPane: false,
  isWorkspacePaneTask: (task) => task.mode === "settings",
  kind: "config",
  normalizeOnRestore: identityRestore,
  presentationTitle: "Configuration",
  render: (task) => <ConfigScreen task={task} />,
} satisfies TaskDescriptor<"config">;

const createFileTaskDescriptor = {
  canCloseWithCtrlC: (task) => task.applyStatus !== "applying",
  canUseContextListKeyboardWithPane: false,
  isWorkspacePaneTask: () => true,
  kind: "create-file",
  normalizeOnRestore: (task) =>
    task.applyStatus === "applying"
      ? {
          ...task,
          applyErrorMessage: "Interrupted while creating file.",
          applyStatus: "apply-error",
        }
      : task,
  presentationTitle: "Create file",
  render: (task) => <CreateFileScreen task={task} />,
  restoreFromSnapshot: identityRestore,
  serializedSchema: CreateFileTaskParseSchema,
  serializeToSnapshot: identitySerialize,
} satisfies TaskDescriptor<"create-file">;

const findFilesTaskDescriptor = {
  canCloseWithCtrlC: (task) => task.status !== "searching",
  canUseContextListKeyboardWithPane: false,
  isWorkspacePaneTask: () => true,
  kind: "find-files",
  normalizeOnRestore: (task) =>
    task.status === "searching"
      ? {
          ...task,
          errorMessage: "Interrupted while searching for files.",
          status: "error",
        }
      : task,
  presentationTitle: "Find files",
  render: (task) => <FindFilesScreen screen={task} />,
  restoreFromSnapshot: identityRestore,
  serializedSchema: FindFilesTaskParseSchema,
  serializeToSnapshot: identitySerialize,
} satisfies TaskDescriptor<"find-files">;

const responseTaskDescriptor = {
  canCloseWithCtrlC: (task) => {
    if (
      task.request.status === "loading" ||
      task.request.status === "streaming"
    ) {
      return false;
    }

    const patch = task.request.patch;
    return (
      patch === undefined ||
      (patch.applyStatus !== "applying" && patch.applyStatus !== "applied")
    );
  },
  canUseContextListKeyboardWithPane: true,
  isWorkspacePaneTask: () => true,
  kind: "response",
  normalizeOnRestore: normalizeResponseTask,
  presentationTitle: "Response",
  render: (task) => <LlmResponseScreen request={task.request} />,
  restoreFromSnapshot: (task) =>
    task as Extract<AppTask, { kind: "response" }>,
  serializedSchema: ResponseTaskSchema,
  serializeToSnapshot: (task) => ({
    ...task,
    request: {
      ...task.request,
      contextItems: encodePersistentContextItems(task.request.contextItems),
    },
  }),
} satisfies TaskDescriptor<"response">;

const shellCommandTaskDescriptor = {
  canCloseWithCtrlC: (task) => task.status !== "running",
  canUseContextListKeyboardWithPane: false,
  isWorkspacePaneTask: () => true,
  kind: "shell-command",
  normalizeOnRestore: (task) =>
    task.status === "running"
      ? {
          ...task,
          errorMessage: "Interrupted while running shell command.",
          status: "error",
        }
      : task,
  presentationTitle: "Shell command",
  render: (task) => <ShellCommandScreen task={task} />,
  restoreFromSnapshot: identityRestore,
  serializedSchema: ShellCommandTaskSchema,
  serializeToSnapshot: identitySerialize,
} satisfies TaskDescriptor<"shell-command">;

const showContextTaskDescriptor = {
  canCloseWithCtrlC: (task) => task.status !== "loading",
  canUseContextListKeyboardWithPane: false,
  isWorkspacePaneTask: () => true,
  kind: "show-context",
  normalizeOnRestore: (task) =>
    task.status === "loading"
      ? {
          ...task,
          errorMessage: "Interrupted while rendering context.",
          status: "error",
        }
      : task,
  presentationTitle: "Show context",
  render: (task) => <ShowContextScreen task={task} />,
  restoreFromSnapshot: identityRestore,
  serializedSchema: ShowContextTaskSchema,
  serializeToSnapshot: identitySerialize,
} satisfies TaskDescriptor<"show-context">;

export const taskDescriptors = {
  "context-item-viewer": contextItemViewerTaskDescriptor,
  config: configTaskDescriptor,
  "create-file": createFileTaskDescriptor,
  "find-files": findFilesTaskDescriptor,
  response: responseTaskDescriptor,
  "shell-command": shellCommandTaskDescriptor,
  "show-context": showContextTaskDescriptor,
} satisfies TaskDescriptors;

export const snapshotTaskDescriptors = {
  "context-item-viewer": contextItemViewerTaskDescriptor,
  "create-file": createFileTaskDescriptor,
  "find-files": findFilesTaskDescriptor,
  response: responseTaskDescriptor,
  "shell-command": shellCommandTaskDescriptor,
  "show-context": showContextTaskDescriptor,
} as const;

function normalizeResponseTask(
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
      patch:
        nextRequest.patch === undefined
          ? undefined
          : normalizePatchReviewState(nextRequest.patch),
    },
  };
}

function normalizePatchReviewState(
  patch: NonNullable<
    Extract<AppTask, { kind: "response" }>["request"]["patch"]
  >,
): NonNullable<Extract<AppTask, { kind: "response" }>["request"]["patch"]> {
  return patch.applyStatus === "applying"
    ? {
        ...patch,
        applyErrorMessage: "Interrupted while applying patch.",
        applyStatus: "apply-error",
      }
    : patch;
}

function descriptorFor(task: AppTask): TaskDescriptor<AppTask["kind"]> {
  return taskDescriptors[task.kind] as TaskDescriptor<AppTask["kind"]>;
}

export function renderTask(task: AppTask) {
  return descriptorFor(task).render(task as never);
}

export function getTaskPresentationTitle(task: AppTask): string {
  return descriptorFor(task).presentationTitle;
}

export function isWorkspacePaneTask(task: AppTask | null): task is AppTask {
  return task !== null && descriptorFor(task).isWorkspacePaneTask(task as never);
}

export function canUseContextListKeyboardWithPane(task: AppTask): boolean {
  return descriptorFor(task).canUseContextListKeyboardWithPane;
}

export function canCloseTaskWithCtrlC(task: AppTask): boolean {
  return descriptorFor(task).canCloseWithCtrlC(task as never);
}
