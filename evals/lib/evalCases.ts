import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { LlmContext } from "../../src/lib/llm/types";
import type { PatchProposal } from "../../src/lib/patch/types";
import { patchProposalFromLegacyEdits } from "../../src/lib/patch/patchEngine";
import type { ShellCommandResult } from "../../src/lib/shell/shellCommand";
import type { ContextItem } from "../../src/types";
import {
  createFileContextItem,
  createSavedDiffContextItem,
  createSavedLlmResponseContextItem,
  createShellCommandOutputContextItem,
  createUserTextContextItem,
} from "../../src/lib/context/contextItemFactories";
import { buildLlmInteractionContext } from "../../src/lib/llm/interactionContext";
import { getLlmSlashCommand } from "../../src/workflows/llmTools/toolRegistry";

const execFileAsync = promisify(execFile);

export const DEFAULT_EVAL_CASES_DIR = "evals/cases";

export const EVAL_CLASSIFICATIONS = [
  "text",
  "add_context_files",
  "create_file",
  "find_relevant_files",
  "propose_patch",
  "run_shell_command",
] as const;

export type EvalClassification = (typeof EVAL_CLASSIFICATIONS)[number];

export type EvalCase = {
  expected: EvalCaseExpected;
  input: EvalCaseInput;
  path: string;
};

export type PreparedEvalCase = EvalCase & {
  allowedToolNames?: readonly string[];
  context: LlmContext;
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  root: string;
};

export type EvalCaseInput = {
  allowedToolNames?: string[];
  command?: string;
  contextItems?: EvalContextItemSpec[];
  question: string;
  workspace?: EvalWorkspaceSpec;
};

export type EvalCaseExpected = {
  allowedClassifications?: EvalClassification[];
  classification: EvalClassification;
  forbiddenClassifications?: EvalClassification[];
  judge?: {
    minScore?: number;
    rubric: string;
  };
  patch?: {
    allowedPaths?: string[];
    diffExcludes?: string[];
    diffIncludes?: string[];
    forbiddenPaths?: string[];
    mustBeValid?: boolean;
    required?: boolean;
    requiredPaths?: string[];
  };
  repeat?: {
    passThreshold?: "all" | "majority";
  };
  toolArguments?: Record<string, unknown>;
};

type EvalWorkspaceSpec = {
  files?: Record<string, EvalFileContentSpec>;
  generatedFiles?: EvalGeneratedFileSpec[];
  git?: {
    baseFiles: Record<string, EvalFileContentSpec>;
    changedFiles?: Record<string, EvalFileContentSpec>;
    generatedBaseFiles?: EvalGeneratedFileSpec[];
    generatedChangedFiles?: EvalGeneratedFileSpec[];
    generatedUntrackedFiles?: EvalGeneratedFileSpec[];
    untrackedFiles?: Record<string, EvalFileContentSpec>;
  };
};

type EvalGeneratedFileSpec = {
  content: EvalFileContentSpec;
  count: number;
  indexPad?: number;
  pathTemplate: string;
};

type EvalFileContentSpec =
  | string
  | {
      count: number;
      prefix?: string;
      repeat: string;
      suffix?: string;
    };

type EvalContextItemSpec =
  | {
      focused?: boolean;
      kind: "file";
      path: string;
    }
  | {
      focused?: boolean;
      id: string;
      kind: "user-text";
      text: string;
    }
  | {
      focused?: boolean;
      id: string;
      kind: "saved-response";
      output: string;
      prompt: string;
    }
  | {
      diffText: string;
      focused?: boolean;
      id: string;
      kind: "saved-diff";
      prompt: string;
      proposal: PatchProposal;
      summary: string;
    }
  | {
      command: string;
      exitCode?: number;
      focused?: boolean;
      id: string;
      kind: "shell-output";
      stderr?: string;
      stdout?: string;
    };

export async function loadEvalCases({
  casesDir = DEFAULT_EVAL_CASES_DIR,
}: {
  casesDir?: string;
} = {}): Promise<EvalCase[]> {
  const root = resolve(casesDir);
  const categories = await readdir(root, { withFileTypes: true });
  const cases: EvalCase[] = [];

  for (const category of categories) {
    if (!category.isDirectory()) {
      continue;
    }
    const categoryPath = join(root, category.name);
    const entries = await readdir(categoryPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const casePath = `${category.name}/${entry.name}`;
      const directory = join(categoryPath, entry.name);
      cases.push({
        expected: parseEvalCaseExpected(
          await readJsonFile(join(directory, "expected.json")),
          casePath,
        ),
        input: parseEvalCaseInput(
          await readJsonFile(join(directory, "input.json")),
          casePath,
        ),
        path: casePath,
      });
    }
  }

  return cases.sort((a, b) => a.path.localeCompare(b.path));
}

