import { getContextItemDisplayOrder } from "../lib/context/contextItemDisplay";
import { hasContextItem } from "../lib/context/contextItems";
import type { ContextItem } from "../types";
import type { ComposeScreenState } from "./appTypes";

export class ContextDeck {
  constructor(
    readonly contextItems: readonly ContextItem[],
    readonly focusedContextItemId: string | null,
  ) {}

  add(item: ContextItem): ContextDeck {
    if (hasContextItem(this.contextItems, item.id)) {
      return new ContextDeck(this.contextItems, item.id);
    }

    return new ContextDeck([...this.contextItems, item], item.id);
  }

  focus(direction: "next" | "previous"): ContextDeck {
    const displayOrder = getContextItemDisplayOrder(this.contextItems);
    if (displayOrder.length === 0) {
      return new ContextDeck(this.contextItems, null);
    }

    const currentIndex = displayOrder.findIndex(
      (item) => item.id === this.focusedContextItemId,
    );
    const offset = direction === "next" ? 1 : -1;
    const nextIndex =
      currentIndex === -1
        ? direction === "next"
          ? 0
          : displayOrder.length - 1
        : (currentIndex + offset + displayOrder.length) % displayOrder.length;

    return new ContextDeck(
      this.contextItems,
      displayOrder[nextIndex]?.id ?? null,
    );
  }

  replace(item: ContextItem): ContextDeck {
    if (!hasContextItem(this.contextItems, item.id)) {
      return this;
    }

    return new ContextDeck(
      this.contextItems.map((contextItem) =>
        contextItem.id === item.id ? item : contextItem,
      ),
      this.focusedContextItemId,
    );
  }

  remove(itemId: string): ContextDeck {
    const removedIndex = this.contextItems.findIndex(
      (item) => item.id === itemId,
    );
    if (removedIndex === -1) {
      return this;
    }

    const contextItems = this.contextItems.filter((item) => item.id !== itemId);
    return new ContextDeck(
      contextItems,
      getFocusAfterRemoval({
        contextItems,
        previousFocusedContextItemId: this.focusedContextItemId,
        removedIndex,
        removedItemId: itemId,
      }),
    );
  }

  applyTo(composeScreen: ComposeScreenState): ComposeScreenState {
    return {
      ...composeScreen,
      contextItems: [...this.contextItems],
      focusedContextItemId: this.focusedContextItemId,
    };
  }

  static fromComposeScreen(composeScreen: ComposeScreenState): ContextDeck {
    return new ContextDeck(
      composeScreen.contextItems,
      composeScreen.focusedContextItemId,
    );
  }
}

function getFocusAfterRemoval({
  contextItems,
  previousFocusedContextItemId,
  removedIndex,
  removedItemId,
}: {
  contextItems: readonly ContextItem[];
  previousFocusedContextItemId: string | null;
  removedIndex: number;
  removedItemId: string;
}): string | null {
  if (contextItems.length === 0) {
    return null;
  }

  if (previousFocusedContextItemId !== removedItemId) {
    return previousFocusedContextItemId;
  }

  return (
    contextItems[Math.min(removedIndex, contextItems.length - 1)]?.id ?? null
  );
}
