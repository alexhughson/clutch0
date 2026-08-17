import { expect, test } from "bun:test";
import {
  createFileContextItem,
  createSavedLlmResponseContextItem,
  preserveContextItemPlacement,
  SavedLlmResponseContextItem,
} from "./contextItems";

test("preserve copies pin, auto-regenerate, and createdAt", () => {
  const previous = createSavedLlmResponseContextItem({
    createdAt: 10,
    id: "saved:1",
    output: "old",
    prompt: "question",
    sourceRequestId: 1,
  })
    .withPinned(true)
    .withAutoRegenerate(true);

  const next = createSavedLlmResponseContextItem({
    createdAt: 99,
    id: "saved:1",
    output: "new",
    prompt: "question",
    sourceRequestId: 2,
  });

  const preserved = preserveContextItemPlacement(previous, next);
  expect(preserved.isPinned()).toBe(true);
  expect(preserved.getAutoRegenerate?.()).toBe(true);
  expect(preserved).toBeInstanceOf(SavedLlmResponseContextItem);
  const saved = preserved as SavedLlmResponseContextItem;
  expect(saved.createdAt).toBe(10);
  expect(saved.output).toBe("new");
});

test("preserve throws when auto-regenerate cannot be copied", () => {
  const previous = createSavedLlmResponseContextItem({
    createdAt: 1,
    id: "saved:1",
    output: "old",
    prompt: "question",
    sourceRequestId: 1,
  }).withAutoRegenerate(true);
  const next = createFileContextItem("src/a.ts");

  expect(() => preserveContextItemPlacement(previous, next)).toThrow(
    "Cannot preserve auto-regenerate",
  );
});
