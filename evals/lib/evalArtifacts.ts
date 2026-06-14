import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvalCaseRunResult } from "./liveEval";

export async function writeEvalPatchArtifacts({
  result,
  runDir,
}: {
  result: EvalCaseRunResult;
  runDir: string;
}): Promise<EvalCaseRunResult> {
  const artifactDir = join(runDir, "patches");
  const attempts = await Promise.all(
    result.attempts.map(async (attempt, index) => {
      if (attempt.patchValidation === undefined) {
        return attempt;
      }

      await mkdir(artifactDir, { recursive: true });
      const basename = `${safeFileName(result.target)}--${safeFileName(result.casePath)}--attempt-${index + 1}`;
      const patchValidationPath = join(
        "patches",
        `${basename}.patch-validation.json`,
      );
      await writeFile(
        join(runDir, patchValidationPath),
        `${JSON.stringify(attempt.patchValidation, null, 2)}\n`,
        "utf8",
      );

      if (attempt.patchValidation.status !== "valid") {
        return {
          ...attempt,
          patchValidationPath,
        };
      }

      const generatedDiffPath = join("patches", `${basename}.diff`);
      await writeFile(
        join(runDir, generatedDiffPath),
        `${attempt.patchValidation.diffText}\n`,
        "utf8",
      );

      return {
        ...attempt,
        generatedDiffPath,
        patchValidationPath,
      };
    }),
  );

  return {
    ...result,
    attempts,
  };
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "__");
}
