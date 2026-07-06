import { expect, test } from "bun:test";
import type { LlmRequestState } from "../store/appStore";
import {
  formatOptionalLatency,
  getInvalidPatchDebugText,
  getPatchErrorHeading,
  getPatchReviewHeading,
  getPatchReviewHotkeys,
} from "./LlmResponseScreen";

test("formats latency stats for the response header", () => {
  expect(formatOptionalLatency(undefined, "pending")).toBe("pending");
  expect(formatOptionalLatency(42, "pending")).toBe("42ms");
  expect(formatOptionalLatency(1234, "pending")).toBe("1.23s");
  expect(formatOptionalLatency(12345, "pending")).toBe("12.3s");
});

test("labels invalid patch drafts as validation failures", () => {
  const request = createPatchRequest({
    patch: {
      applyStatus: "pending",
      errors: [
        {
          editIndex: 0,
          message: "Failed to find context '-1,70 +1,67 @@'",
          path: "src/parser.test.ts",
        },
      ],
      proposal: {
        patch: "*** Begin Patch\n*** End Patch",
        summary: "Apply patch",
        toolCallId: "call_patch_1",
      },
      status: "invalid",
    },
    responseText: "I will update the parser test.",
  });

  expect(getPatchReviewHeading(request.patch!)).toBe("Patch · invalid draft");
  expect(getPatchErrorHeading(request.patch!)).toBe(
    "Patch draft could not be validated:",
  );
  expect(getPatchReviewHotkeys(request)).toBe("e/Esc edit prompt");
  expect(getInvalidPatchDebugText(request)).toContain(
    "Question:\nMake a weird edit",
  );
  expect(getInvalidPatchDebugText(request)).toContain(
    "Tool call id:\ncall_patch_1",
  );
  expect(getInvalidPatchDebugText(request)).toContain(
    "- src/parser.test.ts [edit 0]: Failed to find context '-1,70 +1,67 @@'",
  );
  expect(getInvalidPatchDebugText(request)).toContain(
    "Assistant text:\nI will update the parser test.",
  );
  expect(getInvalidPatchDebugText(request)).toContain(
    "Raw apply_patch input:\n*** Begin Patch\n*** End Patch",
  );
});

function createPatchRequest({
  patch,
  responseText = "",
}: {
  patch: NonNullable<LlmRequestState["patch"]>;
  responseText?: string;
}): LlmRequestState {
  return {
    contextItems: [],
    focusedContextItemId: null,
    id: 1,
    patch,
    question: "Make a weird edit",
    responseText,
    status: "done",
  };
}
