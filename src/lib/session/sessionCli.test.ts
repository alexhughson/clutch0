import { test, expect } from "bun:test";
import { parseSessionCliArgs } from "./sessionCli";

test("parses session CLI commands", () => {
  expect(parseSessionCliArgs([])).toEqual({ kind: "new" });
  expect(parseSessionCliArgs(["-rl"])).toEqual({ kind: "list" });
  expect(parseSessionCliArgs(["-r"])).toEqual({ kind: "resume" });
  expect(parseSessionCliArgs(["-r", "session-1"])).toEqual({
    kind: "resume",
    sessionId: "session-1",
  });
});

test("rejects unsupported session CLI arguments", () => {
  expect(() => parseSessionCliArgs(["--help"])).toThrow(
    "Unsupported Clutch arguments",
  );
  expect(() => parseSessionCliArgs(["-r", "-x"])).toThrow(
    "-r expects a session id",
  );
  expect(() => parseSessionCliArgs(["-rl", "extra"])).toThrow(
    "Unsupported Clutch arguments",
  );
});
