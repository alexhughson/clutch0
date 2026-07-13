import { loginClutchOpenAiSubscription } from "../../lib/config/openAiSubscriptionAuth";
import type { AppActions } from "../../app/appTypes";
import { useAppStore } from "../../store/appStore";

let activeLoginCleanup: (() => void) | null = null;

export function abortActiveConfigSubscriptionLogin() {
  activeLoginCleanup?.();
  activeLoginCleanup = null;
}

export function runConfigSubscriptionLogin({
  actions,
  getState = useAppStore.getState,
  login = loginClutchOpenAiSubscription,
  requestId,
}: {
  actions: Pick<
    AppActions["config"],
    | "cancelSubscriptionLogin"
    | "subscriptionLoginDeviceCode"
    | "subscriptionLoginFail"
    | "subscriptionLoginFinish"
  >;
  getState?: typeof useAppStore.getState;
  login?: typeof loginClutchOpenAiSubscription;
  requestId: number;
}): () => void {
  abortActiveConfigSubscriptionLogin();

  const controller = new AbortController();
  let disposed = false;

  const cleanup = () => {
    disposed = true;
    controller.abort();
    if (activeLoginCleanup === cleanup) {
      activeLoginCleanup = null;
    }
  };

  activeLoginCleanup = cleanup;

  void login({
    onDeviceCode: (info) => {
      if (disposed || !isActiveRequest(getState(), requestId)) {
        return;
      }
      actions.subscriptionLoginDeviceCode({ info, requestId });
    },
    signal: controller.signal,
  }).then(
    () => {
      if (disposed || !isActiveRequest(getState(), requestId)) {
        return;
      }
      activeLoginCleanup = null;
      actions.subscriptionLoginFinish({ requestId });
    },
    (error: unknown) => {
      if (controller.signal.aborted || disposed) {
        return;
      }
      if (!isActiveRequest(getState(), requestId)) {
        return;
      }
      activeLoginCleanup = null;
      actions.subscriptionLoginFail({
        errorMessage: error instanceof Error ? error.message : String(error),
        requestId,
      });
    },
  );

  return cleanup;
}

function isActiveRequest(
  state: ReturnType<typeof useAppStore.getState>,
  requestId: number,
): boolean {
  return (
    state.activeTask?.kind === "config" &&
    state.activeTask.subscriptionLoginRequestId === requestId
  );
}
