import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ToolCall } from "@earendil-works/pi-ai";
import { APPLY_PATCH_TOOL_NAME } from "../../lib/llm/patchTool";
import { ADD_CONTEXT_FILES_TOOL_NAME } from "../addFiles/addFilesWorkflowTool";
import { FIND_RELEVANT_FILES_TOOL_NAME } from "../findFiles/findFilesTool";
import { CREATE_FILE_TOOL_NAME } from "../createFile/createFileWorkflowTool";
import { RUN_SHELL_COMMAND_TOOL_NAME } from "./shellCommandWorkflowTool";
import {
  getLlmSlashCommands,
  getLlmWorkflowTools,
  parseLlmSlashCommandInvocation,
  routeLlmWorkflowToolCalls,
} from "./toolRegistry";

test("routes add context files tool calls to the add files workflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-add-files-"));
  await writeFile(join(root, "one.ts"), "export const one = 1;\n", "utf8");
  await writeFile(join(root, "two.ts"), "export const two = 2;\n", "utf8");

  const result = await routeLlmWorkflowToolCalls({
    root,
    toolCalls: [
      {
        type: "toolCall",
        id: "tool-1",
        name: ADD_CONTEXT_FILES_TOOL_NAME,
        arguments: {
          paths: ["one.ts", "two.ts", "one.ts"],
        },
      } satisfies ToolCall,
    ],
  });

  expect(result).toEqual({
    kind: "add-files",
    paths: ["one.ts", "two.ts"],
  });
});

test("routes find relevant files tool calls to the find files workflow", async () => {
  const result = await routeLlmWorkflowToolCalls({
    toolCalls: [
      {
        type: "toolCall",
        id: "tool-1",
        name: FIND_RELEVANT_FILES_TOOL_NAME,
        arguments: {
          goal: "Find routing code",
          hints: ["App", "screen"],
        },
      } satisfies ToolCall,
    ],
  });

  expect(result).toEqual({
    kind: "find-files",
    goal: "Find routing code",
    hints: ["App", "screen"],
  });
});

test("routes create file tool calls to the create file workflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-create-file-"));
  const result = await routeLlmWorkflowToolCalls({
    root,
    toolCalls: [
      {
        type: "toolCall",
        id: "tool-1",
        name: CREATE_FILE_TOOL_NAME,
        arguments: {
          content: "export const value = 1;\n",
          path: "src/newFile.ts",
          summary: "Add new file",
        },
      } satisfies ToolCall,
    ],
  });

  expect(result).toEqual({
    kind: "create-file",
    validation: {
      proposal: {
        content: "export const value = 1;\n",
        path: "src/newFile.ts",
        summary: "Add new file",
      },
      status: "valid",
    },
  });
});

test("routes shell command tool calls and captures output", async () => {
  const result = await routeLlmWorkflowToolCalls({
    allowedToolNames: [RUN_SHELL_COMMAND_TOOL_NAME],
    toolCalls: [
      {
        type: "toolCall",
        id: "tool-1",
        name: RUN_SHELL_COMMAND_TOOL_NAME,
        arguments: {
          command: "printf clutch-cmd",
        },
      } satisfies ToolCall,
    ],
  });

  expect(result).toMatchObject({
    kind: "command-output",
    result: {
      command: "printf clutch-cmd",
      exitCode: 0,
      stdout: "clutch-cmd",
    },
  });
});

test("routes apply_patch input tool calls to patch review", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-input-patch-"));
  await writeFile(join(root, "file.ts"), "const value = 1;\n", "utf8");

  const result = await routeLlmWorkflowToolCalls({
    root,
    toolCalls: [
      {
        type: "toolCall",
        id: "tool-1",
        name: APPLY_PATCH_TOOL_NAME,
        arguments: {
          input: [
            "*** Begin Patch",
            "*** Update File: file.ts",
            "@@",
            "-const value = 1;",
            "+const value = 2;",
            "*** End Patch",
          ].join("\n"),
        },
      } satisfies ToolCall,
    ],
  });

  expect(result?.kind).toBe("patch");
  expect(result?.kind === "patch" ? result.patch.status : "invalid").toBe(
    "valid",
  );
});

test("routes shell apply_patch heredocs into patch review", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-shell-patch-"));
  await writeFile(join(root, "file.ts"), "const value = 1;\n", "utf8");

  const result = await routeLlmWorkflowToolCalls({
    allowedToolNames: [RUN_SHELL_COMMAND_TOOL_NAME],
    root,
    toolCalls: [
      {
        type: "toolCall",
        id: "tool-1",
        name: RUN_SHELL_COMMAND_TOOL_NAME,
        arguments: {
          command: [
            "apply_patch <<'PATCH'",
            "*** Begin Patch",
            "*** Update File: file.ts",
            "@@",
            "-const value = 1;",
            "+const value = 2;",
            "*** End Patch",
            "PATCH",
          ].join("\n"),
        },
      } satisfies ToolCall,
    ],
  });

  expect(result?.kind).toBe("patch");
  expect(result?.kind === "patch" ? result.patch.status : "invalid").toBe(
    "valid",
  );
  expect(await Bun.file(join(root, "file.ts")).text()).toBe(
    "const value = 1;\n",
  );
});

