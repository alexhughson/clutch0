import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { getClutchConfigPaths } from "../config/clutchConfig";
import type { AppSnapshot } from "./sessionSnapshot";

export type SessionMetadata = {
  activeTaskSummary?: string;
  createdAt: number;
  id: string;
  status: "active" | "exited" | "interrupted";
  updatedAt: number;
  workspaceName: string;
  workspaceRoot: string;
};

export type SessionIndex = {
  sessions: SessionMetadata[];
  schemaVersion: 1;
  workspaceRoot: string;
};

export type SessionPaths = {
  eventsPath: string;
  indexPath: string;
  metadataPath: string;
  projectDir: string;
  sessionDir: string;
  snapshotPath: string;
};

export type SessionListEntry = SessionMetadata & {
  errorMessage?: string;
  snapshotReadable: boolean;
};

export async function resolveWorkspaceRoot(
  cwd = process.cwd(),
): Promise<string> {
  return await realpath(resolve(cwd));
}

export function getProjectKey(workspaceRoot: string): string {
  return createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 24);
}

export function getSessionPaths({
  sessionId,
  workspaceRoot,
}: {
  sessionId: string;
  workspaceRoot: string;
}): SessionPaths {
  const projectDir = join(
    getClutchConfigPaths().configDir,
    "sessions",
    getProjectKey(workspaceRoot),
  );
  const sessionDir = join(projectDir, sessionId);

  return {
    eventsPath: join(sessionDir, "events.jsonl"),
    indexPath: join(projectDir, "index.json"),
    metadataPath: join(sessionDir, "metadata.json"),
    projectDir,
    sessionDir,
    snapshotPath: join(sessionDir, "snapshot.json"),
  };
}

export async function createSessionMetadata({
  workspaceRoot,
}: {
  workspaceRoot: string;
}): Promise<SessionMetadata> {
  const now = Date.now();
  return {
    createdAt: now,
    id: createSessionId(now),
    status: "active",
    updatedAt: now,
    workspaceName: basename(workspaceRoot),
    workspaceRoot,
  };
}

export async function initializeSession(
  metadata: SessionMetadata,
): Promise<SessionPaths> {
  const paths = getSessionPaths({
    sessionId: metadata.id,
    workspaceRoot: metadata.workspaceRoot,
  });
  await mkdir(paths.sessionDir, { recursive: true });
  await writeJsonAtomic(paths.metadataPath, metadata);
  await writeSessionIndex(metadata);
  return paths;
}

export async function loadSessionById({
  sessionId,
  workspaceRoot,
}: {
  sessionId: string;
  workspaceRoot: string;
}): Promise<{ metadata: SessionMetadata; snapshot: AppSnapshot }> {
  const paths = getSessionPaths({ sessionId, workspaceRoot });
  if (!existsSync(paths.metadataPath) || !existsSync(paths.snapshotPath)) {
    throw new Error(`No Clutch session "${sessionId}" for ${workspaceRoot}.`);
  }

  const metadata = parseSessionMetadata(
    JSON.parse(await readFile(paths.metadataPath, "utf8")),
  );
  if (metadata.id !== sessionId) {
    throw new Error(
      `Session metadata id ${metadata.id} does not match requested id ${sessionId}.`,
    );
  }
  if (metadata.workspaceRoot !== workspaceRoot) {
    throw new Error(
      `Session "${sessionId}" belongs to ${metadata.workspaceRoot}, not ${workspaceRoot}.`,
    );
  }

  const snapshot = await parseSnapshotFile(paths.snapshotPath);
  assertSnapshotBelongsToWorkspace({ sessionId, snapshot, workspaceRoot });

  return { metadata, snapshot };
}

export async function loadLatestSession({
  workspaceRoot,
}: {
  workspaceRoot: string;
}): Promise<{ metadata: SessionMetadata; snapshot: AppSnapshot }> {
  const sessions = await listSessions({ workspaceRoot });
  const latest = sessions[0];
  if (latest === undefined) {
    throw new Error(`No Clutch sessions for ${workspaceRoot}.`);
  }

  return await loadSessionById({ sessionId: latest.id, workspaceRoot });
}

