import { stat, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export type CreateFileProposal = {
  content: string;
  path: string;
  summary: string;
};

export type CreateFileValidationError = {
  message: string;
  path: string;
};

export type CreateFileValidationResult =
  | {
      proposal: CreateFileProposal;
      status: "valid";
    }
  | {
      errors: CreateFileValidationError[];
      proposal: CreateFileProposal;
      status: "invalid";
    };

export async function validateCreateFileProposal({
  proposal,
  root = process.cwd(),
}: {
  proposal: CreateFileProposal;
  root?: string;
}): Promise<CreateFileValidationResult> {
  const errors: CreateFileValidationError[] = [];
  const absoluteRoot = resolve(root);
  const path = proposal.path.trim();

  if (path.length === 0) {
    errors.push({ message: "File path is empty.", path: proposal.path });
  }

  if (isAbsolute(path)) {
    errors.push({
      message: "File path must be relative to the working directory.",
      path: proposal.path,
    });
  }

  const absolutePath = resolve(absoluteRoot, path);
  const relativePath = relative(absoluteRoot, absolutePath);
  const insideRoot =
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath));

  if (!insideRoot) {
    errors.push({
      message: "File path is outside the working directory.",
      path: proposal.path,
    });
  }

  if (path.endsWith("/") || path.endsWith("\\")) {
    errors.push({ message: "File path points to a directory.", path });
  }

  if (errors.length === 0) {
    try {
      const existing = await stat(absolutePath);
      errors.push({
        message: existing.isDirectory()
          ? "A directory already exists at this path."
          : "A file already exists at this path.",
        path,
      });
    } catch (error) {
      if (!isNotFoundError(error)) {
        errors.push({
          message: `Could not check file path: ${error instanceof Error ? error.message : String(error)}`,
          path,
        });
      }
    }
  }

  if (errors.length > 0) {
    return {
      errors,
      proposal: {
        ...proposal,
        path,
      },
      status: "invalid",
    };
  }

  return {
    proposal: {
      ...proposal,
      path,
    },
    status: "valid",
  };
}

export async function applyCreateFileProposal({
  proposal,
  root = process.cwd(),
}: {
  proposal: CreateFileProposal;
  root?: string;
}): Promise<CreateFileValidationResult> {
  const validation = await validateCreateFileProposal({ proposal, root });
  if (validation.status === "invalid") {
    return validation;
  }

  const absolutePath = resolve(root, validation.proposal.path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, validation.proposal.content, "utf8");

  return validation;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
