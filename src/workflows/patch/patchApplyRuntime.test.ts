import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import type { SessionRecorder } from "../../lib/session/sessionRecorder";
import { setSessionRecorder } from "../../store/appStore";
import { applyPatchProposalWithRuntimeEvents } from "./patchApplyRuntime";

afterEach(() => {
  setSessionRecorder(null);
});

test("records Codex-style patch apply begin and end events", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-patch-runtime-"));
  await writeFile(join(root, "README.md"), "old\n", "utf8");
  const events: Record<string, unknown>[] = [];
  const recorder: SessionRecorder = {
    close: async () => {},
    flush: async () => {},
    recordRuntimeEvent: (event) => {
      events.push(event);
    },
    recordStateChange: () => {},
  };
  setSessionRecorder(recorder);

  const result = await applyPatchProposalWithRuntimeEvents({
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: README.md",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
      summary: "Update README",
      toolCallId: "call_patch_1",
    },
    requestId: 42,
    root,
  });

  expect(result.status).toBe("valid");
  expect(result.toolOutput).toMatchObject({
    exitCode: 0,
    stderr: "",
    stdout: "Success. Updated the following files:\nM README.md\n",
    success: true,
  });
  expect(result.toolOutput.content).toMatch(/^Exit code: 0\nWall time: /);
  expect(result.toolOutput.content).toContain(
    "Success. Updated the following files:\nM README.md\n",
  );
  expect(await readFile(join(root, "README.md"), "utf8")).toBe("new\n");
  expect(events).toEqual([
    expect.objectContaining({
      auto_approved: false,
      call_id: "call_patch_1",
      changes: {
        "README.md": {
          type: "update",
          unified_diff: "@@\n-old\n+new\n",
        },
      },
      kind: "patch-apply.begin",
      requestId: 42,
    }),
    expect.objectContaining({
      call_id: "call_patch_1",
      kind: "patch-apply.end",
      requestId: 42,
      status: "completed",
      stderr: "",
      stdout: "Success. Updated the following files:\nM README.md\n",
      success: true,
      toolOutput: {
        content: result.toolOutput.content,
        success: true,
      },
    }),
  ]);
});

test("successful patch output preserves repeated affected path operations", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-patch-runtime-repeat-"));

  const result = await applyPatchProposalWithRuntimeEvents({
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Add File: repeat.txt",
        "+hello",
        "*** Delete File: repeat.txt",
        "*** End Patch",
      ].join("\n"),
      summary: "Create then delete file",
    },
    root,
  });

  expect(result.status).toBe("valid");
  expect(result.toolOutput.stdout).toBe(
    "Success. Updated the following files:\nA repeat.txt\nD repeat.txt\n",
  );
});

test("records failed patch apply events for stale patches", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-patch-runtime-fail-"));
  await writeFile(join(root, "README.md"), "current\n", "utf8");
  const events: Record<string, unknown>[] = [];
  setSessionRecorder({
    close: async () => {},
    flush: async () => {},
    recordRuntimeEvent: (event) => {
      events.push(event);
    },
    recordStateChange: () => {},
  });

  const result = await applyPatchProposalWithRuntimeEvents({
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Update File: README.md",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
      summary: "Update README",
      toolCallId: "call_patch_2",
    },
    root,
  });

  expect(result.status).toBe("invalid");
  expect(result.toolOutput).toMatchObject({
    content: expect.stringContaining("apply_patch verification failed:"),
    exitCode: 1,
    stdout: "",
    success: false,
  });
  expect(await readFile(join(root, "README.md"), "utf8")).toBe("current\n");
  expect(events.map((event) => event.kind)).toEqual([
    "patch-apply.begin",
    "patch-apply.end",
  ]);
  expect(events[1]).toMatchObject({
    call_id: "call_patch_2",
    stderr: result.toolOutput.stderr,
    status: "failed",
    success: false,
    toolOutput: {
      content: result.toolOutput.content,
      success: false,
    },
  });
  expect(String(events[1]?.stderr)).toContain("Failed to find expected lines");
});

test("returns failed tool output for patch apply exceptions", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "clutch-patch-runtime-error-"));
  const root = join(tempRoot, "not-a-directory");
  await writeFile(root, "not a directory", "utf8");

  const result = await applyPatchProposalWithRuntimeEvents({
    proposal: {
      patch: [
        "*** Begin Patch",
        "*** Add File: child.txt",
        "+hello",
        "*** End Patch",
      ].join("\n"),
      summary: "Create child",
      toolCallId: "call_patch_error",
    },
    root,
  });

  expect(result.status).toBe("invalid");
  expect(result.toolOutput).toMatchObject({
    content: expect.stringContaining("apply_patch verification failed:"),
    exitCode: 1,
    stdout: "",
    success: false,
  });
  expect(result.status === "invalid" ? result.errors[0]?.message : "").toContain(
    "not a directory",
  );
});
