import type { RelevantFileCandidate } from "../../app/appTypes";
import type { ContextItem } from "../../types";
import { recordSessionRuntimeEvent } from "../../store/appStore";

export function recordFindFilesStartedRuntimeEvent({
  contextItems,
  focusedContextItemId,
  goal,
  hints,
}: {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  goal: string;
  hints: readonly string[];
}) {
  recordSessionRuntimeEvent({
    contextItemIds: contextItems.map((item) => item.id),
    focusedContextItemId,
    goal,
    hintCount: hints.length,
    kind: "find-files.started",
  });
}

export function recordFindFilesFinishedRuntimeEvent({
  candidates,
  goal,
}: {
  candidates: readonly RelevantFileCandidate[];
  goal: string;
}) {
  recordSessionRuntimeEvent({
    candidateCount: candidates.length,
    goal,
    kind: "find-files.finished",
  });
}

export function recordFindFilesFailedRuntimeEvent({
  error,
  goal,
}: {
  error: unknown;
  goal: string;
}) {
  recordSessionRuntimeEvent({
    errorMessage: error instanceof Error ? error.message : String(error),
    goal,
    kind: "find-files.failed",
  });
}
