import { getContextItemDisplayOrder } from "../lib/context/contextItemDisplay";
import { hasContextItem } from "../lib/context/contextItemFactories";
import type {
  ContextItem,
  PersistentContextItem,
} from "../lib/context/contextItemTypes";
import type { ComposeScreenState } from "./appTypes";

export class ContextDeck {
  constructor(
    readonly contextItems: readonly PersistentContextItem[],
    readonly focusedContextItemId: string | null,
  ) {}

  add(item: PersistentContextItem): ContextDeck {
    if (hasContextItem(this.contextItems, item.id)) {
      return new ContextDeck(this.contextItems, item.id);
    }

    return new ContextDeck([...this.contextItems, item], item.id);
  }

  focus(direction: "next" | "previous"): ContextDeck {
    return new ContextDeck(
      this.contextItems,
      getNextContextItemFocusId({
        contextItems: this.contextItems,
        direction,
        focusedContextItemId: this.focusedContextItemId,
      }),
    );
  }

  /**
   * Intentionally lenient: returns same deck if id not found.
   * Race: user removes the item (keyboard / action) while a response
   * finishes and tries to replace the live item. No-op is safe;
   * throwing would crash the state transition.
   */
  replace(item: PersistentContextItem): ContextDeck {
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

  /**
   * Intentionally lenient: returns same deck if id not found.
   * Race: double-remove via keyboard shortcut + context action
   * dispatched before state settles. No-op is safe; throwing would
   * break the optimistic UI path.
   */
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

export function getNextContextItemFocusId({
  contextItems,
  direction,
  focusedContextItemId,
}: {
  contextItems: readonly ContextItem[];
  direction: "next" | "previous";
  focusedContextItemId: string | null;
}): string | null {
  const displayOrder = getContextItemDisplayOrder(contextItems);
  if (displayOrder.length === 0) {
    return null;
  }

  const currentIndex = displayOrder.findIndex(
    (item) => item.id === focusedContextItemId,
  );
  const offset = direction === "next" ? 1 : -1;
  const nextIndex =
    currentIndex === -1
      ? direction === "next"
        ? 0
        : displayOrder.length - 1
      : (currentIndex + offset + displayOrder.length) % displayOrder.length;

  if (nextIndex < 0 || nextIndex >= displayOrder.length) {
    throw new Error(
      `getNextContextItemFocusId: computed index ${nextIndex} out of bounds for length ${displayOrder.length} (currentIndex=${currentIndex}, direction=${direction})`,
    );
  }

  // displayOrder is non-empty (checked above) and nextIndex is proven in-bounds.
  return displayOrder[nextIndex]!.id;
}

function getFocusAfterRemoval({
  contextItems,
  previousFocusedContextItemId,
  removedIndex,
  removedItemId,
}: {
  contextItems: readonly PersistentContextItem[];
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

  const index = Math.min(removedIndex, contextItems.length - 1);
  if (index < 0 || index >= contextItems.length) {
    throw new Error(
      `getFocusAfterRemoval: computed index ${index} out of bounds for length ${contextItems.length} (removedIndex=${removedIndex})`,
    );
  }

  // contextItems non-empty already checked; index clamped and proven in-bounds.
  return contextItems[index]!.id;
}
