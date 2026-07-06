import { afterEach, test, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AppState } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import {
  createLiveLlmResponseContextItem,
  createUserTextContextItem,
} from "../context/contextItems";
import { createSessionRecorder } from "./sessionRecorder";
import {
  createSessionMetadata,
  getSessionPaths,
  initializeSession,
  resolveWorkspaceRoot,
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

test("recorder writes mutation events, item events, runtime events, and latest snapshot", async () => {
  const configDir = await tempDir("clutch-recorder-config-");
  const workspaceRoot = await resolveWorkspaceRoot(
    await tempDir("clutch-recorder-root-"),
  );
  process.env.CLUTCH_CONFIG_DIR = configDir;
  const metadata = await createSessionMetadata({ workspaceRoot });
  await initializeSession(metadata);

  let state: AppState = {
    ...createInitialAppState(),
    actions: {} as AppState["actions"],
  };
  const recorder = createSessionRecorder({
    getState: () => state,
    metadata,
    workspaceRoot,
  });

  const previousState = state;
  const item = createUserTextContextItem({
    createdAt: 1,
    id: "say:1",
    text: "note",
  });
  state = {
    ...state,
    workspace: {
      ...state.workspace,
      contextItems: [item],
      focusedContextItemId: item.id,
    },
  };
  recorder.recordStateChange({
    actionName: "say.addToContext",
    previousState,
    state,
  });
  const stateWithItem = state;
  const stateWithoutItem: AppState = {
    ...state,
    workspace: {
      ...state.workspace,
      contextItems: [],
      focusedContextItemId: null,
    },
  };
  recorder.recordStateChange({
    actionName: "compose.removeContextItem",
    previousState: stateWithItem,
    state: stateWithoutItem,
  });
  recorder.recordStateChange({
    actionName: "say.addToContext",
    previousState: stateWithoutItem,
    state: stateWithItem,
  });
  state = stateWithItem;
  recorder.recordRuntimeEvent({ kind: "llm.started", requestId: 1 });
  await recorder.close();

  const paths = getSessionPaths({ sessionId: metadata.id, workspaceRoot });
  const eventText = await readFile(paths.eventsPath, "utf8");
  expect(eventText).toContain("state.mutation");
  expect(eventText).toContain("say.addToContext");
  expect(eventText).toContain("context-item.created");
  expect(eventText).toContain("context-item.removed");
  expect(eventText).toContain("llm.started");
  const mutation = parseEvents(eventText).find(
    (event) => event.kind === "state.mutation",
  );
  expect(mutation).toMatchObject({
    after: { workspace: { contextItems: [expect.objectContaining({ id: "say:1" })] } },
    before: { workspace: { contextItems: [] } },
  });

  const snapshot = JSON.parse(await readFile(paths.snapshotPath, "utf8"));
  expect(snapshot.workspace.contextItems[0]).toMatchObject({
    id: "say:1",
    text: "note",
    type: "user-text",
  });
});

test("recorder continues event sequence after resume", async () => {
  const configDir = await tempDir("clutch-recorder-config-");
  const workspaceRoot = await resolveWorkspaceRoot(
    await tempDir("clutch-recorder-root-"),
  );
  process.env.CLUTCH_CONFIG_DIR = configDir;
  const metadata = await createSessionMetadata({ workspaceRoot });
  await initializeSession(metadata);
  const state: AppState = {
    ...createInitialAppState(),
    actions: {} as AppState["actions"],
  };

  const first = createSessionRecorder({
    getState: () => state,
    metadata,
    workspaceRoot,
  });
  first.recordRuntimeEvent({ kind: "first" });
  await first.close();

  const second = createSessionRecorder({
    getState: () => state,
    metadata,
    workspaceRoot,
  });
  second.recordRuntimeEvent({ kind: "second" });
  await second.close();

  const paths = getSessionPaths({ sessionId: metadata.id, workspaceRoot });
  const events = parseEvents(await readFile(paths.eventsPath, "utf8"));
  const sequences = events.map((event) => event.seq);
  expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  expect(new Set(sequences).size).toBe(sequences.length);
  expect(events.find((event) => event.kind === "second")?.seq).toBeGreaterThan(
    events.find((event) => event.kind === "first")?.seq ?? 0,
  );
});

test("recorder close writes interrupted terminal snapshot and metadata", async () => {
  const configDir = await tempDir("clutch-recorder-config-");
  const workspaceRoot = await resolveWorkspaceRoot(
    await tempDir("clutch-recorder-root-"),
  );
  process.env.CLUTCH_CONFIG_DIR = configDir;
  const metadata = await createSessionMetadata({ workspaceRoot });
  await initializeSession(metadata);
  const live = createLiveLlmResponseContextItem({
    createdAt: 1,
    id: "saved:5",
    output: "partial",
    prompt: "answer",
    sourceRequestId: 4,
  });
  const state: AppState = {
    ...createInitialAppState(),
    actions: {} as AppState["actions"],
    activeTask: {
      kind: "response",
      request: {
        contextItems: [live],
        focusedContextItemId: live.id,
        id: 4,
        question: "answer",
        responseText: "partial",
        status: "streaming",
      },
    },
    workspace: {
      ...createInitialAppState().workspace,
      contextItems: [live],
      focusedContextItemId: live.id,
    },
  };
  const recorder = createSessionRecorder({
    getState: () => state,
    metadata,
    workspaceRoot,
  });

  await recorder.close({ status: "interrupted" });

  const paths = getSessionPaths({ sessionId: metadata.id, workspaceRoot });
  const snapshot = JSON.parse(await readFile(paths.snapshotPath, "utf8"));
  const savedItem = snapshot.workspace.contextItems[0];
  expect(snapshot.activeTask.request.status).toBe("error");
  expect(savedItem.status).toBe("error");
  expect(savedItem.errorMessage).toBe(
    "Interrupted while waiting for model response.",
  );
  const savedMetadata = JSON.parse(await readFile(paths.metadataPath, "utf8"));
  expect(savedMetadata.status).toBe("interrupted");
  const events = parseEvents(await readFile(paths.eventsPath, "utf8"));
  expect(events).toContainEqual(
    expect.objectContaining({ kind: "session.closed", status: "interrupted" }),
  );
});

function parseEvents(text: string): Array<Record<string, any>> {
  return text
    .trim()
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

async function tempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(path);
  return path;
}
