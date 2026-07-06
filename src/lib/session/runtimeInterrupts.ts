export type RuntimeAbortHandle = {
  abort: () => void;
  dispose: () => void;
  signal: AbortSignal;
};

const controllers = new Set<AbortController>();

export function createRuntimeAbortHandle(): RuntimeAbortHandle {
  const controller = new AbortController();
  controllers.add(controller);

  return {
    abort: () => {
      controller.abort();
      controllers.delete(controller);
    },
    dispose: () => {
      controllers.delete(controller);
    },
    signal: controller.signal,
  };
}

export function abortRuntimeWork() {
  for (const controller of controllers) {
    controller.abort();
  }

  controllers.clear();
}
