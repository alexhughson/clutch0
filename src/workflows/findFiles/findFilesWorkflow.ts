import { ContextDeck } from "../../app/contextDeck";
import { applyAgentOutputUpdate } from "../../lib/agentOutput/agentOutputReducer";
import type {
  AppActions,
  AppState,
  RelevantFileCandidate,
  WorkspaceState,
} from "../../app/appTypes";
import { createFileContextItem } from "../../lib/context/contextItems";

const MAX_SEARCH_ACTIVITY_LINES = 200;

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

export function createFindFilesActions({
  set,
}: {
  set: SetAppState;
}): AppActions["findFiles"] {
  return {
    addAllCandidates: () => set(addAllCandidates),
    addSelectedCandidate: () => set(addSelectedCandidate),
    fail: ({ errorMessage }) =>
      set((state) =>
        state.activeTask?.kind === "find-files"
          ? {
              activeTask: {
                ...state.activeTask,
                errorMessage,
                status: "error",
              },
            }
          : state,
      ),
    finish: ({ candidates }) =>
      set((state) =>
        state.activeTask?.kind === "find-files"
          ? {
              activeTask: {
                ...state.activeTask,
                candidates,
                selectedIndex: 0,
                status: "results",
              },
            }
          : state,
      ),
    recordAgentOutput: ({ update }) =>
      set((state) =>
        state.activeTask?.kind === "find-files"
          ? {
              activeTask: {
                ...state.activeTask,
                agentOutput: applyAgentOutputUpdate(
                  state.activeTask.agentOutput,
                  update,
                  { maxBlocks: MAX_SEARCH_ACTIVITY_LINES },
                ),
              },
            }
          : state,
      ),
    selectNext: () => set((state) => selectCandidate(state, "next")),
    selectPrevious: () => set((state) => selectCandidate(state, "previous")),
    showSearch: ({ goal, hints }) =>
      set({
        activeTask: {
          agentOutput: [],
          candidates: [],
          goal,
          hints,
          kind: "find-files",
          selectedIndex: 0,
          status: "searching",
        },
      }),
  };
}

function selectCandidate(
  state: AppState,
  direction: "next" | "previous",
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "find-files" ||
    state.activeTask.status !== "results" ||
    state.activeTask.candidates.length === 0
  ) {
    return state;
  }

  const offset = direction === "next" ? 1 : -1;
  return {
    activeTask: {
      ...state.activeTask,
      selectedIndex:
        (state.activeTask.selectedIndex +
          offset +
          state.activeTask.candidates.length) %
        state.activeTask.candidates.length,
    },
  };
}

function addSelectedCandidate(state: AppState): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "find-files" ||
    state.activeTask.status !== "results"
  ) {
    return state;
  }

  const candidate = state.activeTask.candidates[state.activeTask.selectedIndex];
  if (candidate === undefined) {
    return state;
  }

  return {
    activeTask: null,
    workspace: clearComposer(
      addCandidatesToWorkspace(state.workspace, [candidate]),
    ),
  };
}

function addAllCandidates(state: AppState): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "find-files" ||
    state.activeTask.status !== "results"
  ) {
    return state;
  }

  return {
    activeTask: null,
    workspace: clearComposer(
      addCandidatesToWorkspace(state.workspace, state.activeTask.candidates),
    ),
  };
}

function addCandidatesToWorkspace(
  workspace: WorkspaceState,
  candidates: readonly RelevantFileCandidate[],
) {
  let deck = ContextDeck.fromComposeScreen(workspace);
  for (const candidate of candidates) {
    deck = deck.add(createFileContextItem(candidate.path));
  }

  return deck.applyTo(workspace);
}

function clearComposer(workspace: WorkspaceState): WorkspaceState {
  return {
    ...workspace,
    composer: {
      cursorPosition: 0,
      message: "",
    },
  };
}
