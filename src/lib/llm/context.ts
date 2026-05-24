import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Context, Tool } from "@earendil-works/pi-ai";
import {
  MAX_TOTAL_FILE_CONTEXT_CHARACTERS,
  getContextItemById,
} from "../context/contextItems";
import { loadFileList } from "../fileListLoader";
import type { ContextItem, LlmFileContext } from "../../types";
import { defaultSystemPrompt } from "./prompts";

const execFileAsync = promisify(execFile);

export { MAX_FILE_CONTEXT_CHARACTERS } from "../context/contextItems";
export const MAX_AGENTS_CONTEXT_CHARACTERS = 40_000;
export const MAX_DIFF_CONTEXT_CHARACTERS = 120_000;
export const MAX_DIRECTORY_TREE_ENTRIES = 1_000;

export type BuildLlmContextOptions = {
  contextItems: readonly ContextItem[];
  focusedContextItemId?: string | null;
  question: string;
  root?: string;
  systemPrompt?: string;
  tools?: Tool[];
};

export type { LlmFileContext } from "../../types";

export type BuiltLlmContext = {
  context: Context;
  files: LlmFileContext[];
};

export async function buildLlmContext({
  contextItems,
  focusedContextItemId = null,
  question,
  root = process.cwd(),
  systemPrompt = defaultSystemPrompt,
  tools,
}: BuildLlmContextOptions): Promise<BuiltLlmContext> {
  const selectedContext = await formatSelectedContextItems({
    contextItems,
    focusedContextItemId,
    root,
  });
  const automaticContext = await buildAutomaticContext({ root });

  return {
    context: {
      systemPrompt,
      messages: [
        {
          role: "user",
          content: formatUserMessage({
            automaticContext,
            focusedContextItem:
              focusedContextItemId === null
                ? null
                : getContextItemById(contextItems, focusedContextItemId),
            question,
            selectedContextText: selectedContext.text,
          }),
          timestamp: Date.now(),
        },
      ],
      tools,
    },
    files: selectedContext.files,
  };
}

async function formatSelectedContextItems({
  contextItems,
  focusedContextItemId,
  root,
}: {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  root: string;
}): Promise<{ files: LlmFileContext[]; text: string }> {
  if (contextItems.length === 0) {
    return { files: [], text: "No selected context items." };
  }

  const files: LlmFileContext[] = [];
  const formattedItems: string[] = [];
  let remainingFileCharacters = MAX_TOTAL_FILE_CONTEXT_CHARACTERS;

  for (const item of contextItems) {
    const formatted = await item.formatForLlm({
      focused: item.id === focusedContextItemId,
      remainingFileCharacters,
      root,
    });

    formattedItems.push(formatted.text);
    remainingFileCharacters -= formatted.consumedFileCharacters;
    if (formatted.file !== undefined) {
      files.push(formatted.file);
    }
  }

  return { files, text: formattedItems.join("\n\n") };
}

function formatUserMessage({
  automaticContext,
  focusedContextItem,
  question,
  selectedContextText,
}: {
  automaticContext: readonly AutomaticContextBlock[];
  focusedContextItem: ContextItem | null;
  question: string;
  selectedContextText: string;
}): string {
  const automaticContextText =
    automaticContext.length === 0
      ? "No automatic context available."
      : formatAutomaticContext(automaticContext);
  const focusedContextText =
    focusedContextItem === null
      ? "No focused context item."
      : focusedContextItem.getListLabel();

  return `Question:\n${question}\n\nFocused context item:\n${focusedContextText}\n\nSelected context:\n${selectedContextText}\n\nAutomatic context:\n${automaticContextText}`;
}

type AutomaticContextBlock = {
  content: string;
  name: string;
};

async function buildAutomaticContext({
  root,
}: {
  root: string;
}): Promise<AutomaticContextBlock[]> {
  const [agents, diff, directoryTree] = await Promise.all([
    readAgentsContext({ root }),
    readCurrentDiffContext({ root }),
    readDirectoryTreeContext({ root }),
  ]);

  return [agents, diff, directoryTree].filter(
    (block): block is AutomaticContextBlock => block !== null,
  );
}

async function readAgentsContext({
  root,
}: {
  root: string;
}): Promise<AutomaticContextBlock | null> {
  try {
    const content = await readFile(resolve(root, "AGENTS.md"), "utf8");
    if (content.trim().length === 0) {
      return null;
    }

    return {
      name: "AGENTS.md",
      content: truncateContent(content, MAX_AGENTS_CONTEXT_CHARACTERS),
    };
  } catch {
    return null;
  }
}

async function readCurrentDiffContext({
  root,
}: {
  root: string;
}): Promise<AutomaticContextBlock | null> {
  try {
    const stdout = await readGitDiff({ root, includeStaged: true }).catch(() =>
      readGitDiff({ root, includeStaged: false }),
    );
    if (stdout.trim().length === 0) {
      return null;
    }

    return {
      name: "current_diff",
      content: truncateContent(stdout, MAX_DIFF_CONTEXT_CHARACTERS),
    };
  } catch {
    return null;
  }
}

async function readGitDiff({
  includeStaged,
  root,
}: {
  includeStaged: boolean;
  root: string;
}): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    includeStaged
      ? ["-C", resolve(root), "diff", "--no-ext-diff", "HEAD", "--", "."]
      : ["-C", resolve(root), "diff", "--no-ext-diff", "--", "."],
    { maxBuffer: MAX_DIFF_CONTEXT_CHARACTERS * 2 },
  );

  return stdout;
}

async function readDirectoryTreeContext({
  root,
}: {
  root: string;
}): Promise<AutomaticContextBlock | null> {
  const filePaths = await loadFileList({ root });
  if (filePaths.length === 0) {
    return null;
  }

  const visibleFilePaths = filePaths.slice(0, MAX_DIRECTORY_TREE_ENTRIES);
  const truncatedNote =
    filePaths.length > visibleFilePaths.length
      ? `\n[Directory tree truncated after ${visibleFilePaths.length} of ${filePaths.length} files.]`
      : "";

  return {
    name: "directory_tree",
    content: `${visibleFilePaths.join("\n")}${truncatedNote}`,
  };
}

function formatAutomaticContext(
  blocks: readonly AutomaticContextBlock[],
): string {
  return blocks
    .map(
      (block) =>
        `<automatic_context name=${JSON.stringify(block.name)}>\n${block.content}\n</automatic_context>`,
    )
    .join("\n\n");
}

function truncateContent(content: string, maxCharacters: number): string {
  if (content.length <= maxCharacters) {
    return content;
  }

  return `${content.slice(0, maxCharacters)}\n[Context truncated.]`;
}
