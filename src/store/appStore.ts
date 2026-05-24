import { create } from "zustand";
import type { PatchReviewState } from "../lib/patch/types";
import type { FilePath } from "../types";

export type AppScreen =
  | ComposeScreenState
  | {
      name: "response";
      request: LlmRequestState;
      returnToCompose: ComposeScreenState;
    };

export type LlmRequestStatus = "loading" | "streaming" | "done" | "error";

type LlmRequestBase = {
  filePaths: FilePath[];
  id: number;
  patch?: PatchReviewState;
  question: string;
  responseText: string;
};

type InProgressLlmRequestState = LlmRequestBase & {
  status: "loading" | "streaming";
};

type CompletedLlmRequestState = LlmRequestBase & {
  status: "done";
};

type FailedLlmRequestState = LlmRequestBase & {
  errorMessage: string;
  status: "error";
};

export type LlmRequestState =
  | InProgressLlmRequestState
  | CompletedLlmRequestState
  | FailedLlmRequestState;

export type ComposerState = {
  cursorPosition: number;
  message: string;
};

export type ComposeScreenState = {
  composer: ComposerState;
  name: "compose";
  selectedFilePaths: FilePath[];
};

export type AppState = {
  actions: AppActions;
  nextLlmRequestId: number;
  screen: AppScreen;
};

type AppActions = {
  compose: {
    acceptFileSelection: (options: {
      cursorPosition: number;
      filePath: FilePath;
      message: string;
    }) => void;
    setComposerState: (composerState: ComposerState) => void;
    startLlmRequest: (options: { question: string }) => number | null;
  };
  navigation: {
    clearResponseAndMessage: () => void;
    rejectResponse: () => void;
    showComposer: () => void;
  };
  response: {
    appendDelta: (options: { delta: string; requestId: number }) => void;
    fail: (options: { errorMessage: string; requestId: number }) => void;
    failPatchApply: (options: {
      errorMessage: string;
      requestId: number;
    }) => void;
    finish: (options: { requestId: number; responseText: string }) => void;
    finishPatchApply: (options: { requestId: number }) => void;
    setPatch: (options: { patch: PatchReviewState; requestId: number }) => void;
    startPatchApply: (options: { requestId: number }) => void;
  };
};

export const useAppStore = create<AppState>((set, get) => ({
  actions: {
    compose: {
      acceptFileSelection: ({ cursorPosition, filePath, message }) =>
        set((state) => {
          if (state.screen.name !== "compose") {
            return state;
          }

          return {
            screen: {
              ...state.screen,
              composer: {
                cursorPosition,
                message,
              },
              selectedFilePaths: state.screen.selectedFilePaths.includes(
                filePath,
              )
                ? state.screen.selectedFilePaths
                : [...state.screen.selectedFilePaths, filePath],
            },
          };
        }),
      setComposerState: (composer) =>
        set((state) =>
          state.screen.name === "compose"
            ? {
                screen: {
                  ...state.screen,
                  composer,
                },
              }
            : state,
        ),
      startLlmRequest: ({ question }) => {
        const state = get();

        if (state.screen.name !== "compose") {
          return null;
        }

        const requestId = state.nextLlmRequestId;
        const filePaths = [...state.screen.selectedFilePaths];

        set({
          nextLlmRequestId: requestId + 1,
          screen: {
            name: "response",
            request: {
              filePaths,
              id: requestId,
              question,
              responseText: "",
              status: "loading",
            },
            returnToCompose: state.screen,
          },
        });

        return requestId;
      },
    },
    navigation: {
      clearResponseAndMessage: () =>
        set((state) =>
          state.screen.name === "response"
            ? {
                screen: {
                  ...state.screen.returnToCompose,
                  composer: {
                    cursorPosition: 0,
                    message: "",
                  },
                },
              }
            : state,
        ),
      rejectResponse: () =>
        set((state) =>
          state.screen.name === "response"
            ? {
                screen: {
                  ...state.screen.returnToCompose,
                  composer: {
                    cursorPosition: 0,
                    message: "",
                  },
                },
              }
            : state,
        ),
      showComposer: () =>
        set((state) =>
          state.screen.name === "response"
            ? { screen: state.screen.returnToCompose }
            : state,
        ),
    },
    response: {
      appendDelta: ({ delta, requestId }) =>
        set((state) =>
          isActiveInProgressLlmRequest(state, requestId)
            ? setActiveLlmRequest(state, {
                ...state.screen.request,
                responseText: state.screen.request.responseText + delta,
                status: "streaming",
              })
            : state,
        ),
      fail: ({ errorMessage, requestId }) =>
        set((state) =>
          isActiveInProgressLlmRequest(state, requestId)
            ? setActiveLlmRequest(state, {
                ...state.screen.request,
                errorMessage,
                status: "error",
              })
            : state,
        ),
      failPatchApply: ({ errorMessage, requestId }) =>
        set((state) => {
          const request = getActiveLlmRequest(state, requestId);
          if (request?.patch === undefined) {
            return state;
          }

          return setActiveLlmRequest(state, {
            ...request,
            patch: {
              ...request.patch,
              applyErrorMessage: errorMessage,
              applyStatus: "apply-error",
            },
          });
        }),
      finish: ({ requestId, responseText }) =>
        set((state) =>
          isActiveInProgressLlmRequest(state, requestId)
            ? setActiveLlmRequest(state, {
                ...state.screen.request,
                responseText,
                status: "done",
              })
            : state,
        ),
      finishPatchApply: ({ requestId }) =>
        set((state) => {
          const request = getActiveLlmRequest(state, requestId);
          if (request?.patch === undefined) {
            return state;
          }

          return setActiveLlmRequest(state, {
            ...request,
            patch: {
              ...request.patch,
              applyErrorMessage: undefined,
              applyStatus: "applied",
            },
          });
        }),
      setPatch: ({ patch, requestId }) =>
        set((state) => {
          const request = getActiveLlmRequest(state, requestId);
          if (request === null) {
            return state;
          }

          return setActiveLlmRequest(state, {
            ...request,
            patch,
          });
        }),
      startPatchApply: ({ requestId }) =>
        set((state) => {
          const request = getActiveLlmRequest(state, requestId);
          if (request?.patch === undefined) {
            return state;
          }

          return setActiveLlmRequest(state, {
            ...request,
            patch: {
              ...request.patch,
              applyErrorMessage: undefined,
              applyStatus: "applying",
            },
          });
        }),
    },
  },
  nextLlmRequestId: 1,
  screen: createInitialComposeScreen(),
}));

function isActiveInProgressLlmRequest(
  state: AppState,
  requestId: number,
): state is AppState & {
  screen: { name: "response"; request: InProgressLlmRequestState };
} {
  return (
    state.screen.name === "response" &&
    state.screen.request.id === requestId &&
    (state.screen.request.status === "loading" ||
      state.screen.request.status === "streaming")
  );
}

function getActiveLlmRequest(
  state: AppState,
  requestId: number,
): LlmRequestState | null {
  return state.screen.name === "response" &&
    state.screen.request.id === requestId
    ? state.screen.request
    : null;
}

function setActiveLlmRequest(
  state: AppState,
  request: LlmRequestState,
): AppState | Pick<AppState, "screen"> {
  if (state.screen.name !== "response") {
    return state;
  }

  return {
    screen: {
      ...state.screen,
      name: "response",
      request,
    },
  };
}

function createInitialComposeScreen(): ComposeScreenState {
  return {
    composer: {
      cursorPosition: 0,
      message: "",
    },
    name: "compose",
    selectedFilePaths: [],
  };
}
