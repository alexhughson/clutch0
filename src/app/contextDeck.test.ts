import { expect, test } from "bun:test";
import { createFileContextItem } from "../lib/context/contextItems";
import { createInitialComposeScreen } from "./appInitialState";
import { ContextDeck } from "./contextDeck";

test("context deck adds and focuses context items", () => {
  const screen = createInitialComposeScreen();
  const item = createFileContextItem("src/App.tsx");

  const nextScreen = ContextDeck.fromComposeScreen(screen)
    .add(item)
    .applyTo(screen);

  expect(nextScreen.contextItems).toEqual([item]);
  expect(nextScreen.focusedContextItemId).toBe(item.id);
});

test("context deck cycles focus and keeps focus valid after removal", () => {
  const first = createFileContextItem("src/App.tsx");
  const second = createFileContextItem("src/index.tsx");
  const screen = {
    ...createInitialComposeScreen(),
    contextItems: [first, second],
    focusedContextItemId: first.id,
  };

  const focusedSecond = ContextDeck.fromComposeScreen(screen)
    .focus("next")
    .applyTo(screen);
  expect(focusedSecond.focusedContextItemId).toBe(second.id);

  const afterRemoval = ContextDeck.fromComposeScreen(focusedSecond)
    .remove(second.id)
    .applyTo(focusedSecond);
  expect(afterRemoval.contextItems).toEqual([first]);
  expect(afterRemoval.focusedContextItemId).toBe(first.id);
});
