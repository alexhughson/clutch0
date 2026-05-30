import type { ReactNode } from "react";
import { LlmResponseScreen } from "../components/LlmResponseScreen";
import { assertNever } from "../lib/invariant";
import { ContextItemViewerScreen } from "../workflows/contextItems/ContextItemViewerScreen";
import { CreateFileScreen } from "../workflows/createFile/CreateFileScreen";
import { FindFilesScreen } from "../workflows/findFiles/FindFilesScreen";
import { ShellCommandScreen } from "../workflows/shellCommand/ShellCommandScreen";
import { ShowContextScreen } from "../workflows/showContext/ShowContextScreen";
import type { AppTask } from "./appTypes";

export function renderTask(task: AppTask): ReactNode {
  switch (task.kind) {
    case "response":
      return <LlmResponseScreen request={task.request} />;
    case "find-files":
      return <FindFilesScreen screen={task} />;
    case "create-file":
      return <CreateFileScreen task={task} />;
    case "context-item-viewer":
      return <ContextItemViewerScreen screen={task} />;
    case "shell-command":
      return <ShellCommandScreen task={task} />;
    case "show-context":
      return <ShowContextScreen task={task} />;
    default:
      return assertNever(task, "Unhandled app task");
  }
}
