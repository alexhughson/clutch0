import { SUPPORTED_CLUTCH_LLM_PROVIDERS } from "../../lib/config/clutchConfigSchemas";
import { createDefaultClutchConfigDraft } from "../../lib/config/clutchConfig";
import type { ConfigTaskState } from "../../app/appTypes";
import { agentBackendFormFromConfig } from "./configHelpers";

export function createConfigTask(
  mode: ConfigTaskState["mode"],
): ConfigTaskState {
  const draft = createDefaultClutchConfigDraft();
  return {
    ...draft,
    activeModelEntry: "primary",
    agentBackendForm: agentBackendFormFromConfig(draft.agentBackend),
    agentBackendRowIndex: 0,
    kind: "config",
    message: null,
    mode,
    modelEffortIndex: 0,
    modelFilter: "",
    modelIndex: 0,
    modelLoad: {
      models: [],
      provider: null,
      status: "idle",
    },
    modelLoadRequestId: 0,
    modelProviderIndex: 0,
    modelSettingsIndex: 0,
    modelServiceTierIndex: 0,
    providerIndex: 0,
    stage: "providers",
    subscriptionLogin: { status: "idle" },
    subscriptionLoginRequestId: 0,
    token: "",
    tokenProvider: SUPPORTED_CLUTCH_LLM_PROVIDERS[0].id,
  };
}

export function createMinimalConfigTask(
  mode: ConfigTaskState["mode"],
): ConfigTaskState {
  return {
    activeModelEntry: "primary",
    agent: { model: "gpt-test", provider: "openai" },
    agentBackendForm: { argsJson: "[]", command: "", envJson: "{}" },
    agentBackendRowIndex: 0,
    configuredProviders: [],
    kind: "config",
    message: null,
    mode,
    modelEffortIndex: 0,
    modelFilter: "",
    modelIndex: 0,
    modelLoad: { models: [], provider: null, status: "idle" },
    modelLoadRequestId: 0,
    modelProviderIndex: 0,
    modelSettingsIndex: 0,
    modelServiceTierIndex: 0,
    primary: { model: "gpt-test", provider: "openai" },
    providerIndex: 0,
    stage: "providers",
    subscriptionLogin: { status: "idle" },
    subscriptionLoginRequestId: 0,
    summarization: { model: "gpt-test", provider: "openai" },
    token: "",
    tokenProvider: "openai",
  };
}
