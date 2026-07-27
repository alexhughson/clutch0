#!/usr/bin/env bun
import {
  runAcpBackendSmokeTest,
  type AcpBackendSmokeTestOptions,
} from "../lib/agent/acpBackendSmokeTest";

type CliOptions = AcpBackendSmokeTestOptions & {
  json: boolean;
};

async function main() {
  const options = parseArgs(Bun.argv.slice(2));
  const result = await runAcpBackendSmokeTest(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("ACP backend smoke test passed.");
  console.log(`backend: ${result.backendCommand}`);
  console.log(`config: ${result.configPath}`);
  console.log(`cwd: ${result.cwd}`);
  console.log(
    `env keys: ${result.envKeys.length === 0 ? "<none>" : result.envKeys.join(", ")}`,
  );
  console.log(`session: ${result.sessionId}`);
  console.log(`initialize: ${result.stages.initializeMs}ms`);
  console.log(`session/new: ${result.stages.sessionMs}ms`);
  if (result.stages.promptMs !== undefined) {
    console.log(`session/prompt: ${result.stages.promptMs}ms`);
    console.log(`stop: ${result.stopReason ?? "<none>"}`);
    console.log(`assistant: ${result.assistantText || "<empty>"}`);
  }
  if (result.updates.length > 0) {
    console.log(`updates: ${result.updates.join(", ")}`);
  }
  if (result.stderr.length > 0) {
    console.log(`stderr: ${result.stderr}`);
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { json: false };
  const backendArgs: string[] = [];
  const backendEnv: Record<string, string> = {};
  let command: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--arg":
        backendArgs.push(readValue(args, (index += 1), arg));
        break;
      case "--command":
        command = readValue(args, (index += 1), arg);
        break;
      case "--config-dir":
        options.configDir = readValue(args, (index += 1), arg);
        break;
      case "--cwd":
        options.cwd = readValue(args, (index += 1), arg);
        break;
      case "--env": {
        const [key, ...valueParts] = readValue(args, (index += 1), arg).split(
          "=",
        );
        if (key === undefined || key.length === 0 || valueParts.length === 0) {
          throw new Error("--env must be KEY=VALUE.");
        }
        backendEnv[key] = valueParts.join("=");
        break;
      }
      case "--json":
        options.json = true;
        break;
      case "--prompt":
        options.prompt = readValue(args, (index += 1), arg);
        break;
      case "--skip-prompt":
        options.skipPrompt = true;
        break;
      case "--timeout-ms":
        options.timeoutMs = parsePositiveInteger(
          readValue(args, (index += 1), arg),
          arg,
        );
        break;
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (command !== undefined) {
    options.backend = {
      ...(backendArgs.length === 0 ? {} : { args: backendArgs }),
      command,
      ...(Object.keys(backendEnv).length === 0 ? {} : { env: backendEnv }),
    };
  } else if (backendArgs.length > 0 || Object.keys(backendEnv).length > 0) {
    throw new Error("--arg and --env require --command.");
  }

  return options;
}

function readValue(
  args: readonly string[],
  index: number,
  flag: string,
): string {
  const value = args[index];
  if (value === undefined) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: bun run smoke:acp -- [options]

Options:
  --command <cmd>       Override configured ACP backend command.
  --arg <arg>           Add one backend argument. Repeat for multiple args.
  --env KEY=VALUE       Add one backend environment variable.
  --cwd <path>          Working directory for session/new. Defaults to cwd.
  --config-dir <path>   Clutch config directory for settings.json.
  --prompt <text>       Prompt to send. Defaults to a short echo request.
  --skip-prompt         Only test initialize and session/new.
  --timeout-ms <ms>     Timeout per ACP operation. Defaults to 30000.
  --json                Print full JSON result.
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
