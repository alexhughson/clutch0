import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { CreateFileTaskState } from "../../app/appTypes";
import { HighlightedCode } from "../../components/SyntaxHighlightedContent";
import { applyCreateFileProposal } from "../../lib/createFile/createFile";
import { isEnterKey } from "../../lib/keymap";
import { useAppStore } from "../../store/appStore";

type CreateFileScreenProps = {
  task: CreateFileTaskState;
};

type AppActions = ReturnType<typeof useAppStore.getState>["actions"];

export function CreateFileScreen({ task }: CreateFileScreenProps) {
  const actions = useAppStore((state) => state.actions);

  useKeyboard((event) => {
    handleCreateFileKey({ actions, event, task });
  });

  const proposal = task.validation.proposal;

  return (
    <box
      title={`Create file (${formatStatus(task)})`}
      bottomTitle={getCreateFileHotkeys(task)}
      bottomTitleAlignment="right"
      borderStyle="rounded"
      style={{
        border: true,
        flexDirection: "column",
        flexGrow: 1,
        gap: 1,
        height: "100%",
        padding: 1,
        width: "100%",
      }}
    >
      <text style={{ fg: "gray" }}>Request</text>
      <text>{task.prompt}</text>
      <box style={{ flexDirection: "column", flexGrow: 1, gap: 1 }}>
        <text>{proposal.summary}</text>
        <text>{`Path: ${proposal.path}`}</text>
        {task.validation.status === "invalid" ? (
          <box style={{ flexDirection: "column" }}>
            <text style={{ fg: "red" }}>File cannot be created:</text>
            {task.validation.errors.map((error, index) => (
              <text key={`${index}:${error.path}`} style={{ fg: "red" }}>
                {error.path || "<unknown>"}: {error.message}
              </text>
            ))}
          </box>
        ) : null}
        <scrollbox style={{ flexGrow: 1, height: "100%", width: "100%" }}>
          <box style={{ flexDirection: "column" }}>
            <text style={{ fg: "gray" }}>Content:</text>
            <HighlightedCode
              content={proposal.content}
              filePath={proposal.path}
            />
          </box>
        </scrollbox>
        {task.applyErrorMessage === undefined ? null : (
          <text style={{ fg: "red" }}>{task.applyErrorMessage}</text>
        )}
      </box>
    </box>
  );
}

function handleCreateFileKey({
  actions,
  event,
  task,
}: {
  actions: AppActions;
  event: KeyEvent;
  task: CreateFileTaskState;
}) {
  if (task.applyStatus === "applying") {
    return;
  }

  if (
    task.validation.status === "valid" &&
    (event.name === "a" || isEnterKey(event.name))
  ) {
    event.preventDefault();
    event.stopPropagation();
    void applyCreateFile(task, actions.createFile);
    return;
  }

  if (event.name === "escape") {
    event.preventDefault();
    event.stopPropagation();
    actions.navigation.rejectToEdit();
  }
}

async function applyCreateFile(
  task: CreateFileTaskState,
  actions: AppActions["createFile"],
) {
  actions.startApply({ requestId: task.id });
  try {
    const result = await applyCreateFileProposal({
      proposal: task.validation.proposal,
    });

    if (result.status === "invalid") {
      actions.failApply({
        errorMessage: result.errors
          .map((error) => `${error.path || "<unknown>"}: ${error.message}`)
          .join("\n"),
        requestId: task.id,
      });
      return;
    }

    actions.finishApply({ requestId: task.id });
  } catch (error) {
    actions.failApply({
      errorMessage: error instanceof Error ? error.message : String(error),
      requestId: task.id,
    });
  }
}

function getCreateFileHotkeys(task: CreateFileTaskState): string | undefined {
  if (task.applyStatus === "applying") {
    return undefined;
  }

  if (task.validation.status === "invalid") {
    return "Esc return";
  }

  return "Enter/a create file · Esc edit prompt";
}

function formatStatus(task: CreateFileTaskState): string {
  if (task.applyStatus === "applying") {
    return "creating";
  }

  if (task.applyStatus === "apply-error") {
    return "error";
  }

  return task.validation.status === "valid" ? "pending" : "invalid";
}
