import type { ReactNode } from "react";
import { LlmResponseScreen } from "../components/LlmResponseScreen";
import { ContextItemViewerScreen } from "../workflows/contextItems/ContextItemViewerScreen";
import { FindFilesScreen } from "../workflows/findFiles/FindFilesScreen";
import type {
  AppTask,
  ContextItemViewerTaskState,
  FindFilesTaskState,
  ResponseTaskState,
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
    kind: "context-item-viewer",
    render: (task) => (
      <ContextItemViewerScreen screen={task as ContextItemViewerTaskState} />
    ),
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
