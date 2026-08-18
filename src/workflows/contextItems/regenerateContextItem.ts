import { AsyncLocalStorage } from "node:async_hooks";
import { ContextDeck } from "../../app/contextDeck";
import {
  createSavedDiffContextItem,
  createSavedLlmResponseContextItem,
  createShellCommandOutputContextItem,
  getContextItemById,
  preserveContextItemPlacement,
  SavedDiffContextItem,
  SavedLlmResponseContextItem,
  ShellCommandOutputContextItem,
} from "../../lib/context/contextItems";
import { assembleLlmContextInput } from "../../lib/llm/context";
import { APPLY_PATCH_TOOL_NAME } from "../../lib/llm/patchTool";
import {
  askCommandPromptDirective,
  editCommandPromptDirective,
} from "../../lib/llm/prompts";
import { streamLlmInteraction } from "../../lib/llm/streamResponse";
import {
  getWorkspaceEditTriggerItemId,
  isClutchWorkspaceEditEvent,
} from "../../lib/session/clutchWorkspaceEditEvents";
import { runShellCommand } from "../../lib/shell/shellCommand";
import {
  recordSessionRuntimeEvent,
  setWorkspaceEditListener,
  useAppStore,
} from "../../store/appStore";
import type { ContextItem } from "../../types";

const ignoreWorkspaceEdits = new AsyncLocalStorage<true>();

let generation = 0;
let queue: string[] = [];
let pumping = false;
let currentAbort: AbortController | null = null;
let currentItemId: string | null = null;

let streamLlmInteractionForRegen: typeof streamLlmInteraction =
  streamLlmInteraction;
let runShellCommandForRegen: typeof runShellCommand = runShellCommand;
let regenRunnerForTest:
  | ((itemId: string, signal: AbortSignal) => Promise<void>)
  | null = null;

export function registerAutoRegenTrigger() {
  setWorkspaceEditListener(onWorkspaceEditEvent);
}

export function onWorkspaceEditEvent(event: Record<string, unknown>) {
  if (!isClutchWorkspaceEditEvent(event)) {
    return;
  }
  if (ignoreWorkspaceEdits.getStore() === true) {
    return;
  }

  resetQueueAndStart(getWorkspaceEditTriggerItemId(event));
}

export function markContextItemRerunStarted(itemId: string) {
  queue = queue.filter((queuedId) => queuedId !== itemId);
  if (currentItemId === itemId) {
    currentAbort?.abort();
  }
}

export function setRegenRunnerForTest(
  runner: ((itemId: string, signal: AbortSignal) => Promise<void>) | null,
) {
  regenRunnerForTest = runner;
}

export function setRegenStreamForTest(
  streamer: typeof streamLlmInteraction,
): () => void {
  const previous = streamLlmInteractionForRegen;
  streamLlmInteractionForRegen = streamer;
  return () => {
    streamLlmInteractionForRegen = previous;
  };
}

export function setRegenShellForTest(
  runner: typeof runShellCommand,
): () => void {
  const previous = runShellCommandForRegen;
  runShellCommandForRegen = runner;
  return () => {
    runShellCommandForRegen = previous;
  };
}

export function resetAutoRegenSchedulerForTest() {
  generation = 0;
  queue = [];
  pumping = false;
  currentAbort?.abort();
  currentAbort = null;
  currentItemId = null;
  regenRunnerForTest = null;
  streamLlmInteractionForRegen = streamLlmInteraction;
  runShellCommandForRegen = runShellCommand;
  setWorkspaceEditListener(null);
}

export function runIgnoringWorkspaceEditEvents<T>(fn: () => Promise<T>) {
  return ignoreWorkspaceEdits.run(true, fn);
}

function resetQueueAndStart(excludeItemId: string | undefined) {
  generation += 1;
  currentAbort?.abort();
  queue = scanAutoRegenItemIds().filter((itemId) => itemId !== excludeItemId);
  if (!pumping) {
    void pump();
  }
}

function scanAutoRegenItemIds(): string[] {
  return useAppStore
    .getState()
    .workspace.contextItems.filter(
      (item) => item.getAutoRegenerate?.() === true,
    )
    .map((item) => item.id);
}

