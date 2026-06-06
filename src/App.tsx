import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, type ReactNode } from "react";
import type { AppTask, WorkspaceState } from "./app/appTypes";
import { renderTask } from "./app/taskRegistry";
import {
  getWorkspaceLayout,
  isWorkspaceDetailTask,
  type WorkspaceLayoutMode,
} from "./app/layout";
import {
  ContextItemsList,
  FocusedContextItemSummary,
} from "./components/ContextItemsList";
import { MessageComposer } from "./components/MessageComposer/MessageComposer";
import {
  formatContextItemAction,
  getContextItemActionForKeyEvent,
} from "./lib/context/contextItemActions";
import {
  getVisibleContextItemById,
  getVisibleContextItems,
} from "./lib/context/automaticContextItems";
import {
  PiAgentContextItem,
  UserTextContextItem,
} from "./lib/context/contextItems";
import {
  getFileSelectorMatchAtCursor,
  getSlashCommandSelectorMatchAtCursor,
  NoFileSelector,
  NoSlashCommandSelector,
} from "./lib/inputLineParser";
import { getVerticalNavigationDirection } from "./lib/keymap";
import { useAppStore } from "./store/appStore";
import type { ContextItem, FilePath } from "./types";

type AppProps = {
  filePaths: readonly FilePath[];
};

export function App({ filePaths }: AppProps) {
  const actions = useAppStore((state) => state.actions);
  const activeTask = useAppStore((state) => state.activeTask);
  const workspace = useAppStore((state) => state.workspace);
  const { height, width } = useTerminalDimensions();
  const detailTask = isWorkspaceDetailTask(activeTask) ? activeTask : null;
  const layout = getWorkspaceLayout({
    hasDetailTask: detailTask !== null,
    height,
    width,
  });

  useEffect(() => {
    actions.contextSummaries.ensureWorkspaceSummaries();
  }, [actions]);

  useKeyboard((event) => {
    if (
      detailTask === null ||
      isFocusedDetailTakingKeyboard({ detailTask, workspace })
    ) {
      return;
    }

    const direction = getVerticalNavigationDirection(event);
    if (direction === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (direction === "next") {
      actions.compose.focusNextContextItem();
    } else {
      actions.compose.focusPreviousContextItem();
    }
  });

  useKeyboard((event) => {
    if (
      detailTask === null ||
      isFocusedDetailTakingKeyboard({ detailTask, workspace })
    ) {
      return;
    }

    const focusedItem = getVisibleContextItemById(
      workspace.contextItems,
      workspace.focusedContextItemId,
      workspace.automaticContextItems,
    );
    if (focusedItem === null) {
      return;
    }

    const action = getContextItemActionForKeyEvent({
      actions: focusedItem.getActions(),
      event,
    });
    if (action?.id !== "open") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    actions.contextItems.openContextItem({ itemId: focusedItem.id });
  });

  if (activeTask !== null && detailTask === null) {
    return (
      <AppRoot height={height} width={width}>
        {renderTask(activeTask)}
      </AppRoot>
    );
  }

  if (detailTask !== null && layout.detailTakesOver) {
    return (
      <AppRoot height={height} width={width}>
        {renderTask(detailTask)}
      </AppRoot>
    );
  }

  return (
    <AppRoot height={height} width={width}>
      <WorkspaceLayout
        detailTask={detailTask}
        filePaths={filePaths}
        mode={layout.mode}
        terminalHeight={height}
        workspace={workspace}
      />
    </AppRoot>
  );
}

function AppRoot({
  children,
  height,
  width,
}: {
  children: ReactNode;
  height: number;
  width: number;
}) {
  return (
    <box
      style={{
        flexDirection: "column",
        height,
        width,
      }}
    >
      {children}
    </box>
  );
}

function WorkspaceLayout({
  detailTask,
  filePaths,
  mode,
  terminalHeight,
  workspace,
}: {
  detailTask: Extract<
    AppTask,
    { kind: "context-item-viewer" | "response" }
  > | null;
  filePaths: readonly FilePath[];
  mode: WorkspaceLayoutMode;
  terminalHeight: number;
  workspace: WorkspaceState;
}) {
  const contextItems = getVisibleContextItems(
    workspace.contextItems,
    workspace.automaticContextItems,
  );
  const composerHasSuggestions =
    detailTask === null && hasComposerSuggestions(workspace);

  if (mode === "wide") {
    return (
      <box
        style={{
          flexDirection: "row",
          flexGrow: 1,
          gap: 2,
          height: "100%",
          padding: 1,
          width: "100%",
        }}
      >
        <box style={{ flexDirection: "column", gap: 1, width: "36%" }}>
          <text>Clutch0</text>
          <ContextHotkeys
            contextItems={contextItems}
            focusedContextItemId={workspace.focusedContextItemId}
            showItemActions={detailTask === null}
          />
          <ContextItemsList
            contextItems={contextItems}
            focusedContextItemId={workspace.focusedContextItemId}
          />
        </box>
        <box
          style={{
            flexDirection: "column",
            flexGrow: 1,
            gap: 1,
            height: "100%",
            width: "64%",
          }}
        >
          <box style={{ flexDirection: "column", height: detailTask ? 7 : 10 }}>
            <FocusedContextItemSummary
              contextItems={contextItems}
              focusedContextItemId={workspace.focusedContextItemId}
            />
          </box>
          {detailTask === null ? (
            <MessageComposer
              composeScreen={workspace}
              filePaths={filePaths}
              suggestionHeight={8}
            />
          ) : (
            <DetailPane task={detailTask} />
          )}
        </box>
      </box>
    );
  }

  if (mode === "medium") {
    const summaryHeight = composerHasSuggestions ? 4 : 5;
    const inputHeight = composerHasSuggestions ? 3 : 4;
    const suggestionHeight = composerHasSuggestions ? 5 : undefined;
    const contextHeight = Math.max(
      3,
      Math.min(
        detailTask === null ? 10 : 8,
        terminalHeight -
          12 -
          summaryHeight -
          inputHeight -
          (suggestionHeight === undefined ? 0 : suggestionHeight + 1),
      ),
    );

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
        <text>Clutch0</text>
        <ContextHotkeys
          contextItems={contextItems}
          focusedContextItemId={workspace.focusedContextItemId}
          showItemActions={detailTask === null}
        />
        <box style={{ flexDirection: "column", height: contextHeight }}>
          <ContextItemsList
            columns={2}
            contextItems={contextItems}
            focusedContextItemId={workspace.focusedContextItemId}
          />
        </box>
        <box style={{ flexDirection: "column", height: summaryHeight }}>
          <FocusedContextItemSummary
            contextItems={contextItems}
            focusedContextItemId={workspace.focusedContextItemId}
          />
        </box>
        {detailTask === null ? (
          <MessageComposer
            composeScreen={workspace}
            filePaths={filePaths}
            inputHeight={inputHeight}
            suggestionHeight={suggestionHeight}
          />
        ) : (
          <DetailPane task={detailTask} />
        )}
      </box>
    );
  }

  const compactSuggestionHeight = composerHasSuggestions ? 4 : undefined;
  const compactInputHeight = 2;
  const compactSummaryHeight = 3;
  const compactContextHeight = Math.max(
    2,
    terminalHeight -
      10 -
      compactSummaryHeight -
      compactInputHeight -
      (compactSuggestionHeight === undefined ? 0 : compactSuggestionHeight + 1),
  );

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
      <text>Clutch0</text>
      <ContextHotkeys
        contextItems={contextItems}
        focusedContextItemId={workspace.focusedContextItemId}
        showItemActions={detailTask === null}
      />
      <box style={{ flexDirection: "column", height: compactContextHeight }}>
        <ContextItemsList
          contextItems={contextItems}
          focusedContextItemId={workspace.focusedContextItemId}
        />
      </box>
      <box style={{ flexDirection: "column", height: compactSummaryHeight }}>
        <FocusedContextItemSummary
          contextItems={contextItems}
          focusedContextItemId={workspace.focusedContextItemId}
        />
      </box>
      <MessageComposer
        composeScreen={workspace}
        filePaths={filePaths}
        inputHeight={compactInputHeight}
        suggestionHeight={compactSuggestionHeight}
      />
    </box>
  );
}

