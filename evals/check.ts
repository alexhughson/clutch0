import {
  DEFAULT_EVAL_CASES_DIR,
  loadEvalCases,
  prepareEvalCase,
  renderEvalCasePromptMarkdown,
} from "./lib/evalCases";

const cases = await loadEvalCases({ casesDir: DEFAULT_EVAL_CASES_DIR });
if (cases.length === 0) {
  throw new Error("No eval cases found.");
}

for (const evalCase of cases) {
  const prepared = await prepareEvalCase(evalCase);
  const prompt = renderEvalCasePromptMarkdown(prepared);
  if (!prompt.includes("## System Prompt")) {
    throw new Error(
      `${evalCase.path} rendered prompt is missing system prompt.`,
    );
  }
  if (!prompt.includes("## Messages")) {
    throw new Error(`${evalCase.path} rendered prompt is missing messages.`);
  }
}

console.log(`checked ${cases.length} eval cases`);