export async function prepareEvalCase(
  evalCase: EvalCase,
): Promise<PreparedEvalCase> {
  const root = await materializeWorkspace(evalCase);
  const { contextItems, focusedContextItemId } = createContextItems(evalCase);
  const slashCommand =
    evalCase.input.command === undefined
      ? null
      : getRequiredSlashCommand(evalCase.input.command, evalCase.path);
  const allowedToolNames =
    evalCase.input.allowedToolNames ?? slashCommand?.allowedToolNames;
  const { context } = await buildLlmInteractionContext({
    allowedToolNames,
    commandDirective: slashCommand?.promptDirective,
    contextItems,
    focusedContextItemId,
    question: evalCase.input.question,
    root,
  });

  return {
    ...evalCase,
    allowedToolNames,
    context,
    contextItems,
    focusedContextItemId,
    root,
  };
}

export function renderEvalCasePromptMarkdown(
  prepared: PreparedEvalCase,
): string {
  return [
    "<!-- prettier-ignore-start -->",
    "",
    `# ${prepared.path}`,
    "",
    "## System Prompt",
    "",
    fence("text", prepared.context.systemPrompt ?? ""),
    "",
    "## Tools",
    "",
    prepared.context.tools.length === 0
      ? "(none)"
      : fence("json", JSON.stringify(prepared.context.tools, null, 2)),
    "",
    "## Messages",
    "",
    ...prepared.context.messages.flatMap((message, index) => [
      `### ${index + 1}. ${message.role}`,
      "",
      fence(
        "text",
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content, null, 2),
      ),
      "",
    ]),
    "<!-- prettier-ignore-end -->",
  ].join("\n");
}

export function classificationPasses({
  actual,
  expected,
}: {
  actual: EvalClassification;
  expected: EvalCaseExpected;
}): boolean {
  const allowed = expected.allowedClassifications ?? [expected.classification];
  return (
    allowed.includes(actual) &&
    !(expected.forbiddenClassifications ?? []).includes(actual)
  );
}

function parseEvalCaseInput(raw: unknown, path: string): EvalCaseInput {
  const input = record(raw, `${path} input`);
  const question = stringField(input, "question", path);
  const command = optionalStringField(input, "command", path);
  const allowedToolNames = optionalStringArrayField(
    input,
    "allowedToolNames",
    path,
  );
  const contextItems = optionalArrayField(input, "contextItems", path);
  const workspace = optionalRecordField(input, "workspace", path);

  return {
    allowedToolNames,
    command,
    contextItems:
      contextItems === undefined
        ? undefined
        : contextItems.map((item, index) =>
            parseContextItemSpec(item, `${path} contextItems[${index}]`),
          ),
    question,
    workspace:
      workspace === undefined ? undefined : parseWorkspaceSpec(workspace, path),
  };
}

function parseEvalCaseExpected(raw: unknown, path: string): EvalCaseExpected {
  const expected = record(raw, `${path} expected`);
  const classification = classificationField(expected, "classification", path);
  const allowedClassifications = optionalClassificationArrayField(
    expected,
    "allowedClassifications",
    path,
  );
  const forbiddenClassifications = optionalClassificationArrayField(
    expected,
    "forbiddenClassifications",
    path,
  );
  const patch = optionalRecordField(expected, "patch", path);
  const judge = optionalRecordField(expected, "judge", path);
  const repeat = optionalRecordField(expected, "repeat", path);

  return {
    allowedClassifications,
    classification,
    forbiddenClassifications,
    judge:
      judge === undefined
        ? undefined
        : {
            minScore: optionalNumberField(judge, "minScore", path),
            rubric: stringField(judge, "rubric", path),
          },
    patch:
      patch === undefined
        ? undefined
        : {
            allowedPaths: optionalStringArrayField(patch, "allowedPaths", path),
            diffExcludes: optionalStringArrayField(patch, "diffExcludes", path),
            diffIncludes: optionalStringArrayField(patch, "diffIncludes", path),
            forbiddenPaths: optionalStringArrayField(
              patch,
              "forbiddenPaths",
              path,
            ),
            mustBeValid: optionalBooleanField(patch, "mustBeValid", path),
            required: optionalBooleanField(patch, "required", path),
            requiredPaths: optionalStringArrayField(
              patch,
              "requiredPaths",
              path,
            ),
          },
    repeat:
      repeat === undefined
        ? undefined
        : {
            passThreshold: optionalPassThresholdField(
              repeat,
              "passThreshold",
              path,
            ),
          },
    toolArguments: optionalRecordField(expected, "toolArguments", path),
  };
}

