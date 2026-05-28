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

test("context deck replaces an existing item and preserves focus", () => {
  const original = createFileContextItem("src/App.tsx");
  const replacement = createFileContextItem("src/App.tsx");
  const other = createFileContextItem("src/index.tsx");
  const screen = {
    ...createInitialComposeScreen(),
    contextItems: [original, other],
    focusedContextItemId: original.id,
  };

  const nextScreen = ContextDeck.fromComposeScreen(screen)
    .replace(replacement)
    .applyTo(screen);

  expect(nextScreen.contextItems).toEqual([replacement, other]);
  expect(nextScreen.focusedContextItemId).toBe(original.id);
});

test("context deck cycles focus in context display order", () => {
  const firstDisplayed = createFileContextItem("src/lib/a.ts");
  const secondDisplayed = createFileContextItem("src/lib/b.ts");
  const screen = {
    ...createInitialComposeScreen(),
    contextItems: [secondDisplayed, firstDisplayed],
    focusedContextItemId: secondDisplayed.id,
  };

  const next = ContextDeck.fromComposeScreen(screen)
    .focus("next")
    .applyTo(screen);

  expect(next.focusedContextItemId).toBe(firstDisplayed.id);
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
