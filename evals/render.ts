import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_EVAL_CASES_DIR,
  loadEvalCases,
  prepareEvalCase,
  renderEvalCasePromptMarkdown,
} from "./lib/evalCases";

const casesDir = DEFAULT_EVAL_CASES_DIR;
const cases = await loadEvalCases({ casesDir });

for (const evalCase of cases) {
  const prepared = await prepareEvalCase(evalCase);
  const promptPath = join(casesDir, evalCase.path, "prompt.md");
  await mkdir(dirname(promptPath), { recursive: true });
  await writeFile(
    promptPath,
    `${renderEvalCasePromptMarkdown(prepared)}\n`,
    "utf8",
  );
  console.log(`rendered ${promptPath}`);
}

console.log(`rendered ${cases.length} eval prompts`);
