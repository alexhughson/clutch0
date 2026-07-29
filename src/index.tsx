#!/usr/bin/env bun

import { parseSessionCliArgs } from "./lib/session/sessionCli";
import {
  BASE_CTRL_C_EXIT_INTERVAL_MS,
  isRawCtrlCSequence,
} from "./app/ctrlCShortcut";
import type { AppActions } from "./app/appTypes";
import type { AppSnapshot } from "./lib/session/sessionSnapshot";
import type {
  SessionListEntry,
  SessionMetadata,
} from "./lib/session/sessionStorage";

async function main() {
  const command = parseSessionCliArgs(process.argv.slice(2));
  const {
    createSessionMetadata,
    appendSessionEvent,
    initializeSession,
    listSessions,
    loadLatestSession,
    loadSessionById,
    readLastSessionEventSequence,
    resolveWorkspaceRoot,
    writeSessionSnapshot,
  } = await import("./lib/session/sessionStorage");

  const workspaceRoot = await resolveWorkspaceRoot();

  if (command.kind === "list") {
    const sessions = await listSessions({ workspaceRoot });
    if (sessions.length === 0) {
      console.log(`No Clutch sessions for ${workspaceRoot}.`);
      return;
    }

    console.log(formatSessionList(sessions));
    return;
  }

  const session =
    command.kind === "resume"
      ? command.sessionId === undefined
        ? await loadLatestSession({ workspaceRoot })
        : await loadSessionById({
            sessionId: command.sessionId,
            workspaceRoot,
          })
      : {
          metadata: await createSessionMetadata({ workspaceRoot }),
          snapshot: null,
        };

  const activeMetadata = { ...session.metadata, status: "active" as const };
  await initializeSession(activeMetadata);
  let startupInterrupted = false;
  const markStartupInterrupted = () => {
    startupInterrupted = true;
    process.exitCode = 130;
  };
  process.on("SIGINT", markStartupInterrupted);
  process.on("SIGTERM", markStartupInterrupted);
  process.chdir(session.metadata.workspaceRoot);

  let shutdownStarted = false;
  let closeInitializedSession = async () => {
    await recordStartupFailureSession({
      appendSessionEvent,
      metadata: activeMetadata,
      readLastSessionEventSequence,
      session,
      workspaceRoot: session.metadata.workspaceRoot,
      writeSessionSnapshot,
    });
  };

  try {
    const { createCliRenderer } = await import("@opentui/core");
    const { createRoot } = await import("@opentui/react");

    const [
      { App },
      { createInitialAppState },
      { isClutchConfigured },
      { loadFileList },
      { createSessionRecorder },
      { restoreAppStateFromSnapshot },
      { createSessionShutdownController },
      { hydrateAppStore, setSessionRecorder, useAppStore },
      { abortRuntimeWork },
      { releaseAllAgentHandles },
    ] = await Promise.all([
      import("./App"),
      import("./app/appInitialState"),
      import("./lib/config/clutchConfig"),
      import("./lib/fileListLoader"),
      import("./lib/session/sessionRecorder"),
      import("./lib/session/sessionSnapshot"),
      import("./lib/session/sessionShutdown"),
      import("./store/appStore"),
      import("./lib/session/runtimeInterrupts"),
      import("./workflows/agentAsk/agentAskSessionRegistry"),
    ]);

    if (startupInterrupted) {
      await closeInitializedSession();
      return;
    }

    hydrateAppStore(
      session.snapshot === null
        ? createInitialAppState()
        : restoreAppStateFromSnapshot(session.snapshot),
    );

    const recorder = createSessionRecorder({
      getState: useAppStore.getState,
      metadata: activeMetadata,
      workspaceRoot: session.metadata.workspaceRoot,
    });
    setSessionRecorder(recorder);
    closeInitializedSession = async () => {
      setSessionRecorder(null);
      await recorder.close({ status: "interrupted" });
    };

    let renderer: Awaited<ReturnType<typeof createCliRenderer>> | null = null;
    let root: ReturnType<typeof createRoot> | null = null;

    const shutdownController = createSessionShutdownController({
      resources: {
        abortRuntimeWork,
        closeRecorder: async ({ status }) => {
          setSessionRecorder(null);
          await recorder.close({ status });
        },
        destroyRenderer: () => {
          renderer?.destroy();
        },
        disposeAgentSessions: releaseAllAgentHandles,
        reportCleanupFailure: (error) => {
          process.exitCode = 1;
          console.error(error.message);
        },
        unmountRoot: () => {
          root?.unmount();
        },
      },
    });
    closeInitializedSession = async () => {
      setSessionRecorder(null);
      await shutdownController.shutdown("interrupted");
    };

    async function shutdown(status: "exited" | "interrupted" = "exited") {
      if (shutdownStarted) {
        return;
      }

      shutdownStarted = true;
      await shutdownController.shutdown(status);
    }

    process.removeListener("SIGINT", markStartupInterrupted);
    process.removeListener("SIGTERM", markStartupInterrupted);

    process.on("SIGINT", () => {
      void shutdown("interrupted");
    });
    process.on("SIGTERM", () => {
      void shutdown("interrupted");
    });

    if (startupInterrupted) {
      await shutdown("interrupted");
      return;
    }

    const filePaths = await loadFileList({
      root: session.metadata.workspaceRoot,
    });
    if (shutdownStarted) {
      return;
    }
    if (!isClutchConfigured()) {
      useAppStore.getState().actions.config.openSetup();
    }

    let lastRawCtrlCAt: number | null = null;
    const handleRawCtrlCInput = (sequence: string) => {
      if (!isRawCtrlCSequence(sequence)) {
        return false;
      }

      const now = Date.now();
      const shouldExit =
        lastRawCtrlCAt !== null &&
        now >= lastRawCtrlCAt &&
        now - lastRawCtrlCAt <= BASE_CTRL_C_EXIT_INTERVAL_MS;
      lastRawCtrlCAt = now;
      if (!shouldExit) {
        return false;
      }

      void shutdown("interrupted");
      return true;
    };

    renderer = await createCliRenderer({
      exitOnCtrlC: false,
      onDestroy: () => {
        process.exit(process.exitCode ?? 0);
      },
      prependInputHandlers: [handleRawCtrlCInput],
    });
    if (shutdownStarted) {
      renderer.destroy();
      return;
    }
    root = createRoot(renderer);

    root.render(
      <App filePaths={filePaths} onExit={() => void shutdown("exited")} />,
    );
  } catch (error) {
    process.removeListener("SIGINT", markStartupInterrupted);
    process.removeListener("SIGTERM", markStartupInterrupted);
    if (!shutdownStarted) {
      try {
        process.exitCode = process.exitCode ?? 1;
        await closeInitializedSession();
      } catch (closeError) {
        console.error(
          `Failed to close startup session: ${closeError instanceof Error ? closeError.message : String(closeError)}`,
        );
      }
    }
    throw error;
  }
}

