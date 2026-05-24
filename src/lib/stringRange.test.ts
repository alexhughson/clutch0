import { expect, test } from "bun:test";
import { removeStringRange } from "./stringRange";

test("removes a string range", () => {
  expect(removeStringRange("hey @file there", { start: 4, end: 9 })).toBe(
    "hey  there",
  );
});

test("removes a range at the end of a string", () => {
  expect(removeStringRange("hey @file", { start: 4, end: 9 })).toBe("hey ");
});

test("throws for an invalid range", () => {
  expect(() => removeStringRange("hey", { start: 2, end: 4 })).toThrow(
    RangeError,
  );
});