function parseWorkspaceSpec(
  raw: Record<string, unknown>,
  path: string,
): EvalWorkspaceSpec {
  const git = optionalRecordField(raw, "git", path);
  return {
    files: optionalFileMap(raw, "files", path),
    generatedFiles: optionalGeneratedFileSpecs(raw, "generatedFiles", path),
    git:
      git === undefined
        ? undefined
        : {
            baseFiles: requiredFileMap(git, "baseFiles", path),
            changedFiles: optionalFileMap(git, "changedFiles", path),
            generatedBaseFiles: optionalGeneratedFileSpecs(
              git,
              "generatedBaseFiles",
              path,
            ),
            generatedChangedFiles: optionalGeneratedFileSpecs(
              git,
              "generatedChangedFiles",
              path,
            ),
            generatedUntrackedFiles: optionalGeneratedFileSpecs(
              git,
              "generatedUntrackedFiles",
              path,
            ),
            untrackedFiles: optionalFileMap(git, "untrackedFiles", path),
          },
  };
}

function parseContextItemSpec(raw: unknown, path: string): EvalContextItemSpec {
  const item = record(raw, path);
  const kind = stringField(item, "kind", path);
  const focused = optionalBooleanField(item, "focused", path);

  if (kind === "file") {
    return { focused, kind, path: stringField(item, "path", path) };
  }
  if (kind === "user-text") {
    return {
      focused,
      id: stringField(item, "id", path),
      kind,
      text: stringField(item, "text", path),
    };
  }
  if (kind === "saved-response") {
    return {
      focused,
      id: stringField(item, "id", path),
      kind,
      output: stringField(item, "output", path),
      prompt: stringField(item, "prompt", path),
    };
  }
  if (kind === "saved-diff") {
    return {
      diffText: stringField(item, "diffText", path),
      focused,
      id: stringField(item, "id", path),
      kind,
      prompt: stringField(item, "prompt", path),
      proposal: parsePatchProposal(item.proposal, path),
      summary: stringField(item, "summary", path),
    };
  }
  if (kind === "shell-output") {
    return {
      command: stringField(item, "command", path),
      exitCode: optionalNumberField(item, "exitCode", path),
      focused,
      id: stringField(item, "id", path),
      kind,
      stderr: optionalStringField(item, "stderr", path),
      stdout: optionalStringField(item, "stdout", path),
    };
  }

  throw new Error(`${path} has unsupported context item kind: ${kind}`);
}

function parsePatchProposal(raw: unknown, path: string): PatchProposal {
  const proposal = record(raw, `${path} proposal`);
  const summary = stringField(proposal, "summary", path);
  if (typeof proposal.patch === "string") {
    return { patch: proposal.patch, summary };
  }

  const edits = arrayField(proposal, "edits", path).map((edit, index) => {
    const recordEdit = record(edit, `${path} proposal.edits[${index}]`);
    return {
      path: stringField(recordEdit, "path", path),
      oldText: stringField(recordEdit, "oldText", path),
      newText: stringField(recordEdit, "newText", path),
    };
  });
  return patchProposalFromLegacyEdits({ edits, summary });
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Could not read eval JSON ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function materializeWorkspace(evalCase: EvalCase): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "clutch-eval-"));
  const workspace = evalCase.input.workspace;
  if (workspace === undefined) {
    return root;
  }

  for (const [path, content] of Object.entries(workspace.files ?? {})) {
    await writeWorkspaceFile({ content, path, root });
  }
  await writeGeneratedWorkspaceFiles({
    generatedFiles: workspace.generatedFiles ?? [],
    root,
  });

  if (workspace.git !== undefined) {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    for (const [path, content] of Object.entries(workspace.git.baseFiles)) {
      await writeWorkspaceFile({ content, path, root });
    }
    await writeGeneratedWorkspaceFiles({
      generatedFiles: workspace.git.generatedBaseFiles ?? [],
      root,
    });
    await execFileAsync("git", ["add", "."], { cwd: root });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Clutch Evals",
        "-c",
        "user.email=clutch-evals@example.com",
        "commit",
        "-qm",
        "base",
      ],
      { cwd: root },
    );
    for (const [path, content] of Object.entries(
      workspace.git.changedFiles ?? {},
    )) {
      await writeWorkspaceFile({ content, path, root });
    }
    await writeGeneratedWorkspaceFiles({
      generatedFiles: workspace.git.generatedChangedFiles ?? [],
      root,
    });
    for (const [path, content] of Object.entries(
      workspace.git.untrackedFiles ?? {},
    )) {
      await writeWorkspaceFile({ content, path, root });
    }
    await writeGeneratedWorkspaceFiles({
      generatedFiles: workspace.git.generatedUntrackedFiles ?? [],
      root,
    });
  }

  return root;
}

