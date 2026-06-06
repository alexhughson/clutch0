import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, type ReactNode } from "react";
import type { AppTask, WorkspaceState } from "./app/appTypes";
import { getCtrlCShortcutDecision, isCtrlCKey } from "./app/ctrlCShortcut";
import { renderTask } from "./app/taskRegistry";
import { getWorkspaceLayout, type WorkspaceLayoutMode } from "./app/layout";
import {
  canUseContextListKeyboardWithPane,
  isWorkspacePaneTask,
} from "./app/taskPresentation";
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
  const paneTask = isWorkspacePaneTask(activeTask) ? activeTask : null;
  const lastBaseCtrlCAt = useRef<number | null>(null);
  const layout = getWorkspaceLayout({
    hasPaneTask: paneTask !== null,
    height,
    width,
  });

  useEffect(() => {
    actions.contextSummaries.ensureWorkspaceSummaries();
  }, [actions]);

  useKeyboard((event) => {
    if (!isCtrlCKey(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    const decision = getCtrlCShortcutDecision({
      activeTask,
      lastBaseCtrlCAt: lastBaseCtrlCAt.current,
      now,
    });

    if (decision === "close-task") {
      lastBaseCtrlCAt.current = null;
      actions.navigation.dismissPane();
      return;
    }

    if (decision === "exit") {
      process.exit(0);
    }

    lastBaseCtrlCAt.current = decision === "arm-exit" ? now : null;
  });

  useKeyboard((event) => {
    if (paneTask === null || !canUseContextListKeyboardWithPane(paneTask)) {
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
    if (paneTask === null || !canUseContextListKeyboardWithPane(paneTask)) {
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

  if (activeTask !== null && paneTask === null) {
    return (
      <AppRoot height={height} width={width}>
        {renderTask(activeTask)}
      </AppRoot>
    );
  }

  if (paneTask !== null && layout.paneTakesOver) {
    return (
      <AppRoot height={height} width={width}>
        {renderTask(paneTask)}
      </AppRoot>
    );
  }

  return (
    <AppRoot height={height} width={width}>
      <WorkspaceLayout
        paneTask={paneTask}
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
  paneTask,
  filePaths,
  mode,
  terminalHeight,
  workspace,
}: {
  paneTask: AppTask | null;
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
    paneTask === null && hasComposerSuggestions(workspace);

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
        <box
          style={{
            flexDirection: "column",
            gap: 1,
            height: "100%",
            minHeight: 0,
            width: "36%",
          }}
        >
          <text>Clutch0</text>
          <ContextHotkeys
            contextItems={contextItems}
            focusedContextItemId={workspace.focusedContextItemId}
            showItemActions={paneTask === null}
          />
          <box style={{ flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
            <ContextItemsList
              contextItems={contextItems}
              focusedContextItemId={workspace.focusedContextItemId}
            />
          </box>
          <box style={{ flexDirection: "column", flexShrink: 0, height: 7 }}>
            <FocusedContextItemSummary
              contextItems={contextItems}
              focusedContextItemId={workspace.focusedContextItemId}
            />
          </box>
        </box>
        <box
          style={{
            flexDirection: "column",
            flexGrow: 1,
            height: "100%",
            minHeight: 0,
            width: "64%",
          }}
        >
          {paneTask === null ? (
            <MessageComposer
              composeScreen={workspace}
              filePaths={filePaths}
              suggestionHeight={8}
            />
          ) : (
            <CommandPane task={paneTask} />
          )}
        </box>
      </box>
    );
  }

  if (mode === "medium") {
    const summaryHeight = composerHasSuggestions ? 6 : 7;
    const inputHeight = composerHasSuggestions ? 3 : 4;
    const suggestionHeight = composerHasSuggestions ? 5 : undefined;
    const contextHeight = Math.max(
      3,
      Math.min(
        paneTask === null ? 10 : 8,
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
          showItemActions={paneTask === null}
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
        {paneTask === null ? (
          <MessageComposer
            composeScreen={workspace}
            filePaths={filePaths}
            inputHeight={inputHeight}
            suggestionHeight={suggestionHeight}
          />
        ) : (
          <CommandPane task={paneTask} />
        )}
      </box>
    );
  }

  const compactSuggestionHeight = composerHasSuggestions ? 4 : undefined;
  const compactInputHeight = 2;
  const compactSummaryHeight = 5;
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
        showItemActions={paneTask === null}
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

function CommandPane({ task }: { task: AppTask }) {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, height: "100%" }}>
      {renderTask(task)}
    </box>
  );
}
