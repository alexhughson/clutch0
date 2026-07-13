import type { Api, Model } from "@earendil-works/pi-ai";
import type { OpenAiSubscriptionDeviceCode } from "../../lib/config/openAiSubscriptionAuth";
import type { SupportedClutchLlmProvider } from "../../lib/config/clutchConfigSchemas";

export type ConfigStage =
  | "agent-backend"
  | "model-effort"
  | "model-model"
  | "model-provider"
  | "model-service-tier"
  | "model-settings"
  | "providers"
  | "subscription-login"
  | "token";

export type ConfigModelEntry = "agent" | "primary" | "summarization";

export type ConfigModelSettingsRow =
  | { entry: ConfigModelEntry; kind: "effort" | "model" | "service-tier" }
  | { kind: "done" };

export type ConfigAgentBackendRow = "args" | "command" | "env" | "save";

export type ConfigAgentBackendForm = {
  argsJson: string;
  command: string;
  envJson: string;
};

export type ConfigModelLoadState =
  | {
      models: Model<Api>[];
      provider: SupportedClutchLlmProvider;
      status: "loaded";
    }
  | {
      errorMessage: string;
      models: [];
      provider: SupportedClutchLlmProvider;
      status: "error";
    }
  | { models: []; provider: SupportedClutchLlmProvider; status: "loading" }
  | { models: []; provider: null; status: "idle" };

export type ConfigSubscriptionLoginState =
  | { status: "idle" }
  | { status: "waiting-for-device"; info: OpenAiSubscriptionDeviceCode }
  | { status: "working"; message: string }
  | { status: "error"; message: string };

export type ConfigProviderRow =
  | {
      key: string;
      kind: "agent-backend" | "models";
      label: string;
    }
  | {
      key: string;
      kind: "provider" | "subscription-provider";
      label: string;
      provider: SupportedClutchLlmProvider;
    };

export type ConfigKeyInput = {
  ctrl?: boolean;
  meta?: boolean;
  name: string;
  option?: boolean;
  sequence: string;
};
