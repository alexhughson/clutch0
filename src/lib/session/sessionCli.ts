export type SessionCliCommand =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "resume"; sessionId?: string };

export function parseSessionCliArgs(
  args: readonly string[],
): SessionCliCommand {
  if (args.length === 0) {
    return { kind: "new" };
  }

  if (args.length === 1 && args[0] === "-rl") {
    return { kind: "list" };
  }

  if (args.length === 1 && args[0] === "-r") {
    return { kind: "resume" };
  }

  if (args.length === 2 && args[0] === "-r") {
    const sessionId = args[1];
    if (sessionId === undefined || sessionId.startsWith("-")) {
      throw new Error("-r expects a session id or no argument.");
    }

    return { kind: "resume", sessionId };
  }

  throw new Error(
    `Unsupported Clutch arguments: ${args.join(" ")}. Use -r, -rl, or -r <session-id>.`,
  );
}
