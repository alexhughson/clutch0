import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_EVAL_CASES_DIR,
  loadEvalCases,
  prepareEvalCase,
  renderEvalCasePromptMarkdown,
} from "./lib/evalCases";
import { writeEvalPatchArtifacts } from "./lib/evalArtifacts";
import {
  parseEvalModelSpec,
  resolveEvalModelRequest,
  runPreparedEvalCase,
  type EvalCaseRunResult,
  type EvalModelSpec,
} from "./lib/liveEval";

type CliOptions = {
  caseFilters: string[];
  casesDir: string;
  judge: EvalModelSpec | "summarization";
  reportOnly: boolean;
  repeat: number;
  targets: EvalModelSpec[];
};

const options = parseCliOptions(Bun.argv.slice(2));
const allCases = await loadEvalCases({ casesDir: options.casesDir });
const cases =
  options.caseFilters.length === 0
    ? allCases
    : allCases.filter((evalCase) =>
        options.caseFilters.some((filter) => evalCase.path.startsWith(filter)),
      );

if (cases.length === 0) {
  throw new Error("No eval cases matched the requested filters.");
}

const runDir = join(
  "eval-runs",
  new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d+Z$/, "Z"),
);
await mkdir(runDir, { recursive: true });

const judgeRequest = await resolveEvalModelRequest(options.judge);
const targetRequests = await Promise.all(
  options.targets.map((target) => resolveEvalModelRequest(target)),
);

const results: EvalCaseRunResult[] = [];
const errors: { casePath: string; error: string; target: string }[] = [];

console.log(
  `running ${cases.length} cases x ${targetRequests.length} targets x ${options.repeat} repeats`,
);
console.log(`judge: ${judgeRequest.label}`);
console.log(`output: ${runDir}`);

for (const targetRequest of targetRequests) {
  console.log(`\n# target ${targetRequest.label}`);
  for (const evalCase of cases) {
    try {
      const prepared = await prepareEvalCase(evalCase);
      await writeFile(
        join(
          runDir,
          `${safeFileName(targetRequest.label)}--${safeFileName(evalCase.path)}.prompt.md`,
        ),
        `${renderEvalCasePromptMarkdown(prepared)}\n`,
        "utf8",
      );
      const result = await writeEvalPatchArtifacts({
        result: await runPreparedEvalCase({
          judgeRequest,
          prepared,
          repeat: options.repeat,
          targetRequest,
        }),
        runDir,
      });
      results.push(result);
      console.log(`${result.passed ? "PASS" : "FAIL"} ${evalCase.path}`);
      for (const attempt of result.attempts) {
        if (!attempt.passed) {
          console.log(`  - ${attempt.failures.join("; ")}`);
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      errors.push({
        casePath: evalCase.path,
        error: message,
        target: targetRequest.label,
      });
      console.log(`ERROR ${evalCase.path}: ${message.split("\n")[0]}`);
    }
  }
}

const report = {
  errors,
  judge: judgeRequest.label,
  repeat: options.repeat,
  results,
  runDir,
  targets: targetRequests.map((request) => request.label),
};
await writeFile(
  join(runDir, "results.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
await writeFile(
  join(runDir, "results.jsonl"),
  `${results
    .flatMap((result) =>
      result.attempts.map((attempt, index) =>
        JSON.stringify({
          attempt: index + 1,
          casePath: result.casePath,
          classification: attempt.classification,
          failures: attempt.failures,
          judge: attempt.judge,
          passed: attempt.passed,
          generatedDiffPath: attempt.generatedDiffPath,
          patchValidationPath: attempt.patchValidationPath,
          patchValidationStatus: attempt.patchValidation?.status,
          target: result.target,
        }),
      ),
    )
    .join("\n")}\n`,
  "utf8",
);

const passed = results.filter((result) => result.passed).length;
const total = results.length + errors.length;
console.log(`\n${passed}/${total} target-case runs passed`);
if ((errors.length > 0 || passed !== total) && !options.reportOnly) {
  process.exitCode = 1;
}

function parseCliOptions(args: string[]): CliOptions {
  const targets: EvalModelSpec[] = [];
  const caseFilters: string[] = [];
  let casesDir = DEFAULT_EVAL_CASES_DIR;
  let judge: EvalModelSpec | "summarization" = "summarization";
  let reportOnly = false;
  let repeat = 3;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--target") {
      targets.push(parseEvalModelSpec(requiredArg(args, (index += 1), arg)));
      continue;
    }
    if (arg === "--judge") {
      judge = parseEvalModelSpec(requiredArg(args, (index += 1), arg));
      continue;
    }
    if (arg === "--case") {
      caseFilters.push(requiredArg(args, (index += 1), arg));
      continue;
    }
    if (arg === "--cases-dir") {
      casesDir = requiredArg(args, (index += 1), arg);
      continue;
    }
    if (arg === "--repeat") {
      repeat = parsePositiveInteger(requiredArg(args, (index += 1), arg), arg);
      continue;
    }
    if (arg === "--report-only") {
      reportOnly = true;
      continue;
    }
    throw new Error(`Unknown eval option: ${arg}`);
  }

  return {
    caseFilters,
    casesDir,
    judge,
    reportOnly,
    repeat,
    targets:
      targets.length === 0
        ? [
            parseEvalModelSpec("cerebras:gpt-oss-120b"),
            parseEvalModelSpec("openai:gpt-5.4"),
          ]
        : targets,
  };
}

function requiredArg(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "__");
}