async function writeGeneratedWorkspaceFiles({
  generatedFiles,
  root,
}: {
  generatedFiles: readonly EvalGeneratedFileSpec[];
  root: string;
}) {
  for (const generatedFile of generatedFiles) {
    for (let index = 0; index < generatedFile.count; index += 1) {
      await writeWorkspaceFile({
        content: generatedFile.content,
        path: renderGeneratedFilePath({ generatedFile, index }),
        root,
      });
    }
  }
}

async function writeWorkspaceFile({
  content,
  path,
  root,
}: {
  content: EvalFileContentSpec;
  path: string;
  root: string;
}) {
  assertRelativeWorkspacePath(path);
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, materializeFileContent(content), "utf8");
}

function createContextItems(evalCase: EvalCase): {
  contextItems: ContextItem[];
  focusedContextItemId: string | null;
} {
  const specs = evalCase.input.contextItems ?? [];
  const contextItems = specs.map((spec) => createContextItem(spec));
  const focusedSpecs = specs.filter((spec) => spec.focused === true);
  if (focusedSpecs.length > 1) {
    throw new Error(
      `${evalCase.path} must not mark multiple context items focused.`,
    );
  }

  return {
    contextItems,
    focusedContextItemId:
      focusedSpecs.length === 0
        ? null
        : contextItems[specs.indexOf(focusedSpecs[0]!)].id,
  };
}

function createContextItem(spec: EvalContextItemSpec): ContextItem {
  const createdAt = Date.parse("2026-01-01T00:00:00.000Z");
  if (spec.kind === "file") {
    return createFileContextItem(spec.path);
  }
  if (spec.kind === "user-text") {
    return createUserTextContextItem({
      createdAt,
      id: spec.id,
      text: spec.text,
    });
  }
  if (spec.kind === "saved-response") {
    return createSavedLlmResponseContextItem({
      createdAt,
      id: spec.id,
      output: spec.output,
      prompt: spec.prompt,
      sourceRequestId: 1,
    });
  }
  if (spec.kind === "saved-diff") {
    return createSavedDiffContextItem({
      createdAt,
      diffText: spec.diffText,
      id: spec.id,
      prompt: spec.prompt,
      proposal: spec.proposal,
      sourceRequestId: 1,
      summary: spec.summary,
    });
  }

  const result: ShellCommandResult = {
    command: spec.command,
    durationMs: 12,
    exitCode: spec.exitCode ?? 0,
    stderr: spec.stderr ?? "",
    stdout: spec.stdout ?? "",
    timedOut: false,
    truncated: false,
  };
  return createShellCommandOutputContextItem({
    createdAt,
    id: spec.id,
    result,
    sourceRequestId: 1,
  });
}

function getRequiredSlashCommand(commandName: string, casePath: string) {
  const command = getLlmSlashCommand(commandName);
  if (command === null) {
    throw new Error(
      `${casePath} references unknown slash command: ${commandName}`,
    );
  }
  return command;
}

function materializeFileContent(content: EvalFileContentSpec): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Number.isInteger(content.count) || content.count < 0) {
    throw new Error(
      "Generated eval file content count must be a non-negative integer.",
    );
  }
  return `${content.prefix ?? ""}${content.repeat.repeat(content.count)}${content.suffix ?? ""}`;
}

function optionalFileMap(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): Record<string, EvalFileContentSpec> | undefined {
  if (raw[field] === undefined) {
    return undefined;
  }
  return requiredFileMap(raw, field, path);
}

function requiredFileMap(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): Record<string, EvalFileContentSpec> {
  const files = record(raw[field], `${path} ${field}`);
  return Object.fromEntries(
    Object.entries(files).map(([filePath, content]) => [
      filePath,
      parseFileContentSpec(content, `${path} ${field}.${filePath}`),
    ]),
  );
}

function parseFileContentSpec(raw: unknown, path: string): EvalFileContentSpec {
  if (typeof raw === "string") {
    return raw;
  }
  const spec = record(raw, path);
  return {
    count: numberField(spec, "count", path),
    prefix: optionalStringField(spec, "prefix", path),
    repeat: stringField(spec, "repeat", path),
    suffix: optionalStringField(spec, "suffix", path),
  };
}