function formatSessionList(sessions: readonly SessionListEntry[]): string {
  return sessions
    .map((session) => {
      const status = session.snapshotReadable ? session.status : "broken";
      const updatedAt = new Date(session.updatedAt).toLocaleString();
      const summary =
        session.errorMessage === undefined
          ? (session.activeTaskSummary ?? "workspace")
          : `${session.activeTaskSummary ?? "workspace"} (${session.errorMessage})`;
      return `${session.id}\t${status}\t${updatedAt}\t${summary}`;
    })
    .join("\n");
}

async function recordStartupFailureSession({
  appendSessionEvent,
  metadata,
  readLastSessionEventSequence,
  session,
  workspaceRoot,
  writeSessionSnapshot,
}: {
  appendSessionEvent: (options: {
    event: unknown;
    metadata: SessionMetadata;
  }) => Promise<void>;
  metadata: SessionMetadata;
  readLastSessionEventSequence: (metadata: SessionMetadata) => Promise<number>;
  session: { snapshot: AppSnapshot | null };
  workspaceRoot: string;
  writeSessionSnapshot: (options: {
    metadata: SessionMetadata;
    snapshot: AppSnapshot;
  }) => Promise<void>;
}) {
  const interruptedMetadata = { ...metadata, status: "interrupted" as const };
  try {
    const [{ createInitialAppState }, snapshotModule] = await Promise.all([
      import("./app/appInitialState"),
      import("./lib/session/sessionSnapshot"),
    ]);
    const snapshot =
      session.snapshot === null
        ? snapshotModule.serializeInterruptedAppSnapshot({
            state: {
              ...createInitialAppState(),
              actions: {} as AppActions,
            },
            workspaceRoot,
          })
        : snapshotModule.serializeInterruptedAppSnapshot({
            state: {
              ...snapshotModule.restoreAppStateFromSnapshot(
                snapshotModule.parseAppSnapshot(session.snapshot),
              ),
              actions: {} as AppActions,
            },
            workspaceRoot,
          });
    await writeSessionSnapshot({
      metadata: interruptedMetadata,
      snapshot,
    });
  } catch {
    await import("./lib/session/sessionStorage").then(({ initializeSession }) =>
      initializeSession(interruptedMetadata),
    );
  }

  const previousSeq = await readLastSessionEventSequence(interruptedMetadata);
  await appendSessionEvent({
    event: {
      at: Date.now(),
      kind: "session.closed",
      schemaVersion: 1,
      seq: previousSeq + 1,
      sessionId: interruptedMetadata.id,
      status: "interrupted",
    },
    metadata: interruptedMetadata,
  });
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
}