export async function listSessions({
  workspaceRoot,
}: {
  workspaceRoot: string;
}): Promise<SessionListEntry[]> {
  const paths = getSessionPaths({ sessionId: "unused", workspaceRoot });
  if (!existsSync(paths.indexPath)) {
    return [];
  }

  const index = parseSessionIndex(
    JSON.parse(await readFile(paths.indexPath, "utf8")),
  );
  if (index.workspaceRoot !== workspaceRoot) {
    throw new Error(
      `Session index belongs to ${index.workspaceRoot}, not ${workspaceRoot}.`,
    );
  }

  const entries: SessionListEntry[] = [];
  for (const metadata of index.sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt)) {
    entries.push(await readSessionListEntry({ metadata, workspaceRoot }));
  }

  return entries;
}

export async function writeSessionSnapshot({
  metadata,
  snapshot,
}: {
  metadata: SessionMetadata;
  snapshot: AppSnapshot;
}): Promise<void> {
  const now = Date.now();
  const nextMetadata: SessionMetadata = {
    ...metadata,
    activeTaskSummary: summarizeSnapshot(snapshot),
    updatedAt: now,
  };
  const paths = getSessionPaths({
    sessionId: nextMetadata.id,
    workspaceRoot: nextMetadata.workspaceRoot,
  });
  await mkdir(paths.sessionDir, { recursive: true });
  await writeJsonAtomic(paths.snapshotPath, snapshot);
  await writeJsonAtomic(paths.metadataPath, nextMetadata);
  await writeSessionIndex(nextMetadata);
}

export async function appendSessionEvent({
  event,
  metadata,
}: {
  event: unknown;
  metadata: SessionMetadata;
}): Promise<void> {
  const paths = getSessionPaths({
    sessionId: metadata.id,
    workspaceRoot: metadata.workspaceRoot,
  });
  await mkdir(paths.sessionDir, { recursive: true });
  await appendFile(paths.eventsPath, `${JSON.stringify(event)}\n`);
}

export async function readLastSessionEventSequence(
  metadata: SessionMetadata,
): Promise<number> {
  const paths = getSessionPaths({
    sessionId: metadata.id,
    workspaceRoot: metadata.workspaceRoot,
  });
  if (!existsSync(paths.eventsPath)) {
    return 0;
  }

  const lines = (await readFile(paths.eventsPath, "utf8"))
    .trim()
    .split("\n")
    .reverse();
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      const event = JSON.parse(line) as { seq?: unknown };
      if (typeof event.seq === "number" && Number.isSafeInteger(event.seq)) {
        return event.seq;
      }
    } catch {
      continue;
    }
  }

  return 0;
}

