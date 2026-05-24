import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Context, Tool } from "@earendil-works/pi-ai";
import type { FilePath } from "../../types";
import { defaultSystemPrompt } from "./prompts";

export const MAX_FILE_CONTEXT_CHARACTERS = 60_000;
export const MAX_TOTAL_FILE_CONTEXT_CHARACTERS = 200_000;

export type BuildLlmContextOptions = {
  question: string;
  selectedFilePaths: readonly FilePath[];
  root?: string;
  systemPrompt?: string;
  tools?: Tool[];
};

export type LlmFileContext = {
  filePath: FilePath;
  content: string;
  status: "included" | "skipped";
  truncated: boolean;
  errorMessage?: string;
};

export type BuiltLlmContext = {
  context: Context;
  files: LlmFileContext[];
};

export async function buildLlmContext({
  question,
  selectedFilePaths,
  root = process.cwd(),
  systemPrompt = defaultSystemPrompt,
  tools,
}: BuildLlmContextOptions): Promise<BuiltLlmContext> {
  const files = await readSelectedFiles({ root, selectedFilePaths });

  return {
    context: {
      systemPrompt,
      messages: [
        {
          role: "user",
          content: formatUserMessage({ files, question }),
          timestamp: Date.now(),
        },
      ],
      tools,
    },
    files,
  };
}

async function readSelectedFiles({
  root,
  selectedFilePaths,
}: {
  root: string;
  selectedFilePaths: readonly FilePath[];
}): Promise<LlmFileContext[]> {
  const absoluteRoot = resolve(root);
  const files: LlmFileContext[] = [];
  let remainingCharacters = MAX_TOTAL_FILE_CONTEXT_CHARACTERS;

  for (const filePath of selectedFilePaths) {
    if (remainingCharacters <= 0) {
      files.push({
        filePath,
        content: "",
        status: "skipped",
        truncated: false,
        errorMessage:
          "Skipped because the selected file context limit was reached.",
      });
      continue;
    }

    const absoluteFilePath = resolve(absoluteRoot, filePath);
    if (!isInsideRoot(absoluteRoot, absoluteFilePath)) {
      files.push({
        filePath,
        content: "",
        status: "skipped",
        truncated: false,
        errorMessage:
          "Skipped because the path is outside the working directory.",
      });
      continue;
    }

    try {
      const rawContent = await readFile(absoluteFilePath, "utf8");
      if (rawContent.includes("\0")) {
        files.push({
          filePath,
          content: "",
          status: "skipped",
          truncated: false,
          errorMessage: "Skipped because the file appears to be binary.",
        });
        continue;
      }

      const characterLimit = Math.min(
        MAX_FILE_CONTEXT_CHARACTERS,
        remainingCharacters,
      );
      const content = rawContent.slice(0, characterLimit);
      const truncated = rawContent.length > content.length;
      remainingCharacters -= content.length;

      files.push({
        filePath,
        content,
        status: "included",
        truncated,
      });
    } catch (error) {
      files.push({
        filePath,
        content: "",
        status: "skipped",
        truncated: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return files;
}

function formatUserMessage({
  files,
  question,
}: {
  files: readonly LlmFileContext[];
  question: string;
}): string {
  const fileContext =
    files.length === 0 ? "No selected files." : formatFiles(files);

  return `Question:\n${question}\n\nSelected file context:\n${fileContext}`;
}

function formatFiles(files: readonly LlmFileContext[]): string {
  return files
    .map((file) => {
      if (file.status === "skipped") {
        return `<file path=${JSON.stringify(file.filePath)} status="skipped">\n${file.errorMessage ?? "Skipped."}\n</file>`;
      }

      const truncatedNote = file.truncated
        ? "\n[File truncated because the selected file context limit was reached.]"
        : "";

      return `<file path=${JSON.stringify(file.filePath)}>\n${file.content}${truncatedNote}\n</file>`;
    })
    .join("\n\n");
}

function isInsideRoot(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}