function ContextHotkeys({
  contextItems,
  focusedContextItemId,
  showItemActions,
}: {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  showItemActions: boolean;
}) {
  const focusedItem =
    contextItems.find((item) => item.id === focusedContextItemId) ?? null;
  const hotkeys = [
    "↑/↓ focus",
    ...(showItemActions
      ? (focusedItem?.getActions().map(formatContextItemAction) ?? [])
      : []),
  ].join(" · ");

  return <text style={{ fg: "gray" }}>{hotkeys}</text>;
}

function isFocusedDetailTakingKeyboard({
  detailTask,
  workspace,
}: {
  detailTask: Extract<AppTask, { kind: "context-item-viewer" | "response" }>;
  workspace: WorkspaceState;
}): boolean {
  if (detailTask.kind !== "context-item-viewer") {
    return false;
  }

  const item = getVisibleContextItemById(
    workspace.contextItems,
    detailTask.itemId,
    workspace.automaticContextItems,
  );

  return (
    item instanceof PiAgentContextItem || item instanceof UserTextContextItem
  );
}

function hasComposerSuggestions(workspace: WorkspaceState): boolean {
  const { cursorPosition, message } = workspace.composer;
  if (
    getFileSelectorMatchAtCursor(message, cursorPosition) !== NoFileSelector
  ) {
    return true;
  }

  return (
    getSlashCommandSelectorMatchAtCursor(message, cursorPosition) !==
    NoSlashCommandSelector
  );
}

function DetailPane({
  task,
}: {
  task: Extract<AppTask, { kind: "context-item-viewer" | "response" }>;
}) {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, height: "100%" }}>
      {renderTask(task)}
    </box>
  );
}
