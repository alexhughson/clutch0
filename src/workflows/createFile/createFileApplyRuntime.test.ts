import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import type { SessionRecorder } from "../../lib/session/sessionRecorder";
import { setSessionRecorder } from "../../store/appStore";
import { applyCreateFileProposalWithRuntimeEvents } from "./createFileApplyRuntime";

afterEach(() => {
  setSessionRecorder(null);
});

test("records create-file apply begin and end events", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-create-file-runtime-"));
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

  const result = await applyCreateFileProposalWithRuntimeEvents({
    proposal: {
      content: "export const value = 1;\n",
      path: "src/newFile.ts",
      summary: "Add new file",
    },
    requestId: 7,
    root,
  });

  expect(result.status).toBe("valid");
  expect(await readFile(join(root, "src/newFile.ts"), "utf8")).toBe(
    "export const value = 1;\n",
  );
  expect(events).toEqual([
    {
      kind: "create-file.apply.begin",
      path: "src/newFile.ts",
      requestId: 7,
    },
    {
      kind: "create-file.apply.end",
      path: "src/newFile.ts",
      requestId: 7,
      success: true,
    },
  ]);
});