test("routes shell apply_patch argument commands into patch review", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-shell-direct-patch-"));
  await writeFile(join(root, "file.ts"), "const value = 1;\n", "utf8");

  const result = await routeLlmWorkflowToolCalls({
    allowedToolNames: [RUN_SHELL_COMMAND_TOOL_NAME],
    root,
    toolCalls: [
      {
        type: "toolCall",
        id: "tool-1",
        name: RUN_SHELL_COMMAND_TOOL_NAME,
        arguments: {
          command: [
            "apply_patch '*** Begin Patch",
            "*** Update File: file.ts",
            "@@",
            "-const value = 1;",
            "+const value = 2;",
            "*** End Patch'",
          ].join("\n"),
        },
      } satisfies ToolCall,
    ],
  });

  expect(result?.kind).toBe("patch");
  expect(result?.kind === "patch" ? result.patch.status : "invalid").toBe(
    "valid",
  );
  expect(await Bun.file(join(root, "file.ts")).text()).toBe(
    "const value = 1;\n",
  );
});

test("routes cd shell apply_patch heredocs into root-relative patch review", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-shell-cd-patch-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/file.ts"), "const value = 1;\n", "utf8");

  const result = await routeLlmWorkflowToolCalls({
    allowedToolNames: [RUN_SHELL_COMMAND_TOOL_NAME],
    root,
    toolCalls: [
      {
        type: "toolCall",
        id: "tool-1",
        name: RUN_SHELL_COMMAND_TOOL_NAME,
        arguments: {
          command: [
            "cd src && apply_patch <<'PATCH'",
            "*** Begin Patch",
            "*** Update File: file.ts",
            "@@",
            "-const value = 1;",
            "+const value = 2;",
            "*** End Patch",
            "PATCH",
          ].join("\n"),
        },
      } satisfies ToolCall,
    ],
  });

  expect(result?.kind).toBe("patch");
  expect(result?.kind === "patch" ? result.patch.status : "invalid").toBe(
    "valid",
  );
  if (result?.kind !== "patch" || result.patch.status !== "valid") {
    throw new Error("Expected valid patch result.");
  }
  expect(result.patch.diffText).toContain("--- src/file.ts");
  expect(await Bun.file(join(root, "src/file.ts")).text()).toBe(
    "const value = 1;\n",
  );
});

test("rejects implicit shell patch bodies as patch validation failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-shell-implicit-patch-"));

  const result = await routeLlmWorkflowToolCalls({
    allowedToolNames: [RUN_SHELL_COMMAND_TOOL_NAME],
    root,
    toolCalls: [
      {
        type: "toolCall",
        id: "tool-1",
        name: RUN_SHELL_COMMAND_TOOL_NAME,
        arguments: {
          command: [
            "bash -lc '*** Begin Patch",
            "*** Add File: hello.txt",
            "+hello",
            "*** End Patch'",
          ].join("\n"),
        },
      } satisfies ToolCall,
    ],
  });

  expect(result).toMatchObject({
    kind: "patch",
    patch: {
      errors: [
        {
          message:
            'patch detected without explicit call to apply_patch. Rerun as ["apply_patch", "<patch>"]',
          path: "",
        },
      ],
      status: "invalid",
    },
  });
  expect(await Bun.file(join(root, "hello.txt")).exists()).toBe(false);
});

test("routes abort signals into shell command tool calls", async () => {
  const controller = new AbortController();
  const resultPromise = routeLlmWorkflowToolCalls({
    allowedToolNames: [RUN_SHELL_COMMAND_TOOL_NAME],
    signal: controller.signal,
    toolCalls: [
      {
        type: "toolCall",
        id: "tool-1",
        name: RUN_SHELL_COMMAND_TOOL_NAME,
        arguments: {
          command: "sleep 10",
        },
      } satisfies ToolCall,
    ],
  });

  controller.abort();
  const result = await resultPromise;

  expect(result).toMatchObject({
    kind: "command-output",
    result: {
      exitCode: null,
      signal: "SIGTERM",
      timedOut: false,
    },
  });
});

test("exposes shell commands to unrestricted LLM requests", async () => {
  expect(getLlmWorkflowTools().map((tool) => tool.name)).toContain(
    RUN_SHELL_COMMAND_TOOL_NAME,
  );

  const result = await routeLlmWorkflowToolCalls({
    toolCalls: [
      {
        type: "toolCall",
        id: "tool-1",
        name: RUN_SHELL_COMMAND_TOOL_NAME,
        arguments: {
          command: "printf clutch-cmd",
        },
      } satisfies ToolCall,
    ],
  });

  expect(result).toMatchObject({
    kind: "command-output",
    result: {
      command: "printf clutch-cmd",
      exitCode: 0,
      stdout: "clutch-cmd",
    },
  });
});

