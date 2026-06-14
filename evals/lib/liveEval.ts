import {
  complete,
  completeSimple,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type TextContent,
  type ToolCall,
} from "@earendil-works/pi-ai";
import {
  DEFAULT_CLUTCH_MODEL_EFFORT_LEVEL,
  DEFAULT_CLUTCH_MODEL_SERVICE_TIER,
  hasUsableApiKey,
  isSupportedClutchProvider,
  loadClutchAuth,
  resolveConfiguredLlmRequest,
  type ResolvedConfiguredLlmRequest,
  type SupportedClutchLlmProvider,
} from "../../src/lib/config/clutchConfig";
import { modelsFromProviderResponse } from "../../src/lib/config/providerModels";
import { patchProposalFromToolCall } from "../../src/lib/llm/patchTool";
import { renderPrompt } from "../../src/lib/llm/prompts";
import {
  configuredLlmRequestOptions,
  usesProviderSpecificRequestOptions,
} from "../../src/lib/llm/requestOptions";
import { validatePatchProposal } from "../../src/lib/patch/patchEngine";
import type {
  PatchProposal,
  PatchValidationResult,
} from "../../src/lib/patch/types";
import {
  classificationPasses,
  type EvalCaseExpected,
  type EvalClassification,
  type PreparedEvalCase,
} from "./evalCases";

export type EvalModelSpec = {
  label: string;
  modelId: string;
  provider: SupportedClutchLlmProvider;
};

export type EvalModelRequest = ResolvedConfiguredLlmRequest & {
  label: string;
};

export type NormalizedAssistantResult = {
  assistantText: string;
  classification: EvalClassification;
  rawAssistantMessage: AssistantMessage;
  toolCall?: ToolCall;
  toolCalls: ToolCall[];
};

export type EvalAttemptResult = NormalizedAssistantResult & {
  casePath: string;
  failures: string[];
  generatedDiffPath?: string;
  judge?: JudgeResult;
  patchValidationPath?: string;
  passed: boolean;
  patchValidation?: PatchValidationResult;
  target: string;
};

export type EvalCaseRunResult = {
  attempts: EvalAttemptResult[];
  casePath: string;
  passed: boolean;
  target: string;
};

export type JudgeResult = {
  passed: boolean;
  rationale: string;
  score: number;
};

export function parseEvalModelSpec(value: string): EvalModelSpec {
  const separator = value.indexOf(":");
  if (separator === -1) {
    throw new Error(
      `Eval model spec must use provider:model format. Received: ${value}`,
    );
  }

  const provider = value.slice(0, separator);
  const modelId = value.slice(separator + 1);
  if (!isSupportedClutchProvider(provider)) {
    throw new Error(`Unsupported eval model provider: ${provider}`);
  }
  if (modelId.trim().length === 0) {
    throw new Error(`Eval model spec is missing a model id: ${value}`);
  }

  return {
    label: value,
    modelId,
    provider,
  };
}

export async function resolveEvalModelRequest(
  spec: EvalModelSpec | "summarization",
): Promise<EvalModelRequest> {
  if (spec === "summarization") {
    return {
      ...(await resolveConfiguredLlmRequest("summarization")),
      label: "summarization",
    };
  }

  const credential = loadClutchAuth()[spec.provider];
  if (credential?.type !== "api_key" || !hasUsableApiKey(credential)) {
    throw new Error(
      `Missing saved Clutch API key for provider "${spec.provider}". Run /config before live evals.`,
    );
  }

  return {
    apiKey: credential.key,
    effortLevel: DEFAULT_CLUTCH_MODEL_EFFORT_LEVEL,
    label: spec.label,
    model: modelFromProviderAndId(spec),
    serviceTier: DEFAULT_CLUTCH_MODEL_SERVICE_TIER,
  };
}

export async function completeEvalRequest({
  context,
  request,
}: {
  context: Context;
  request: EvalModelRequest;
}): Promise<AssistantMessage> {
  const options = configuredLlmRequestOptions(request);
  return await (usesProviderSpecificRequestOptions(request)
    ? complete(request.model, context, options)
    : completeSimple(request.model, context, options));
}

export async function runPreparedEvalCase({
  judgeRequest,
  prepared,
  repeat,
  targetRequest,
}: {
  judgeRequest: EvalModelRequest;
  prepared: PreparedEvalCase;
  repeat: number;
  targetRequest: EvalModelRequest;
}): Promise<EvalCaseRunResult> {
  const attempts: EvalAttemptResult[] = [];
  for (let index = 0; index < repeat; index += 1) {
    attempts.push(
      await runPreparedEvalCaseAttempt({
        judgeRequest,
        prepared,
        targetRequest,
      }),
    );
  }

  const passCount = attempts.filter((attempt) => attempt.passed).length;
  return {
    attempts,
    casePath: prepared.path,
    passed: evalCaseRunPasses({
      passCount,
      repeat,
      threshold: prepared.expected.repeat?.passThreshold ?? "majority",
    }),
    target: targetRequest.label,
  };
}

