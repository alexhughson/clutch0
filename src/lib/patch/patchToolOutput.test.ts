import { expect, test } from "bun:test";
import {
  buildFailedPatchToolOutput,
  buildPatchValidationFailureToolOutput,
  buildSuccessfulPatchToolOutput,
  formatPatchAffectedPathsStdout,
  formatPatchApplyStdout,
} from "./patchToolOutput";

test("formats Codex-style successful apply_patch tool output", () => {
  const output = buildSuccessfulPatchToolOutput({
    changes: {
      "src/old.ts": {
        move_path: "src/renamed.ts",
        type: "update",
        unified_diff: "@@\n-old\n+new\n",
      },
      "src/remove.ts": { content: "", type: "delete" },
      "src/new.ts": { content: "hello\n", type: "add" },
    },
    durationMs: 1250,
  });

  expect(output).toEqual({
    content: [
      "Exit code: 0",
      "Wall time: 1.3 seconds",
      "Output:",
      "Success. Updated the following files:",
      "A src/new.ts",
      "M src/renamed.ts",
      "D src/remove.ts",
      "",
    ].join("\n"),
    exitCode: 0,
    stderr: "",
    stdout:
      "Success. Updated the following files:\nA src/new.ts\nM src/renamed.ts\nD src/remove.ts\n",
    success: true,
  });
});

test("formats Codex-style affected paths without collapsing repeated operations", () => {
  expect(
    formatPatchAffectedPathsStdout({
      added: ["repeat.txt"],
      deleted: ["repeat.txt"],
      modified: ["renamed.txt"],
    }),
  ).toBe(
    "Success. Updated the following files:\nA repeat.txt\nM renamed.txt\nD repeat.txt\n",
  );
});

test("formats apply_patch verification failures for model output", () => {
  expect(
    buildFailedPatchToolOutput({
      errorMessage: "README.md: Failed to find expected lines",
    }),
  ).toEqual({
    content:
      "apply_patch verification failed: README.md: Failed to find expected lines",
    exitCode: 1,
    stderr:
      "apply_patch verification failed: README.md: Failed to find expected lines",
    stdout: "",
    success: false,
  });
});

test("does not duplicate apply_patch verification failure prefix", () => {
  expect(
    buildFailedPatchToolOutput({
      errorMessage: "apply_patch verification failed: bad patch",
    }).content,
  ).toBe("apply_patch verification failed: bad patch");
});

test("does not wrap Codex-style patch rejection output as verification", () => {
  expect(
    buildFailedPatchToolOutput({
      errorMessage: "patch rejected: empty patch",
    }).content,
  ).toBe("patch rejected: empty patch");
});

test("formats patch validation failures as apply_patch tool output", () => {
  const output = buildPatchValidationFailureToolOutput({
    result: {
      errors: [
        {
          editIndex: 0,
          message: "expected context not found",
          path: "README.md",
        },
      ],
      proposal: {
        patch:
          "*** Begin Patch\n*** Update File: README.md\n@@\n-old\n+new\n*** End Patch\n",
        summary: "Update README",
      },
      status: "invalid",
    },
  });

  expect(output).toMatchObject({
    exitCode: 1,
    stderr:
      "apply_patch verification failed: README.md: expected context not found",
    success: false,
  });
  expect(output.content).toBe(output.stderr);
});

test("formats pathless validation failures without an unknown path", () => {
  expect(
    buildPatchValidationFailureToolOutput({
      result: {
        errors: [
          {
            editIndex: 0,
            message:
              'patch detected without explicit call to apply_patch. Rerun as ["apply_patch", "<patch>"]',
          },
        ],
        proposal: {
          patch:
            "*** Begin Patch\n*** Add File: hello.txt\n+hello\n*** End Patch",
          summary: "Implicit patch",
        },
        status: "invalid",
      },
    }).content,
  ).toBe(
    'apply_patch verification failed: patch detected without explicit call to apply_patch. Rerun as ["apply_patch", "<patch>"]',
  );
});

test("formats empty patch validation failures with Codex's managed-tool rejection", () => {
  expect(
    buildPatchValidationFailureToolOutput({
      result: {
        errors: [
          {
            editIndex: 0,
            message: "patch rejected: empty patch",
          },
        ],
        proposal: {
          patch: "*** Begin Patch\n*** End Patch",
          summary: "Empty patch",
        },
        status: "invalid",
      },
    }).content,
  ).toBe("patch rejected: empty patch");
});

test("formats patch apply stdout without model metadata", () => {
  expect(
    formatPatchApplyStdout({
      "README.md": {
        type: "update",
        unified_diff: "@@\n-old\n+new\n",
      },
    }),
  ).toBe("Success. Updated the following files:\nM README.md\n");
});
