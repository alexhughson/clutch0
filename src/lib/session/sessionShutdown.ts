export type SessionShutdownStatus = "exited" | "interrupted";

export type SessionShutdownController = {
  shutdown: (status?: SessionShutdownStatus) => Promise<void>;
};

export type SessionShutdownResources = {
  abortRuntimeWork: () => void;
  closeRecorder: (options: { status: SessionShutdownStatus }) => Promise<void>;
  destroyRenderer: () => void;
  disposeAgentSessions: () => Promise<void> | void;
  reportCleanupFailure?: (error: Error) => void;
  unmountRoot: () => void;
};

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;

export function createSessionShutdownController({
  resources,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
}: {
  resources: SessionShutdownResources;
  timeoutMs?: number;
}): SessionShutdownController {
  let shutdownPromise: Promise<void> | null = null;

  return {
    shutdown(status = "exited") {
      shutdownPromise ??= runShutdown({ resources, status, timeoutMs });
      return shutdownPromise;
    },
  };
}

async function runShutdown({
  resources,
  status,
  timeoutMs,
}: {
  resources: SessionShutdownResources;
  status: SessionShutdownStatus;
  timeoutMs: number;
}) {
  resources.abortRuntimeWork();
  let cleanupError: Error | null = null;
  try {
    const cleanupResult = await withTimeout(
      Promise.allSettled([
        runCleanupTask(() => resources.disposeAgentSessions()),
        runCleanupTask(() => resources.closeRecorder({ status })),
      ]),
      timeoutMs,
    );
    cleanupError = cleanupFailureFromResults(cleanupResult, timeoutMs);
    if (cleanupError !== null) {
      resources.reportCleanupFailure?.(cleanupError);
    }
  } finally {
    resources.unmountRoot();
    resources.destroyRenderer();
  }

  if (cleanupError !== null) {
    throw cleanupError;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

async function runCleanupTask(task: () => Promise<void> | void): Promise<void> {
  await task();
}

function cleanupFailureFromResults(
  results: PromiseSettledResult<unknown>[] | undefined,
  timeoutMs: number,
): Error | null {
  if (results === undefined) {
    return new Error(
      `Session shutdown cleanup timed out after ${timeoutMs}ms.`,
    );
  }

  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length === 0) {
    return null;
  }

  return new Error(
    `Session shutdown cleanup failed: ${failures
      .map((failure) => formatErrorMessage(failure.reason))
      .join("; ")}`,
  );
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
