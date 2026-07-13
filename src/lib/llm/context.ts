import {
  MAX_FILE_CONTEXT_CHARACTERS,
  MAX_TOTAL_FILE_CONTEXT_CHARACTERS,
  getContextItemById,
} from "../context/contextItemFactories";
import {
  formatContextItemForLlm,
  getContextItemSummaryView,
} from "../context/contextItemRegistry";
import {
  getAutomaticFileContextItems,
  getAmbientLlmContextItems,
  getAutomaticContextBlockName,
} from "../context/automaticContextItems";
import type {
  AutomaticContextItem,
  ContextItem,
  LlmFileContext,
  PersistentContextItem,
} from "../../types";
import { defaultSystemPrompt, renderPrompt } from "./prompts";
import type { LlmContext, LlmTool, LlmUserMessage } from "./types";

export { MAX_FILE_CONTEXT_CHARACTERS } from "../context/contextItemFactories";
export {
  MAX_DIFF_CONTEXT_CHARACTERS,
  MAX_DIRECTORY_TREE_ENTRIES,
} from "../context/automaticContextItems";

export type BuildLlmContextOptions = {
  ambientContextItems?: readonly ContextItem[];
  contextItems: readonly ContextItem[];
  focusedContextItemId?: string | null;
  question: string;
  root?: string;
  systemPrompt?: string;
  tools?: LlmTool[];
};

export type { LlmFileContext } from "../../types";

export type BuiltLlmContext = {
  context: LlmContext;
  files: LlmFileContext[];
};

export type AssembledLlmContextInput = {
  contextItems: PersistentContextItem[];
  focusedContextItemId: string | null;
};

export function assembleLlmContextInput({
  automaticContextItems,
  contextItems,
  excludedContextItemId,
  focusedContextItemId,
}: {
  automaticContextItems: readonly AutomaticContextItem[];
  contextItems: readonly PersistentContextItem[];
  excludedContextItemId?: string;
  focusedContextItemId: string | null;
}): AssembledLlmContextInput {
  const assembledContextItems = [
    ...getAutomaticFileContextItems({
      automaticContextItems,
      contextItems,
    }),
    ...contextItems,
  ].filter((item) => item.id !== excludedContextItemId);

  return {
    contextItems: assembledContextItems,
    focusedContextItemId: assembledContextItems.some(
      (item) => item.id === focusedContextItemId,
    )
      ? focusedContextItemId
      : null,
  };
}

export async function buildLlmContext({
  ambientContextItems = getAmbientLlmContextItems(),
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
  const automaticContext = await formatAutomaticContextFromItems({
    ambientContextItems,
    root,
  });

  return {
    context: {
      systemPrompt,
      messages: buildUserMessages({
        automaticContext,
        focusedContextItem:
          focusedContextItemId === null
            ? null
            : getContextItemById(contextItems, focusedContextItemId),
        question,
        selectedContextMessages: selectedContext.messages,
      }),
      tools,
    },
    files: selectedContext.files,
  };
}

function buildUserMessages({
  automaticContext,
  focusedContextItem,
  question,
  selectedContextMessages,
}: {
  automaticContext: readonly AutomaticContextBlock[];
  focusedContextItem: ContextItem | null;
  question: string;
  selectedContextMessages: readonly string[];
}): LlmUserMessage[] {
  const timestamp = Date.now();
  return [
    userTextMessage(
      formatAutomaticContextReferenceMessage(automaticContext),
      timestamp,
    ),
    ...selectedContextMessages.map((content) =>
      userTextMessage(content, timestamp),
    ),
    userTextMessage(
      formatSelectedContextItemMessage(focusedContextItem),
      timestamp,
    ),
    userTextMessage(formatUserRequestMessage(question), timestamp),
  ];
}

function userTextMessage(content: string, timestamp: number): LlmUserMessage {
  return {
    content,
    role: "user",
    timestamp,
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
}): Promise<{ files: LlmFileContext[]; messages: string[] }> {
  if (contextItems.length === 0) {
    return { files: [], messages: [] };
  }

  const files: LlmFileContext[] = [];
  const messages: string[] = [];
  let remainingFileCharacters = MAX_TOTAL_FILE_CONTEXT_CHARACTERS;

  for (const item of contextItems) {
    const formatted = await formatContextItemForLlm(item, {
      focused: item.id === focusedContextItemId,
      remainingFileCharacters,
      root,
    });

    messages.push(formatted.text);
    remainingFileCharacters -= formatted.consumedFileCharacters;
    if (formatted.file !== undefined) {
      files.push(formatted.file);
    }
  }

  return { files, messages };
}

function formatAutomaticContextReferenceMessage(
  automaticContext: readonly AutomaticContextBlock[],
): string {
  const automaticContextText =
    automaticContext.length === 0
      ? "No automatic context available."
      : formatAutomaticContext(automaticContext);

  return renderPrompt("context/automatic-context-reference.md", {
    automaticContext: automaticContextText,
  });
}

function formatSelectedContextItemMessage(
  selectedContextItem: ContextItem | null,
): string {
  const selectedContextItemText =
    selectedContextItem === null
      ? "No selected context item."
      : getContextItemSummaryView(selectedContextItem).title;

  return renderPrompt("context/selected-context-item.md", {
    selectedContextItem: selectedContextItemText,
  });
}

function formatUserRequestMessage(question: string): string {
  return renderPrompt("context/user-request.md", { question });
}

export function joinTextUserMessages(context: LlmContext): string {
  return context.messages
    .map((message) => {
      if (message.role !== "user" || typeof message.content !== "string") {
        return null;
      }

      return message.content;
    })
    .filter((content): content is string => content !== null)
    .join("\n\n");
}

type AutomaticContextBlock = {
  content: string;
  name: string;
};

async function formatAutomaticContextFromItems({
  ambientContextItems,
  root,
}: {
  ambientContextItems: readonly ContextItem[];
  root: string;
}): Promise<AutomaticContextBlock[]> {
  const blocks: AutomaticContextBlock[] = [];

  for (const item of ambientContextItems) {
    const blockName = getAutomaticContextBlockName(item.type);
    if (blockName === null) {
      continue;
    }

    const formatted = await formatContextItemForLlm(item, {
      focused: false,
      remainingFileCharacters: Number.POSITIVE_INFINITY,
      root,
    });
    if (formatted.text.trim().length === 0) {
      continue;
    }

    blocks.push({
      content: formatted.text,
      name: blockName,
    });
  }

  return blocks;
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