export async function writeJsonAtomic(path: string, value: unknown) {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

function createSessionId(now: number): string {
  const date = new Date(now)
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  return `${date}-${randomUUID().slice(0, 8)}`;
}

async function writeSessionIndex(metadata: SessionMetadata) {
  const paths = getSessionPaths({
    sessionId: metadata.id,
    workspaceRoot: metadata.workspaceRoot,
  });
  await mkdir(paths.projectDir, { recursive: true });
  const existing = existsSync(paths.indexPath)
    ? parseSessionIndex(JSON.parse(await readFile(paths.indexPath, "utf8")))
    : {
        schemaVersion: 1 as const,
        sessions: [],
        workspaceRoot: metadata.workspaceRoot,
      };
  const sessions = [
    metadata,
    ...existing.sessions.filter((session) => session.id !== metadata.id),
  ].sort((a, b) => b.updatedAt - a.updatedAt);

  await writeJsonAtomic(paths.indexPath, {
    schemaVersion: 1,
    sessions,
    workspaceRoot: metadata.workspaceRoot,
  } satisfies SessionIndex);
}

function parseSessionIndex(raw: unknown): SessionIndex {
  const record = assertRecord(raw, "session index");
  if (record.schemaVersion !== 1) {
    throw new Error("Unsupported session index schema version.");
  }

  return {
    schemaVersion: 1,
    sessions: assertArray(record.sessions, "session index sessions").map(
      parseSessionMetadata,
    ),
    workspaceRoot: assertString(record.workspaceRoot, "session index root"),
  };
}

function parseSessionMetadata(raw: unknown): SessionMetadata {
  const record = assertRecord(raw, "session metadata");
  return {
    ...(record.activeTaskSummary === undefined
      ? {}
      : {
          activeTaskSummary: assertString(
            record.activeTaskSummary,
            "session activeTaskSummary",
          ),
        }),
    createdAt: assertNumber(record.createdAt, "session createdAt"),
    id: assertString(record.id, "session id"),
    status: parseSessionStatus(record.status),
    updatedAt: assertNumber(record.updatedAt, "session updatedAt"),
    workspaceName: assertString(record.workspaceName, "session workspaceName"),
    workspaceRoot: assertString(record.workspaceRoot, "session workspaceRoot"),
  };
}

function parseSessionStatus(value: unknown): SessionMetadata["status"] {
  if (value === "active" || value === "exited" || value === "interrupted") {
    return value;
  }

  throw new Error("session status must be active, exited, or interrupted.");
}

function summarizeSnapshot(snapshot: AppSnapshot): string | undefined {
  if (snapshot.activeTask === null) {
    return undefined;
  }

  return snapshot.activeTask.kind;
}

async function parseSnapshotFile(path: string): Promise<AppSnapshot> {
  const { parseAppSnapshot } = await import("./sessionSnapshot");
  return parseAppSnapshot(JSON.parse(await readFile(path, "utf8")));
}

async function readSessionListEntry({
  metadata,
  workspaceRoot,
}: {
  metadata: SessionMetadata;
  workspaceRoot: string;
}): Promise<SessionListEntry> {
  if (metadata.workspaceRoot !== workspaceRoot) {
    return {
      ...metadata,
      errorMessage: `Session belongs to ${metadata.workspaceRoot}.`,
      snapshotReadable: false,
    };
  }

  const paths = getSessionPaths({ sessionId: metadata.id, workspaceRoot });
  if (!existsSync(paths.metadataPath)) {
    return {
      ...metadata,
      errorMessage: "Missing session metadata.",
      snapshotReadable: false,
    };
  }

  if (!existsSync(paths.snapshotPath)) {
    return {
      ...metadata,
      errorMessage: "Missing session snapshot.",
      snapshotReadable: false,
    };
  }

  try {
    const fileMetadata = parseSessionMetadata(
      JSON.parse(await readFile(paths.metadataPath, "utf8")),
    );
    if (fileMetadata.id !== metadata.id) {
      throw new Error(
        `Session metadata id ${fileMetadata.id} does not match index id ${metadata.id}.`,
      );
    }

    if (fileMetadata.workspaceRoot !== workspaceRoot) {
      throw new Error(`Session belongs to ${fileMetadata.workspaceRoot}.`);
    }

    const snapshot = await parseSnapshotFile(paths.snapshotPath);
    assertSnapshotBelongsToWorkspace({
      sessionId: fileMetadata.id,
      snapshot,
      workspaceRoot,
    });

    return { ...fileMetadata, snapshotReadable: true };
  } catch (error) {
    return {
      ...metadata,
      errorMessage: error instanceof Error ? error.message : String(error),
      snapshotReadable: false,
    };
  }
}

function assertSnapshotBelongsToWorkspace({
  sessionId,
  snapshot,
  workspaceRoot,
}: {
  sessionId: string;
  snapshot: AppSnapshot;
  workspaceRoot: string;
}) {
  if (snapshot.workspaceRoot !== workspaceRoot) {
    throw new Error(
      `Session "${sessionId}" snapshot belongs to ${snapshot.workspaceRoot}, not ${workspaceRoot}.`,
    );
  }
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function assertArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function assertNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return value;
}