export async function runPreparedEvalCaseAttempt({
  judgeRequest,
  prepared,
  targetRequest,
}: {
  judgeRequest: EvalModelRequest;
  prepared: PreparedEvalCase;
  targetRequest: EvalModelRequest;
}): Promise<EvalAttemptResult> {
  const assistantMessage = await completeEvalRequest({
    context: prepared.context,
    request: targetRequest,
  });
  const normalized = normalizeAssistantMessage(assistantMessage);
  const failures = await scoreStructuredExpectations({
    normalized,
    prepared,
  });
  const judge =
    prepared.expected.judge === undefined
      ? undefined
      : await judgeEvalAttempt({
          judgeRequest,
          normalized,
          patchValidation: failures.patchValidation,
          prepared,
        });

  const failureMessages = failures.failures;
  if (judge !== undefined && !judge.passed) {
    failureMessages.push(
      `judge score ${judge.score} was below ${prepared.expected.judge?.minScore ?? 4}: ${judge.rationale}`,
    );
  }

  return {
    ...normalized,
    casePath: prepared.path,
    failures: failureMessages,
    judge,
    passed: failureMessages.length === 0,
    patchValidation: failures.patchValidation,
    target: targetRequest.label,
  };
}

export function normalizeAssistantMessage(
  message: AssistantMessage,
): NormalizedAssistantResult {
  const toolCalls = message.content.filter(
    (block): block is ToolCall => block.type === "toolCall",
  );
  const assistantText = message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  if (toolCalls.length === 0) {
    return {
      assistantText,
      classification: "text",
      rawAssistantMessage: message,
      toolCalls,
    };
  }

  return {
    assistantText,
    classification: toolCalls[0]!.name as EvalClassification,
    rawAssistantMessage: message,
    toolCall: toolCalls[0],
    toolCalls,
  };
}