async function pump() {
  if (pumping) {
    return;
  }

  pumping = true;
  try {
    while (true) {
      const itemId = queue.shift();
      if (itemId === undefined) {
        return;
      }

      const gen = generation;
      const abort = new AbortController();
      currentAbort = abort;
      currentItemId = itemId;

      const item = getWorkspaceItem(itemId);
      if (item === null || item.getAutoRegenerate?.() !== true) {
        if (currentAbort === abort) {
          currentAbort = null;
          currentItemId = null;
        }
        continue;
      }

      if (item.withRegenStatus !== undefined) {
        replaceWorkspaceItem(item.withRegenStatus({ status: "running" }));
      }

      try {
        await runIgnoringWorkspaceEditEvents(async () => {
          if (regenRunnerForTest !== null) {
            await regenRunnerForTest(itemId, abort.signal);
            return;
          }

          await regenerateContextItem(itemId, abort.signal, gen);
        });
      } catch (error) {
        if (isStale(gen, abort.signal)) {
          clearStaleRunning(itemId);
          continue;
        }

        setRegenError(
          itemId,
          error instanceof Error ? error.message : String(error),
          gen,
        );
      } finally {
        if (currentAbort === abort) {
          currentAbort = null;
          currentItemId = null;
        }
      }

      if (isStale(gen, abort.signal)) {
        clearStaleRunning(itemId);
      }
    }
  } finally {
    pumping = false;
    if (queue.length > 0) {
      void pump();
    }
  }
}

async function regenerateContextItem(
  itemId: string,
  signal: AbortSignal,
  gen: number,
) {
  const item = getWorkspaceItem(itemId);
  if (item === null) {
    throw new Error(`Cannot regenerate context item ${itemId}: item is missing.`);
  }

  if (item instanceof SavedLlmResponseContextItem) {
    await regenerateTextItem(item, signal, gen);
    return;
  }

  if (item instanceof ShellCommandOutputContextItem) {
    await regenerateShellItem(item, signal, gen);
    return;
  }

  if (item instanceof SavedDiffContextItem) {
    await regenerateDiffItem(item, signal, gen);
    return;
  }

  throw new Error(`Cannot regenerate ${item.type} item ${itemId}.`);
}

async function regenerateTextItem(
  item: SavedLlmResponseContextItem,
  signal: AbortSignal,
  gen: number,
) {
  const requestId = useAppStore
    .getState()
    .actions.contextItems.allocateLlmRequestId();
  const assembled = assembleRegenContext(item.id);
  recordSessionRuntimeEvent({
    contextItemIds: assembled.contextItems.map((contextItem) => contextItem.id),
    focusedContextItemId: assembled.focusedContextItemId,
    kind: "llm.started",
    requestId,
    source: "auto-regen",
    toolNames: [],
  });

  const result = await streamLlmInteractionForRegen({
    allowedToolNames: [],
    commandDirective: askCommandPromptDirective,
    contextItems: assembled.contextItems,
    focusedContextItemId: assembled.focusedContextItemId,
    question: item.prompt,
    requestId,
    signal,
  });

  if (isStale(gen, signal)) {
    return;
  }

  if (result.kind !== "text") {
    recordSessionRuntimeEvent({
      kind: "llm.finished",
      requestId,
      responseKind: result.kind,
      source: "auto-regen",
    });
    setRegenError(
      item.id,
      "Auto-regen expected text and got a tool result.",
      gen,
    );
    return;
  }

  recordSessionRuntimeEvent({
    kind: "llm.finished",
    requestId,
    responseKind: "text",
    responseLength: result.responseText.length,
    source: "auto-regen",
  });

  const next = createSavedLlmResponseContextItem({
    createdAt: item.createdAt,
    id: item.id,
    output: result.responseText,
    prompt: item.prompt,
    sourceRequestId: requestId,
  });
  commitRegenResult(item.id, next, gen);
}

async function regenerateShellItem(
  item: ShellCommandOutputContextItem,
  signal: AbortSignal,
  gen: number,
) {
  const requestId = useAppStore
    .getState()
    .actions.contextItems.allocateLlmRequestId();
  recordSessionRuntimeEvent({
    command: item.result.command,
    kind: "shell-command.started",
    requestId,
    source: "auto-regen",
  });

  const result = await runShellCommandForRegen({
    command: item.result.command,
    signal,
  });

  if (isStale(gen, signal)) {
    return;
  }

  recordSessionRuntimeEvent({
    command: result.command,
    exitCode: result.exitCode,
    kind: "shell-command.finished",
    requestId,
    signal: result.signal,
    source: "auto-regen",
    timedOut: result.timedOut,
  });

  const next = createShellCommandOutputContextItem({
    createdAt: item.createdAt,
    id: item.id,
    result,
    sourceRequestId: requestId,
  });
  commitRegenResult(item.id, next, gen);
}

