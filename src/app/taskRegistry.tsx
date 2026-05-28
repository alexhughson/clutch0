import type { ReactNode } from "react";
import { LlmResponseScreen } from "../components/LlmResponseScreen";
import { ContextItemViewerScreen } from "../workflows/contextItems/ContextItemViewerScreen";
import { CreateFileScreen } from "../workflows/createFile/CreateFileScreen";
import { FindFilesScreen } from "../workflows/findFiles/FindFilesScreen";
import { ShellCommandScreen } from "../workflows/shellCommand/ShellCommandScreen";
import { ShowContextScreen } from "../workflows/showContext/ShowContextScreen";
import type {
  AppTask,
  ContextItemViewerTaskState,
  CreateFileTaskState,
  FindFilesTaskState,
  ResponseTaskState,
  ShellCommandTaskState,
  ShowContextTaskState,
} from "./appTypes";

type TaskController = {
  kind: AppTask["kind"];
  render: (task: AppTask) => ReactNode;
};

const taskControllers: TaskController[] = [
  {
    kind: "response",
    render: (task) => (
      <LlmResponseScreen request={(task as ResponseTaskState).request} />
    ),
  },
  {
    kind: "find-files",
    render: (task) => <FindFilesScreen screen={task as FindFilesTaskState} />,
  },
  {
    kind: "create-file",
    render: (task) => <CreateFileScreen task={task as CreateFileTaskState} />,
  },
  {
    kind: "context-item-viewer",
    render: (task) => (
      <ContextItemViewerScreen screen={task as ContextItemViewerTaskState} />
    ),
  },
  {
    kind: "shell-command",
    render: (task) => (
      <ShellCommandScreen task={task as ShellCommandTaskState} />
    ),
  },
  {
    kind: "show-context",
    render: (task) => <ShowContextScreen task={task as ShowContextTaskState} />,
  },
];

export function renderTask(task: AppTask): ReactNode {
  const controller = taskControllers.find(
    (candidate) => candidate.kind === task.kind,
  );
  if (controller === undefined) {
    return null;
  }

  return controller.render(task);
}
