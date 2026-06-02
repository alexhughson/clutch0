---
name: clutch-interactive-testing
description: Test the Clutch OpenTUI interactive application headlessly. Use when you need to read the Clutch screen, type into the composer, press keys, resize the terminal, build context through @file selection, and verify navigation using actual UI behavior.
---

# Clutch Interactive Testing

Use this skill to drive the Clutch terminal UI through OpenTUI's test renderer. Treat it like a real user session: read the screen, send keyboard/text input, re-read, and resize.

Do **not** mutate Clutch state directly. Build context and navigate by using the app:

- type `@...` and press `tab`/`enter` to add files
- use arrow keys to move focus
- use context item shortcuts such as `Ctrl+o` and `Ctrl+x`
- resize the terminal to verify layout changes

## Script

Run from the project root:

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts <command> ...
```

## Session lifecycle

Every long-lived UI session has an explicit session id.

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts start --id nav-test --width 80 --height 24
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts screen nav-test
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts stop nav-test
```

If something goes wrong:

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts list
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts kill nav-test
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts stop-all
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts cleanup
```

Safety behavior:

- `start` records pid, socket, log path, and timestamps in `/tmp/cui-<project-hash>/registry.json`.
- sessions exit automatically after 10 minutes idle by default.
- client commands have timeouts.
- `stop` requests a clean renderer shutdown.
- `kill` sends `SIGTERM`, then `SIGKILL` if needed.
- `stop-all` is the panic button for the current project.
- failure messages include the daemon log path when available.

## Command reference

### Session commands

#### `start --id <id> [--width <cols>] [--height <rows>] [--replace] [--config-check]`

Starts a named, long-lived headless Clutch UI session. The script renders `src/App.tsx` with OpenTUI's React test renderer, opens a local Unix socket, records the session in `/tmp/cui-<project-hash>/registry.json`, and returns once the app can answer commands.

Use this before any interactive command:

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts start --id nav-test --width 80 --height 24
```

Options:

- `--width`, `--height`: initial terminal size in columns/rows.
- `--replace`: kills an existing live session with the same id before starting.
- `--config-check`: runs Clutch's real first-run configuration gate. Without this flag, the harness skips the config gate so UI tests start at the composer.
- `--idle-ms`: overrides the default 10 minute idle auto-exit.

#### `list`

Prints all known sessions for this project, including pid, alive/dead status, terminal size, timestamps, and daemon log path. It also cleans dead registry entries first.

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts list
```

#### `stop <id>`

Asks a session to shut down cleanly: destroy the OpenTUI renderer, close the socket, remove the socket file, and delete the registry entry. Prefer this when the session is responsive.

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts stop nav-test
```

#### `kill <id>`

Forcibly terminates a stuck session. It sends `SIGTERM`, waits briefly, then sends `SIGKILL` if the daemon is still alive. Use this when `stop` times out or the socket is broken.

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts kill nav-test
```

#### `stop-all`

Panic button for the current project. It attempts clean shutdown for every registered session, then force-kills sessions that do not respond.

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts stop-all
```

#### `cleanup`

Removes registry entries and temp directories for sessions whose pids are no longer alive. It does not stop live sessions.

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts cleanup
```

### Observe commands

#### `screen <id> [--raw|--json]`

Renders a fresh frame and prints the visible terminal contents.

Default output includes a header with session id, terminal size, cursor position, and numbered rows. This is usually the best mode for agent inspection.

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts screen nav-test
```

Use `--raw` to print only the captured characters, with no header or line numbers:

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts screen nav-test --raw
```

Use `--json` when another script needs `cols`, `rows`, `cursor`, and `frame` as structured data:

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts screen nav-test --json
```

#### `spans <id>`

Renders a fresh frame and prints OpenTUI span data as JSON. Use this when plain character output is not enough and you need styling/layout metadata such as highlighted rows.

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts spans nav-test
```

### Interaction commands

Each interaction command sends real keyboard input to the running OpenTUI app, waits for React/OpenTUI to process it, and renders a few frames so the next `screen` sees the updated UI.

#### `type <id> <text>`

Types text character-by-character through OpenTUI mock keyboard input. Use this for normal composer entry and file selectors.

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts type nav-test '@src/App.tsx'
```

#### `paste <id> <text>`

Sends bracketed paste input. Use this for multi-line text or larger chunks where character-by-character typing is unnecessary.

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts paste nav-test 'multi-line text'
```

#### `key <id> <key> [--ctrl] [--shift] [--meta] [--super] [--hyper]`

Presses one key, optionally with modifiers. Use this for shortcuts and named keys.

Examples:

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts key nav-test tab
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts key nav-test o --ctrl
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts key nav-test x --ctrl
```

Common key names: `tab`, `return`, `enter`, `escape`, `backspace`, `delete`, `home`, `end`, `space`, `up`, `down`, `left`, `right`, `f1` through `f12`, or a single printable character.

#### `arrow <id> <up|down|left|right> [--ctrl] [--shift] [--meta]`

Presses an arrow key. Use this for context item navigation, suggestion navigation, and cursor movement.

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts arrow nav-test down
```

#### `enter <id>`

Convenience wrapper for `key <id> return`. Use this to accept a selected suggestion or submit the composer. Be careful: submitting an LLM prompt can start real workflow code.

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts enter nav-test
```

#### `escape <id>`

Convenience wrapper for `key <id> escape`. Use this to leave modal/detail screens and return to the composer when the UI supports Escape.

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts escape nav-test
```

#### `wait <id> <milliseconds>`

Waits inside the session process, then renders again. Use this for expected async UI changes such as summaries failing/finishing or delayed screen updates.

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts wait nav-test 250
```

### Environment commands

#### `resize <id> <width> <height>`

Simulates a terminal resize and re-renders. Use this to check narrow and wide layouts, wrapping, truncation, and side-pane behavior.

```sh
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts resize nav-test 120 30
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts screen nav-test
```

## Typical workflow

```sh
SESSION=ctx-nav
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts start --id "$SESSION" --width 80 --height 24
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts screen "$SESSION"

bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts type "$SESSION" '@src/App.tsx'
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts key "$SESSION" tab
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts type "$SESSION" '@src/store/appStore.ts'
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts key "$SESSION" tab
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts screen "$SESSION"

bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts arrow "$SESSION" down
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts screen "$SESSION"

bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts resize "$SESSION" 120 30
bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts screen "$SESSION"

bun .pi/skills/clutch-interactive-testing/scripts/clutch-ui.ts stop "$SESSION"
```

## Notes

- The harness renders `src/App.tsx` with OpenTUI's React test renderer so screens can be captured and resized deterministically.
- It uses Clutch's real UI event handlers for interaction.
- By default it skips the first-run config gate so the composer is available for UI testing without real credentials. Use `start --config-check` if you need to test the setup/config screen.
- Avoid pressing `enter` on normal LLM prompts unless the task explicitly calls for testing request behavior; this can start real workflow code.