test("restricts workflow tools by allowed tool names", () => {
  expect(
    getLlmWorkflowTools({ allowedToolNames: [] }).map((tool) => tool.name),
  ).toEqual([]);
  expect(
    getLlmWorkflowTools({
      allowedToolNames: [FIND_RELEVANT_FILES_TOOL_NAME],
    }).map((tool) => tool.name),
  ).toEqual([FIND_RELEVANT_FILES_TOOL_NAME]);
  expect(() =>
    getLlmWorkflowTools({ allowedToolNames: ["missing_tool"] }),
  ).toThrow("Allowed workflow tool is not registered");
});

test("rejects multiple workflow tool calls in one response", async () => {
  await expect(
    routeLlmWorkflowToolCalls({
      toolCalls: [
        {
          type: "toolCall",
          id: "tool-1",
          name: FIND_RELEVANT_FILES_TOOL_NAME,
          arguments: {
            goal: "Find routing code",
          },
        } satisfies ToolCall,
        {
          type: "toolCall",
          id: "tool-2",
          name: FIND_RELEVANT_FILES_TOOL_NAME,
          arguments: {
            goal: "Find config code",
          },
        } satisfies ToolCall,
      ],
    }),
  ).rejects.toThrow("accepts exactly one tool call per response");
});

test("rejects malformed workflow tool calls", async () => {
  await expect(
    routeLlmWorkflowToolCalls({
      toolCalls: [
        {
          type: "toolCall",
          id: "tool-1",
          name: FIND_RELEVANT_FILES_TOOL_NAME,
          arguments: {},
        } satisfies ToolCall,
      ],
    }),
  ).rejects.toThrow("find_relevant_files.goal must be a non-empty string");
});

test("derives slash commands from workflow tools plus ask", () => {
  const commands = getLlmSlashCommands();

  expect(commands.map((command) => command.name)).toEqual([
    "ask",
    "agent-ask",
    "agent-edit",
    "config",
    "show-context",
    "say",
    "add",
    "create",
    "find",
    "edit",
    "cmd",
  ]);
  expect(
    commands.find((command) => command.name === "ask")?.allowedToolNames,
  ).toEqual([]);
  expect(
    commands.find((command) => command.name === "config")?.allowedToolNames,
  ).toEqual([]);
  expect(
    commands.find((command) => command.name === "show-context")
      ?.allowedToolNames,
  ).toEqual([]);
  expect(
    commands.find((command) => command.name === "say")?.allowedToolNames,
  ).toEqual([]);
  expect(
    commands.find((command) => command.name === "add")?.allowedToolNames,
  ).toEqual([ADD_CONTEXT_FILES_TOOL_NAME]);
  expect(
    commands.find((command) => command.name === "create")?.allowedToolNames,
  ).toEqual([CREATE_FILE_TOOL_NAME]);
  expect(
    commands.find((command) => command.name === "edit")?.allowedToolNames,
  ).toEqual([APPLY_PATCH_TOOL_NAME]);
  expect(
    commands.find((command) => command.name === "edit")?.patchToolMode,
  ).toBe("review");
  expect(
    commands.find((command) => command.name === "find")?.allowedToolNames,
  ).toEqual([FIND_RELEVANT_FILES_TOOL_NAME]);
  expect(
    commands.find((command) => command.name === "cmd")?.allowedToolNames,
  ).toEqual([RUN_SHELL_COMMAND_TOOL_NAME]);
});

test("parses known slash commands and leaves unknown commands unrestricted", () => {
  expect(parseLlmSlashCommandInvocation("/add auth routing")).toMatchObject({
    command: {
      allowedToolNames: [ADD_CONTEXT_FILES_TOOL_NAME],
      name: "add",
    },
    input: "auth routing",
  });
  expect(parseLlmSlashCommandInvocation("/find auth routing")).toMatchObject({
    command: {
      allowedToolNames: [FIND_RELEVANT_FILES_TOOL_NAME],
      name: "find",
    },
    input: "auth routing",
  });
  expect(parseLlmSlashCommandInvocation("/config")).toMatchObject({
    command: {
      allowsEmptyInput: true,
      name: "config",
    },
    input: "",
  });
  expect(
    parseLlmSlashCommandInvocation("/say keep this in mind"),
  ).toMatchObject({
    command: {
      allowsEmptyInput: true,
      name: "say",
    },
    input: "keep this in mind",
  });
  expect(parseLlmSlashCommandInvocation("/wat auth routing")).toBeNull();
});
