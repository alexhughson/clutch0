import { afterEach, expect, test } from "bun:test";
import { App } from "../../App";
import { createInitialAppState } from "../../app/appInitialState";
import { hydrateAppStore } from "../../store/appStore";
import { CONTEXT_RECORDS_V1_SNAPSHOT } from "./contextRecordsV1.fixture";
import {
  parseAppSnapshot,
  restoreAppStateFromSnapshot,
} from "./sessionSnapshot";

type TestRenderSetup = Awaited<
  ReturnType<typeof import("@opentui/react/test-utils").testRender>
>;

afterEach(() => {
  hydrateAppStore(createInitialAppState());
});

test("literal v1 resume renders context labels, details, status, and actions", async () => {
  const restored = restoreAppStateFromSnapshot(
    parseAppSnapshot(CONTEXT_RECORDS_V1_SNAPSHOT as unknown),
  );
  hydrateAppStore(restored);

  const [{ testRender }, { act, createElement }] = await Promise.all([
    import("@opentui/react/test-utils"),
    import("react"),
  ]);

  let setup: TestRenderSetup | undefined;
  try {
    await act(async () => {
      setup = await testRender(
        createElement(App, { filePaths: [], onExit: () => {} }),
        { height: 50, width: 180 },
      );
    });
    if (setup === undefined) {
      throw new Error("Expected rendered App setup.");
    }

    const resumedFrame = await waitForFrame(setup, (frame) =>
      frame.includes("Resume this request"),
    );
    expect(resumedFrame).toContain("Question · complete");
    expect(resumedFrame).toContain("Resume this request");
    expect(resumedFrame).toContain("@index.tsx");
    expect(resumedFrame).toContain("Prompt result: Explain context records");
    expect(resumedFrame).toContain("Command: bun test");
    expect(resumedFrame).toContain("User text: literal user note");
    expect(resumedFrame).toContain("Diff: Update a");
    expect(resumedFrame).toContain("Agent edit: Review context records");

    await pressInputAndWait(
      setup,
      () => setup!.mockInput.pressEnter(),
      (frame) =>
        !frame.includes("Question · complete") &&
        frame.includes("> Diff: Update a"),
    );

    await openFocusedContext(setup, [
      "Diff: Update a",
      "a apply",
      "r rerun",
      "x remove",
    ]);
    await closeContextView(setup);

    await moveFocus(setup, "up", 5, "> Prompt result: Explain context records");
    await openFocusedContext(setup, [
      "Output for: Explain context records",
      "r rerun",
    ]);
    await closeContextView(setup);

    await moveFocus(setup, "down", 1, "> Command: bun test");
    await openFocusedContext(setup, ["390 pass", "r rerun"]);
    await closeContextView(setup);

    await moveFocus(setup, "down", 1, "> User text: literal user note");
    await openFocusedContext(setup, ["User text", "literal user note"]);
    await closeContextView(setup);

    await moveFocus(setup, "down", 2, "> Agent edit: Review context records");
    await openFocusedContext(setup, ["detached", "Sandbox:", "dirty"]);
    await closeContextView(setup);

    await moveFocus(setup, "up", 7, "> @index.tsx");
    await openFocusedContext(setup, [
      "src/index.tsx",
      "parseSessionCliArgs",
      "x remove",
    ]);
  } finally {
    if (setup !== undefined) {
      const cleanupSetup = setup;
      await act(async () => {
        cleanupSetup.renderer.destroy();
      });
    }
  }
});

async function openFocusedContext(
  setup: TestRenderSetup,
  expectedText: readonly string[],
) {
  const frame = await pressInputAndWait(
    setup,
    () => setup.mockInput.pressKey("o", { ctrl: true }),
    (candidate) => expectedText.every((text) => candidate.includes(text)),
  );

  for (const text of expectedText) {
    expect(frame).toContain(text);
  }
}

async function closeContextView(setup: TestRenderSetup) {
  await pressInputAndWait(
    setup,
    () => setup.mockInput.pressEscape(),
    (frame) => frame.includes("Ctrl+o open"),
  );
}

async function moveFocus(
  setup: TestRenderSetup,
  direction: "down" | "up",
  count: number,
  expectedFocusedLabel: string,
) {
  const { act } = await import("react");
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      setup.mockInput.pressArrow(direction);
      await renderFrames(setup, 1);
    });
  }

  const frame = await waitForFrame(setup, (candidate) =>
    candidate.includes(expectedFocusedLabel),
  );
  expect(frame).toContain(expectedFocusedLabel);
}

async function pressInputAndWait(
  setup: TestRenderSetup,
  press: () => void,
  predicate: (frame: string) => boolean,
): Promise<string> {
  const { act } = await import("react");
  await act(async () => {
    press();
  });
  return await waitForFrame(setup, predicate);
}

async function renderFrames(setup: TestRenderSetup, frames: number) {
  for (let index = 0; index < frames; index += 1) {
    await setup.renderOnce();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

async function waitForFrame(
  setup: TestRenderSetup,
  predicate: (frame: string) => boolean,
): Promise<string> {
  const { act } = await import("react");
  let frame = "";
  for (let index = 0; index < 30; index += 1) {
    await act(async () => {
      await renderFrames(setup, 1);
    });
    frame = setup.captureCharFrame();
    if (predicate(frame)) {
      return frame;
    }
  }

  throw new Error(`Timed out waiting for rendered frame:\n${frame}`);
}