function optionalGeneratedFileSpecs(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): EvalGeneratedFileSpec[] | undefined {
  const specs = optionalArrayField(raw, field, path);
  if (specs === undefined) {
    return undefined;
  }

  return specs.map((spec, index) =>
    parseGeneratedFileSpec(spec, `${path} ${field}[${index}]`),
  );
}

function parseGeneratedFileSpec(
  raw: unknown,
  path: string,
): EvalGeneratedFileSpec {
  const spec = record(raw, path);
  const count = numberField(spec, "count", path);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`${path} count must be a non-negative integer.`);
  }
  const indexPad = optionalNumberField(spec, "indexPad", path);
  if (indexPad !== undefined && (!Number.isInteger(indexPad) || indexPad < 0)) {
    throw new Error(`${path} indexPad must be a non-negative integer.`);
  }

  return {
    content:
      spec.content === undefined
        ? ""
        : parseFileContentSpec(spec.content, `${path} content`),
    count,
    indexPad,
    pathTemplate: stringField(spec, "pathTemplate", path),
  };
}

function renderGeneratedFilePath({
  generatedFile,
  index,
}: {
  generatedFile: EvalGeneratedFileSpec;
  index: number;
}): string {
  if (!generatedFile.pathTemplate.includes("{index}")) {
    throw new Error(
      `Generated eval file path template must include {index}: ${generatedFile.pathTemplate}`,
    );
  }

  const formattedIndex = String(index).padStart(
    generatedFile.indexPad ?? 0,
    "0",
  );
  return generatedFile.pathTemplate.replaceAll("{index}", formattedIndex);
}

function assertRelativeWorkspacePath(path: string) {
  const absolute = resolve("/", path);
  if (path.trim().length === 0 || absolute === "/" || path.startsWith("../")) {
    throw new Error(`Eval workspace file path must be relative: ${path}`);
  }
}

function fence(language: string, content: string): string {
  return `\`\`\`${language}\n${content}\n\`\`\``;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): string {
  const value = raw[field];
  if (typeof value !== "string") {
    throw new Error(`${path} ${field} must be a string.`);
  }
  return value;
}

function optionalStringField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): string | undefined {
  if (raw[field] === undefined) {
    return undefined;
  }
  return stringField(raw, field, path);
}

function numberField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): number {
  const value = raw[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} ${field} must be a finite number.`);
  }
  return value;
}

function optionalNumberField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): number | undefined {
  if (raw[field] === undefined) {
    return undefined;
  }
  return numberField(raw, field, path);
}

function optionalBooleanField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): boolean | undefined {
  if (raw[field] === undefined) {
    return undefined;
  }
  if (typeof raw[field] !== "boolean") {
    throw new Error(`${path} ${field} must be a boolean.`);
  }
  return raw[field];
}

function arrayField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): unknown[] {
  const value = raw[field];
  if (!Array.isArray(value)) {
    throw new Error(`${path} ${field} must be an array.`);
  }
  return value;
}

function optionalArrayField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): unknown[] | undefined {
  if (raw[field] === undefined) {
    return undefined;
  }
  return arrayField(raw, field, path);
}

function optionalStringArrayField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): string[] | undefined {
  const value = optionalArrayField(raw, field, path);
  if (value === undefined) {
    return undefined;
  }
  if (!value.every((item) => typeof item === "string")) {
    throw new Error(`${path} ${field} must contain only strings.`);
  }
  return value;
}

function optionalRecordField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): Record<string, unknown> | undefined {
  if (raw[field] === undefined) {
    return undefined;
  }
  return record(raw[field], `${path} ${field}`);
}

function classificationField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): EvalClassification {
  const value = stringField(raw, field, path);
  if (!isEvalClassification(value)) {
    throw new Error(
      `${path} ${field} has unsupported classification: ${value}`,
    );
  }
  return value;
}

function optionalClassificationArrayField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): EvalClassification[] | undefined {
  const values = optionalStringArrayField(raw, field, path);
  if (values === undefined) {
    return undefined;
  }
  const classifications: EvalClassification[] = [];
  for (const value of values) {
    if (!isEvalClassification(value)) {
      throw new Error(
        `${path} ${field} has unsupported classification: ${value}`,
      );
    }
    classifications.push(value);
  }
  return classifications;
}

function optionalPassThresholdField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
): "all" | "majority" | undefined {
  if (raw[field] === undefined) {
    return undefined;
  }
  const value = stringField(raw, field, path);
  if (value !== "all" && value !== "majority") {
    throw new Error(`${path} ${field} must be "all" or "majority".`);
  }
  return value;
}

function isEvalClassification(value: string): value is EvalClassification {
  return EVAL_CLASSIFICATIONS.includes(value as EvalClassification);
}
