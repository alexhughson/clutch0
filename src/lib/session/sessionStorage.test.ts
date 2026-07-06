import { afterEach, test, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AppState } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import { serializeAppSnapshot } from "./sessionSnapshot";
import {
  createSessionMetadata,
  getProjectKey,
  getSessionPaths,
  initializeSession,
  listSessions,
  loadLatestSession,
  loadSessionById,
  resolveWorkspaceRoot,
  writeSessionSnapshot,
} from "./sessionStorage";

const originalConfigDir = process.env.CLUTCH_CONFIG_DIR;
const tempRoots: string[] = [];

afterEach(async () => {
  if (originalConfigDir === undefined) {
    delete process.env.CLUTCH_CONFIG_DIR;
  } else {
    process.env.CLUTCH_CONFIG_DIR = originalConfigDir;
  }

  await Promise.all(
    tempRoots
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

test("stores, lists, and loads project-scoped sessions", async () => {
  const configDir = await tempDir("clutch-session-config-");
  const workspaceRoot = await resolveWorkspaceRoot(
    await tempDir("clutch-session-root-"),
  );
  process.env.CLUTCH_CONFIG_DIR = configDir;

  const metadata = await createSessionMetadata({ workspaceRoot });
  await initializeSession(metadata);
  const state: AppState = {
    ...createInitialAppState(),
    actions: {} as AppState["actions"],
  };
  await writeSessionSnapshot({
    metadata,
    snapshot: serializeAppSnapshot({ state, workspaceRoot }),
  });

  const sessions = await listSessions({ workspaceRoot });
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({
    id: metadata.id,
    snapshotReadable: true,
    workspaceRoot,
  });

  const latest = await loadLatestSession({ workspaceRoot });
  expect(latest.metadata.id).toBe(metadata.id);
  expect(latest.snapshot.workspaceRoot).toBe(workspaceRoot);

  const explicit = await loadSessionById({
    sessionId: metadata.id,
    workspaceRoot,
  });
  expect(explicit.metadata.id).toBe(metadata.id);
});

test("project key is stable for a canonical root", () => {
  expect(getProjectKey("/repo")).toBe(getProjectKey("/repo"));
  expect(getProjectKey("/repo")).not.toBe(getProjectKey("/other"));
});

test("latest resume fails fast for a broken newest session", async () => {
  const configDir = await tempDir("clutch-session-config-");
  const workspaceRoot = await resolveWorkspaceRoot(
    await tempDir("clutch-session-root-"),
  );
  process.env.CLUTCH_CONFIG_DIR = configDir;

  const valid = await createSessionMetadata({ workspaceRoot });
  await initializeSession(valid);
  const state: AppState = {
    ...createInitialAppState(),
    actions: {} as AppState["actions"],
  };
  await writeSessionSnapshot({
    metadata: valid,
    snapshot: serializeAppSnapshot({ state, workspaceRoot }),
  });

  const broken = {
    ...(await createSessionMetadata({ workspaceRoot })),
    id: `${valid.id}-broken`,
    updatedAt: valid.updatedAt + 10_000,
  };
  await initializeSession(broken);
  const brokenPaths = getSessionPaths({
    sessionId: broken.id,
    workspaceRoot,
  });
  await writeFile(brokenPaths.snapshotPath, "{ not json", "utf8");

  const sessions = await listSessions({ workspaceRoot });
  expect(sessions[0]).toMatchObject({
    id: broken.id,
    snapshotReadable: false,
  });

  await expect(loadLatestSession({ workspaceRoot })).rejects.toThrow();

  const explicit = await loadSessionById({
    sessionId: valid.id,
    workspaceRoot,
  });
  expect(explicit.metadata.id).toBe(valid.id);
});

test("latest resume fails fast for malformed newest context item state", async () => {
  const configDir = await tempDir("clutch-session-config-");
  const workspaceRoot = await resolveWorkspaceRoot(
    await tempDir("clutch-session-root-"),
  );
  process.env.CLUTCH_CONFIG_DIR = configDir;

  const valid = await createSessionMetadata({ workspaceRoot });
  await initializeSession(valid);
  const state: AppState = {
    ...createInitialAppState(),
    actions: {} as AppState["actions"],
  };
  await writeSessionSnapshot({
    metadata: valid,
    snapshot: serializeAppSnapshot({ state, workspaceRoot }),
  });

  const broken = {
    ...(await createSessionMetadata({ workspaceRoot })),
    id: `${valid.id}-bad-item`,
    updatedAt: valid.updatedAt + 20_000,
  };
  await initializeSession(broken);
  const brokenSnapshot = serializeAppSnapshot({ state, workspaceRoot });
  const brokenPaths = getSessionPaths({
    sessionId: broken.id,
    workspaceRoot,
  });
  await writeFile(
    brokenPaths.snapshotPath,
    `${JSON.stringify(
      {
        ...brokenSnapshot,
        workspace: {
          ...brokenSnapshot.workspace,
          contextItems: [
            {
              createdAt: 1,
              id: "say:1",
              schemaVersion: 1,
              summaryState: { status: "missing" },
              type: "user-text",
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const sessions = await listSessions({ workspaceRoot });
  expect(sessions[0]).toMatchObject({
    id: broken.id,
    snapshotReadable: false,
  });

  await expect(loadLatestSession({ workspaceRoot })).rejects.toThrow(
    "user-text.text must be a string",
  );

  const explicit = await loadSessionById({
    sessionId: valid.id,
    workspaceRoot,
  });
  expect(explicit.metadata.id).toBe(valid.id);
});

test("explicit resume rejects snapshots from another workspace", async () => {
  const configDir = await tempDir("clutch-session-config-");
  const workspaceRoot = await resolveWorkspaceRoot(
    await tempDir("clutch-session-root-"),
  );
  process.env.CLUTCH_CONFIG_DIR = configDir;

  const metadata = await createSessionMetadata({ workspaceRoot });
  await initializeSession(metadata);
  const state: AppState = {
    ...createInitialAppState(),
    actions: {} as AppState["actions"],
  };
  await writeSessionSnapshot({
    metadata,
    snapshot: serializeAppSnapshot({ state, workspaceRoot: "/somewhere-else" }),
  });

  await expect(
    loadSessionById({ sessionId: metadata.id, workspaceRoot }),
  ).rejects.toThrow("snapshot belongs to /somewhere-else");
});

test("explicit resume rejects metadata id mismatches", async () => {
  const configDir = await tempDir("clutch-session-config-");
  const workspaceRoot = await resolveWorkspaceRoot(
    await tempDir("clutch-session-root-"),
  );
  process.env.CLUTCH_CONFIG_DIR = configDir;

  const metadata = await createSessionMetadata({ workspaceRoot });
  await initializeSession(metadata);
  const state: AppState = {
    ...createInitialAppState(),
    actions: {} as AppState["actions"],
  };
  await writeSessionSnapshot({
    metadata,
    snapshot: serializeAppSnapshot({ state, workspaceRoot }),
  });

  const paths = getSessionPaths({ sessionId: metadata.id, workspaceRoot });
  await writeFile(
    paths.metadataPath,
    `${JSON.stringify({ ...metadata, id: "different-session-id" })}\n`,
    "utf8",
  );

  await expect(
    loadSessionById({ sessionId: metadata.id, workspaceRoot }),
  ).rejects.toThrow("does not match requested id");
});

async function tempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(path);
  return path;
}
