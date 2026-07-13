import type { AppState } from "../../app/appTypes";
import { getContextItemHistoryEvents } from "../context/contextItemRegistry";
import type { ContextItem, SessionEvent } from "../../types";
import {
  serializeAppSnapshot,
  serializeInterruptedAppSnapshot,
} from "./sessionSnapshot";
import {
  appendSessionEvent,
  readLastSessionEventSequence,
  writeSessionSnapshot,
  type SessionMetadata,
} from "./sessionStorage";

export type SessionRecorder = {
  close: (options?: { status?: SessionMetadata["status"] }) => Promise<void>;
  flush: () => Promise<void>;
  recordRuntimeEvent: (event: Record<string, unknown>) => void;
  recordStateChange: (options: {
    actionName?: string;
    previousState: AppState;
    state: AppState;
  }) => void;
};

const SNAPSHOT_DEBOUNCE_MS = 250;

export function createSessionRecorder({
  getState,
  metadata,
  workspaceRoot,
}: {
  getState: () => AppState;
  metadata: SessionMetadata;
  workspaceRoot: string;
}): SessionRecorder {
  let currentMetadata = metadata;
  let flushPromise: Promise<void> = Promise.resolve();
  let pendingSnapshot = false;
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  let sequence = 0;
  let sequenceLoaded = false;

  function enqueue(operation: () => Promise<void>) {
    flushPromise = flushPromise.then(operation, operation);
  }

  function recordEvent(event: Record<string, unknown>) {
    enqueue(async () => {
      if (!sequenceLoaded) {
        sequence = await readLastSessionEventSequence(currentMetadata);
        sequenceLoaded = true;
      }

      const sessionEvent = {
        ...event,
        at: Date.now(),
        schemaVersion: 1,
        seq: ++sequence,
        sessionId: currentMetadata.id,
      };
      await appendSessionEvent({
        event: sessionEvent,
        metadata: currentMetadata,
      });
    });
  }

  function scheduleSnapshot() {
    pendingSnapshot = true;
    if (snapshotTimer !== null) {
      return;
    }

    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      void writeLatestSnapshot();
    }, SNAPSHOT_DEBOUNCE_MS);
  }

  async function writeLatestSnapshot({ interrupted = false } = {}) {
    if (!pendingSnapshot) {
      return;
    }

    pendingSnapshot = false;
    const snapshot = interrupted
      ? serializeInterruptedAppSnapshot({ state: getState(), workspaceRoot })
      : serializeAppSnapshot({ state: getState(), workspaceRoot });
    enqueue(async () => {
      await writeSessionSnapshot({ metadata: currentMetadata, snapshot });
      currentMetadata = {
        ...currentMetadata,
        activeTaskSummary: snapshot.activeTask?.kind,
        updatedAt: Date.now(),
      };
    });
    await flushPromise;
  }

  recordEvent({ kind: "session.started" });
  scheduleSnapshot();

  return {
    async close({ status = "exited" } = {}) {
      if (snapshotTimer !== null) {
        clearTimeout(snapshotTimer);
        snapshotTimer = null;
      }

      currentMetadata = { ...currentMetadata, status };
      pendingSnapshot = true;
      await writeLatestSnapshot({ interrupted: true });
      recordEvent({ kind: "session.closed", status });
      await flushPromise;
    },
    async flush() {
      if (snapshotTimer !== null) {
        clearTimeout(snapshotTimer);
        snapshotTimer = null;
      }

      await writeLatestSnapshot();
      await flushPromise;
    },
    recordRuntimeEvent(event) {
      recordEvent({ kind: "runtime.event", ...event });
    },
    recordStateChange({ actionName, previousState, state }) {
      const previousSnapshot = serializeAppSnapshot({
        state: previousState,
        workspaceRoot,
      });
      const snapshot = serializeAppSnapshot({ state, workspaceRoot });
      recordEvent({
        actionName,
        after: snapshot,
        before: previousSnapshot,
        kind: "state.mutation",
        previousHash: hashSerializedState(previousState),
        stateHash: hashSerializedState(state),
      });

      for (const event of collectContextItemEvents({
        previousItems: previousState.workspace.contextItems,
        nextItems: state.workspace.contextItems,
      })) {
        recordEvent({ kind: "context-item.event", itemEvent: event });
      }

      scheduleSnapshot();
    },
  };
}

function collectContextItemEvents({
  nextItems,
  previousItems,
}: {
  nextItems: readonly ContextItem[];
  previousItems: readonly ContextItem[];
}): readonly SessionEvent[] {
  const previousById = new Map(
    previousItems.map((item) => [item.id, item] as const),
  );
  const nextIds = new Set(nextItems.map((item) => item.id));
  const events = nextItems.flatMap((item) =>
    getContextItemHistoryEvents(item, previousById.get(item.id) ?? null),
  );

  for (const previous of previousItems) {
    if (!nextIds.has(previous.id)) {
      events.push({
        at: Date.now(),
        details: { type: previous.type },
        itemId: previous.id,
        kind: "context-item.removed",
        schemaVersion: 1,
      });
    }
  }

  return events;
}

function hashSerializedState(state: AppState): string {
  const text = JSON.stringify({
    activeTask: state.activeTask,
    nextContextItemId: state.nextContextItemId,
    nextLlmRequestId: state.nextLlmRequestId,
    workspace: {
      composer: state.workspace.composer,
      contextItemIds: state.workspace.contextItems.map((item) => item.id),
      focusedContextItemId: state.workspace.focusedContextItemId,
    },
  });
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}
