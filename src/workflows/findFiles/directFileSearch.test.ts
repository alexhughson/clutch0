import { expect, test } from "bun:test";
import { parseDirectFileSearchResponse } from "./directFileSearch";

test("parses direct file search candidates", () => {
  expect(
    parseDirectFileSearchResponse(
      JSON.stringify({
        files: [
          {
            confidence: "high",
            path: "./src/App.tsx",
            reason: "Owns the app shell.",
          },
          {
            confidence: "medium",
            path: "src/index.tsx",
            reason: "Bootstraps the app.",
          },
        ],
      }),
    ),
  ).toEqual([
    {
      confidence: "high",
      path: "src/App.tsx",
      reason: "Owns the app shell.",
    },
    {
      confidence: "medium",
      path: "src/index.tsx",
      reason: "Bootstraps the app.",
    },
  ]);
});

test("dedupes normalized file search paths", () => {
  expect(
    parseDirectFileSearchResponse(
      JSON.stringify({
        files: [
          {
            confidence: "high",
            path: "./src/App.tsx",
            reason: "First match.",
          },
          {
            confidence: "low",
            path: "src\\App.tsx",
            reason: "Duplicate path.",
          },
          {
            path: "src/entry.ts",
            reason: "   ",
          },
        ],
      }),
    ),
  ).toEqual([
    {
      confidence: "high",
      path: "src/App.tsx",
      reason: "First match.",
    },
    {
      path: "src/entry.ts",
      reason: "Relevant to the search goal.",
    },
  ]);
});

test("throws on malformed direct file search JSON with raw prefix", () => {
  expect(() => parseDirectFileSearchResponse("```json\n{}\n```")).toThrow(
    "File search response was not valid JSON. Raw response prefix: ```json {} ```",
  );
});

test("throws on invalid direct file search response shape", () => {
  expect(() =>
    parseDirectFileSearchResponse(
      JSON.stringify({
        files: [{ confidence: "certain", path: "src/App.tsx", reason: "App" }],
      }),
    ),
  ).toThrow(
    'File search candidate confidence must be "low", "medium", or "high".',
  );
});

test("throws when direct file search returns no usable candidates", () => {
  expect(() =>
    parseDirectFileSearchResponse(JSON.stringify({ files: [] })),
  ).toThrow("File search response did not include any usable files.");
});