async function scoreStructuredExpectations({
  normalized,
  prepared,
}: {
  normalized: NormalizedAssistantResult;
  prepared: PreparedEvalCase;
}): Promise<{
  failures: string[];
  patchValidation?: PatchValidationResult;
}> {
  const failures: string[] = [];
  const { expected } = prepared;

  if (!classificationPasses({ actual: normalized.classification, expected })) {
    failures.push(
      `expected ${formatExpectedClassifications(expected)}, got ${normalized.classification}`,
    );
  }
  if (normalized.toolCalls.length > 1) {
    failures.push(
      `expected at most one tool call, got ${normalized.toolCalls.length}`,
    );
  }

  if (
    expected.toolArguments !== undefined &&
    !matchesExpectedSubset(
      normalized.toolCall?.arguments,
      expected.toolArguments,
    )
  ) {
    failures.push(
      `tool arguments did not include expected subset ${JSON.stringify(expected.toolArguments)}`,
    );
  }

  let patchProposal: PatchProposal | undefined;
  let patchValidation: PatchValidationResult | undefined;
  if (
    normalized.classification === "propose_patch" &&
    normalized.toolCall !== undefined
  ) {
    try {
      const proposal = patchProposalFromToolCall(normalized.toolCall);
      patchProposal = proposal;
      patchValidation = await validatePatchProposal({
        proposal,
        root: prepared.root,
      });
    } catch (error) {
      failures.push(
        `could not parse propose_patch call: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  scorePatchPathExpectations({
    expected,
    failures,
    proposal: patchProposal,
  });

  if (expected.patch?.required === true && patchValidation === undefined) {
    failures.push("expected a patch proposal");
  }
  if (
    expected.patch?.mustBeValid === true &&
    patchValidation?.status !== "valid"
  ) {
    failures.push(
      patchValidation === undefined
        ? "expected a valid patch proposal"
        : `patch proposal was invalid: ${JSON.stringify(patchValidation.errors)}`,
    );
  }
  scorePatchDiffExpectations({
    expected,
    failures,
    patchValidation,
  });

  return { failures, patchValidation };
}

function scorePatchPathExpectations({
  expected,
  failures,
  proposal,
}: {
  expected: EvalCaseExpected;
  failures: string[];
  proposal?: PatchProposal;
}) {
  const requiredPaths = expected.patch?.requiredPaths ?? [];
  const forbiddenPaths = expected.patch?.forbiddenPaths ?? [];
  const allowedPaths = expected.patch?.allowedPaths;
  if (
    requiredPaths.length === 0 &&
    forbiddenPaths.length === 0 &&
    allowedPaths === undefined
  ) {
    return;
  }

  if (proposal === undefined) {
    failures.push("expected a parseable patch proposal for path assertions");
    return;
  }

  const actualPaths = proposal.edits.map((edit) => edit.path);
  const actualPathSet = new Set(actualPaths);
  for (const path of requiredPaths) {
    if (!actualPathSet.has(path)) {
      failures.push(
        `patch did not include required path ${path}; got ${actualPaths.join(", ") || "(none)"}`,
      );
    }
  }
  for (const path of forbiddenPaths) {
    if (actualPathSet.has(path)) {
      failures.push(`patch included forbidden path ${path}`);
    }
  }
  if (allowedPaths !== undefined) {
    const allowedPathSet = new Set(allowedPaths);
    const unexpectedPaths = actualPaths.filter(
      (path) => !allowedPathSet.has(path),
    );
    if (unexpectedPaths.length > 0) {
      failures.push(
        `patch edited unexpected path(s) ${[...new Set(unexpectedPaths)].join(", ")}; allowed ${allowedPaths.join(", ")}`,
      );
    }
  }
}

function scorePatchDiffExpectations({
  expected,
  failures,
  patchValidation,
}: {
  expected: EvalCaseExpected;
  failures: string[];
  patchValidation?: PatchValidationResult;
}) {
  const diffIncludes = expected.patch?.diffIncludes ?? [];
  const diffExcludes = expected.patch?.diffExcludes ?? [];
  if (diffIncludes.length === 0 && diffExcludes.length === 0) {
    return;
  }

  if (patchValidation?.status !== "valid") {
    failures.push("expected a valid generated diff for diff assertions");
    return;
  }

  for (const expectedText of diffIncludes) {
    if (!patchValidation.diffText.includes(expectedText)) {
      failures.push(
        `generated diff did not include expected text ${JSON.stringify(expectedText)}`,
      );
    }
  }
  for (const forbiddenText of diffExcludes) {
    if (patchValidation.diffText.includes(forbiddenText)) {
      failures.push(
        `generated diff included forbidden text ${JSON.stringify(forbiddenText)}`,
      );
    }
  }
}

async function judgeEvalAttempt({
  judgeRequest,
  normalized,
  patchValidation,
  prepared,
}: {
  judgeRequest: EvalModelRequest;
  normalized: NormalizedAssistantResult;
  patchValidation?: PatchValidationResult;
  prepared: PreparedEvalCase;
}): Promise<JudgeResult> {
  const judgePrompt = renderPrompt("evals/judge.md", {
    assistantText:
      normalized.assistantText.trim().length === 0
        ? "(no assistant text)"
        : normalized.assistantText,
    casePath: prepared.path,
    classification: normalized.classification,
    expected: JSON.stringify(prepared.expected, null, 2),
    patchValidation:
      patchValidation === undefined
        ? "(none)"
        : JSON.stringify(patchValidation, null, 2),
    question: prepared.input.question,
    rubric: prepared.expected.judge?.rubric ?? "",
    toolCall:
      normalized.toolCall === undefined
        ? "(none)"
        : JSON.stringify(normalized.toolCall, null, 2),
  });
  const message = await completeEvalRequest({
    context: {
      messages: [
        {
          content: judgePrompt,
          role: "user",
          timestamp: Date.now(),
        },
      ],
    },
    request: judgeRequest,
  });
  const parsed = parseJudgeResponse(getAssistantText(message));
  const minScore = prepared.expected.judge?.minScore ?? 4;
  return {
    ...parsed,
    passed: parsed.score >= minScore && parsed.passed,
  };
}

function parseJudgeResponse(text: string): JudgeResult {
  const objectText = extractJsonObject(text);
  const parsed = JSON.parse(objectText) as Partial<JudgeResult>;
  if (typeof parsed.score !== "number" || !Number.isFinite(parsed.score)) {
    throw new Error("Judge response must include numeric score.");
  }
  if (typeof parsed.passed !== "boolean") {
    throw new Error("Judge response must include boolean passed.");
  }
  if (typeof parsed.rationale !== "string") {
    throw new Error("Judge response must include string rationale.");
  }
  return {
    passed: parsed.passed,
    rationale: parsed.rationale,
    score: parsed.score,
  };
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Judge response did not contain a JSON object.");
  }
  return text.slice(start, end + 1);
}

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function modelFromProviderAndId(spec: EvalModelSpec): Model<Api> {
  const models = modelsFromProviderResponse({
    provider: spec.provider,
    responseJson: { data: [{ id: spec.modelId }] },
  });
  const model = models[0];
  if (model === undefined) {
    throw new Error(`Could not create model metadata for ${spec.label}`);
  }
  return model;
}

function evalCaseRunPasses({
  passCount,
  repeat,
  threshold,
}: {
  passCount: number;
  repeat: number;
  threshold: "all" | "majority";
}): boolean {
  if (threshold === "all") {
    return passCount === repeat;
  }

  return passCount > repeat / 2;
}

function formatExpectedClassifications(expected: EvalCaseExpected): string {
  return (expected.allowedClassifications ?? [expected.classification]).join(
    " or ",
  );
}

function matchesExpectedSubset(
  actual: unknown,
  expected: Record<string, unknown>,
): boolean {
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    return false;
  }
  const actualRecord = actual as Record<string, unknown>;
  return Object.entries(expected).every(([key, expectedValue]) =>
    matchesValueSubset(actualRecord[key], expectedValue),
  );
}

function matchesValueSubset(actual: unknown, expected: unknown): boolean {
  if (
    expected !== null &&
    typeof expected === "object" &&
    !Array.isArray(expected)
  ) {
    return matchesExpectedSubset(actual, expected as Record<string, unknown>);
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.every((expectedItem) =>
        actual.some((actualItem) =>
          matchesValueSubset(actualItem, expectedItem),
        ),
      )
    );
  }
  return actual === expected;
}
