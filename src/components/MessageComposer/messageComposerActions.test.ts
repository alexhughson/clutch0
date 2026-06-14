import type { KeyEvent } from "@opentui/core";
import { expect, test } from "bun:test";
import { createInitialAppState } from "../../app/appInitialState";
import { useAppStore } from "../../store/appStore";
import { handleMessageComposerKeyDown } from "./messageComposerActions";

test("submitting clears the composer and reject restores the submitted draft", () => {
  const actions = useAppStore.getState().actions;
  const message = "/show-context inspect current state";
  useAppStore.setState({
    ...createInitialAppState(),
    actions,
    workspace: {
      ...createInitialAppState().workspace,
      composer: {
        cursorPosition: message.length,
        message,
      },
    },
  });

  handleMessageComposerKeyDown({
    event: enterKeyEvent(),
    filePaths: [],
    highlightedCommandName: null,
    highlightedFilePath: null,
    setHighlightedCommandName: () => {},
    setHighlightedFilePath: () => {},
  });

  expect(useAppStore.getState().workspace.composer).toEqual({
    cursorPosition: 0,
    message: "",
  });
  expect(useAppStore.getState().activeTask).toMatchObject({
    kind: "show-context",
    rejectComposer: {
      cursorPosition: message.length,
      message,
    },
  });

  useAppStore.getState().actions.navigation.rejectToEdit();

  expect(useAppStore.getState().activeTask).toBeNull();
  expect(useAppStore.getState().workspace.composer).toEqual({
    cursorPosition: message.length,
    message,
  });
});

function enterKeyEvent(): KeyEvent {
  return {
    ctrl: false,
    hyper: false,
    meta: false,
    name: "return",
    option: false,
    preventDefault: () => {},
    sequence: "\r",
    shift: false,
    stopPropagation: () => {},
    super: false,
  } as KeyEvent;
}
