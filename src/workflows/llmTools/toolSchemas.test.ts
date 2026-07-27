import { expect, test } from "bun:test";
import { applyPatchTool } from "../../lib/llm/patchTool";
import { addContextFilesTool } from "../addFiles/addFilesWorkflowTool";
import { createFileTool } from "../createFile/createFileWorkflowTool";
import { findRelevantFilesTool } from "../findFiles/findFilesTool";
import { getLlmWorkflowTools } from "./toolRegistry";
import { runShellCommandTool } from "./shellCommandWorkflowTool";

const workflowTools = getLlmWorkflowTools({
  allowedToolNames: [
    addContextFilesTool.name,
    createFileTool.name,
    findRelevantFilesTool.name,
    applyPatchTool.name,
    runShellCommandTool.name,
  ],
});

test.each(workflowTools.map((tool) => [tool.name, tool] as const))(
  "%s parameters include a required array",
  (_name, tool) => {
    const parameters = tool.parameters;
    expect(parameters.type).toBe("object");
    expect(Array.isArray(parameters.required)).toBe(true);
    expect((parameters.required as string[]).length).toBeGreaterThan(0);
  },
);

test("find_relevant_files required omits optional hints", () => {
  expect(findRelevantFilesTool.parameters.required).toEqual(["goal"]);
  expect(findRelevantFilesTool.parameters.properties).toHaveProperty("hints");
});

test("apply_patch required includes input only", () => {
  expect(applyPatchTool.parameters.required).toEqual(["input"]);
});

test("create_file required includes summary, path, and content", () => {
  expect(createFileTool.parameters.required).toEqual([
    "summary",
    "path",
    "content",
  ]);
});

test("add_context_files required includes paths", () => {
  expect(addContextFilesTool.parameters.required).toEqual(["paths"]);
});

test("run_shell_command required includes command", () => {
  expect(runShellCommandTool.parameters.required).toEqual(["command"]);
});
