import type { KeyEvent } from "@opentui/core";

export type KeyBinding<Action extends string> = {
  action: Action;
  name: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  option?: boolean;
  super?: boolean;
  hyper?: boolean;
};

export function getKeyAction<Action extends string>(
  event: KeyEvent,
  bindings: readonly KeyBinding<Action>[],
): Action | null {
  return (
    bindings.find((binding) => keyBindingMatchesEvent(binding, event))
      ?.action ?? null
  );
}

/** Requires exact modifier matches so Ctrl+N does not also trigger plain N. */
function keyBindingMatchesEvent<Action extends string>(
  binding: KeyBinding<Action>,
  event: KeyEvent,
): boolean {
  return (
    binding.name === event.name &&
    Boolean(binding.ctrl) === event.ctrl &&
    Boolean(binding.shift) === event.shift &&
    Boolean(binding.meta) === event.meta &&
    Boolean(binding.option) === event.option &&
    Boolean(binding.super) === Boolean(event.super) &&
    Boolean(binding.hyper) === Boolean(event.hyper)
  );
}