async function regenerateDiffItem(
  item: SavedDiffContextItem,
  signal: AbortSignal,
  gen: number,
) {
  const requestId = useAppStore
    .getState()
    .actions.contextItems.allocateLlmRequestId();
  const assembled = assembleRegenContext(item.id);
  recordSessionRuntimeEvent({
    contextItemIds: assembled.contextItems.map((contextItem) => contextItem.id),
    focusedContextItemId: assembled.focusedContextItemId,
    kind: "llm.started",
    requestId,
    source: "auto-regen",
    toolNames: [APPLY_PATCH_TOOL_NAME],
  });

  const result = await streamLlmInteractionForRegen({
    allowedToolNames: [APPLY_PATCH_TOOL_NAME],
    commandDirective: editCommandPromptDirective,
    contextItems: assembled.contextItems,
    focusedContextItemId: assembled.focusedContextItemId,
    patchToolMode: "review",
    question: item.prompt,
    requestId,
    signal,
  });

  if (isStale(gen, signal)) {
    return;
  }

  if (result.kind !== "patch" || result.patch.status !== "valid") {
    recordSessionRuntimeEvent({
      kind: "llm.finished",
      requestId,
      responseKind: result.kind,
      source: "auto-regen",
    });
    setRegenError(
      item.id,
      result.kind === "patch" && result.patch.status === "invalid"
        ? result.patch.errors
            .map((error) => `${error.path || "<unknown>"}: ${error.message}`)
            .join("\n")
        : "Auto-regen expected a valid patch.",
      gen,
    );
    return;
  }

  recordSessionRuntimeEvent({
    kind: "llm.finished",
    requestId,
    responseKind: "patch",
    source: "auto-regen",
  });

  const next = createSavedDiffContextItem({
    createdAt: item.createdAt,
    diffText: result.patch.diffText,
    id: item.id,
    prompt: item.prompt,
    proposal: result.patch.proposal,
    sourceRequestId: requestId,
    summary: result.patch.proposal.summary,
  });
  commitRegenResult(item.id, next, gen);
}

function assembleRegenContext(itemId: string) {
  const state = useAppStore.getState();
  return assembleLlmContextInput({
    automaticContextItems: state.workspace.automaticContextItems,
    contextItems: state.workspace.contextItems,
    excludedContextItemId: itemId,
    focusedContextItemId: state.workspace.focusedContextItemId,
  });
}

function commitRegenResult(itemId: string, next: ContextItem, gen: number) {
  if (generation !== gen) {
    return;
  }

  const previous = getWorkspaceItem(itemId);
  if (previous === null) {
    return;
  }

  const preserved = preserveContextItemPlacement(previous, next);
  const idle =
    preserved.withRegenStatus?.({ status: "idle" }) ?? preserved;
  replaceWorkspaceItem(idle);
}

function setRegenError(itemId: string, errorMessage: string, gen: number) {
  if (generation !== gen) {
    return;
  }
  const item = getWorkspaceItem(itemId);
  if (item?.withRegenStatus === undefined) {
    return;
  }

  replaceWorkspaceItem(item.withRegenStatus({ errorMessage, status: "error" }));
}

function clearStaleRunning(itemId: string) {
  const item = getWorkspaceItem(itemId);
  if (item?.getRegenStatus?.().status !== "running") {
    return;
  }
  if (item.withRegenStatus === undefined) {
    return;
  }

  replaceWorkspaceItem(item.withRegenStatus({ status: "idle" }));
}

function isStale(gen: number, signal: AbortSignal): boolean {
  return generation !== gen || signal.aborted;
}

function getWorkspaceItem(itemId: string): ContextItem | null {
  return getContextItemById(
    useAppStore.getState().workspace.contextItems,
    itemId,
  );
}

function replaceWorkspaceItem(item: ContextItem) {
  useAppStore.setState((state) => ({
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .replace(item)
      .applyTo(state.workspace),
  }));
}
