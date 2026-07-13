import type { Api, Model } from "@earendil-works/pi-ai";
import { stripAnsiSequences } from "@opentui/core";
import {
  CLUTCH_MODEL_EFFORT_LEVELS,
  CLUTCH_MODEL_SERVICE_TIERS,
  SUPPORTED_CLUTCH_LLM_PROVIDERS,
  type ClutchAgentBackendConfig,
  type ClutchModelEffortLevel,
  type ClutchModelSelection,
  type ClutchModelServiceTier,
  type SupportedClutchLlmProvider,
} from "../../lib/config/clutchConfigSchemas";
import {
  getClutchModelEffortLevel,
  getClutchModelServiceTier,
  getSupportedClutchProviderLabel,
} from "../../lib/config/clutchConfig";
import type {
  ConfigAgentBackendForm,
  ConfigAgentBackendRow,
  ConfigModelEntry,
  ConfigModelLoadState,
  ConfigModelSettingsRow,
  ConfigProviderRow,
} from "./configTypes";

export const MODEL_SETTINGS_ROWS: ConfigModelSettingsRow[] = [
  { entry: "primary", kind: "model" },
  { entry: "primary", kind: "effort" },
  { entry: "primary", kind: "service-tier" },
  { entry: "agent", kind: "model" },
  { entry: "agent", kind: "effort" },
  { entry: "agent", kind: "service-tier" },
  { entry: "summarization", kind: "model" },
  { entry: "summarization", kind: "effort" },
  { entry: "summarization", kind: "service-tier" },
  { kind: "done" },
];

export const AGENT_BACKEND_ROWS: ConfigAgentBackendRow[] = [
  "command",
  "args",
  "env",
  "save",
];

export const VISIBLE_MODEL_COUNT = 10;

export function providerRows({
  agentBackendConfigured,
  configuredProviders,
}: {
  agentBackendConfigured: boolean;
  configuredProviders: readonly SupportedClutchLlmProvider[];
}): ConfigProviderRow[] {
  return [
    ...SUPPORTED_CLUTCH_LLM_PROVIDERS.map((provider) => {
      const configured = configuredProviders.includes(provider.id);
      return {
        key: provider.id,
        kind: isSubscriptionProvider(provider.id)
          ? ("subscription-provider" as const)
          : ("provider" as const),
        label: `${provider.label}${configured ? " ✓" : ""}`,
        provider: provider.id,
      };
    }),
    {
      key: "models",
      kind: "models" as const,
      label: "Configure models",
    },
    {
      key: "agent-backend",
      kind: "agent-backend" as const,
      label: `Configure ACP backend${agentBackendConfigured ? " ✓" : ""}`,
    },
  ];
}

export function agentBackendFormFromConfig(
  backend: ClutchAgentBackendConfig | undefined,
): ConfigAgentBackendForm {
  return {
    argsJson: JSON.stringify(backend?.args ?? []),
    command: backend?.command ?? "",
    envJson: JSON.stringify(backend?.env ?? {}),
  };
}

export function agentBackendFromForm(
  form: ConfigAgentBackendForm,
): ClutchAgentBackendConfig {
  const args = parseJsonStringArray(
    form.argsJson,
    'ACP backend args must be a JSON string array, for example ["acp"].',
  );
  const env = parseJsonStringRecord(
    form.envJson,
    'ACP backend env must be a JSON object of strings, for example {"KEY":"VALUE"}.',
  );

  return {
    ...(args.length === 0 ? {} : { args }),
    command: form.command.trim(),
    ...(Object.keys(env).length === 0 ? {} : { env }),
  };
}

export function agentBackendRowLabel({
  form,
  row,
}: {
  form: ConfigAgentBackendForm;
  row: ConfigAgentBackendRow;
}): string {
  switch (row) {
    case "command":
      return `Command: ${form.command}`;
    case "args":
      return `Args JSON: ${form.argsJson}`;
    case "env":
      return `Env JSON: ${form.envJson}`;
    case "save":
      return "Save ACP backend";
  }
}

export function modelSettingsRowLabel({
  agent,
  primary,
  row,
  summarization,
}: {
  agent: ClutchModelSelection;
  primary: ClutchModelSelection;
  row: ConfigModelSettingsRow;
  summarization: ClutchModelSelection;
}): string {
  if (row.kind === "done") {
    return "Done";
  }

  const selection = getModelEntrySelection({
    agent,
    entry: row.entry,
    primary,
    summarization,
  });
  if (row.kind === "effort") {
    return `${entryLabel(row.entry)} effort: ${getClutchModelEffortLevel(selection)}`;
  }
  if (row.kind === "service-tier") {
    return `${entryLabel(row.entry)} service tier: ${getClutchModelServiceTier(selection)}`;
  }

  return `${entryLabel(row.entry)} model: ${getSupportedClutchProviderLabel(selection.provider)} / ${selection.model.length === 0 ? "(choose model)" : selection.model}`;
}

export function modelSettingsRowKey(row: ConfigModelSettingsRow): string {
  return row.kind === "done" ? "done" : `${row.entry}-${row.kind}`;
}

export function modelProvidersForEntry(entry: ConfigModelEntry) {
  void entry;
  return SUPPORTED_CLUTCH_LLM_PROVIDERS;
}

export function modelChoiceStatusLabel({
  filter,
  modelLoad,
  provider,
}: {
  filter: string;
  modelLoad: ConfigModelLoadState;
  provider: SupportedClutchLlmProvider;
}): string {
  const base = `Provider: ${getSupportedClutchProviderLabel(provider)}`;
  const loadedCount =
    modelLoad.status === "loaded" ? ` · ${modelLoad.models.length} models` : "";
  return `${base}${loadedCount}${filter.length === 0 ? "" : ` · filter: ${filter}`}`;
}

export function setActiveSelection({
  activeModelEntry,
  agent,
  primary,
  selection,
  summarization,
}: {
  activeModelEntry: ConfigModelEntry;
  agent: ClutchModelSelection;
  primary: ClutchModelSelection;
  selection: ClutchModelSelection;
  summarization: ClutchModelSelection;
}): {
  agent: ClutchModelSelection;
  primary: ClutchModelSelection;
  summarization: ClutchModelSelection;
} {
  if (activeModelEntry === "agent") {
    return { agent: selection, primary, summarization };
  }

  if (activeModelEntry === "primary") {
    return { agent, primary: selection, summarization };
  }

  return { agent, primary, summarization: selection };
}

export function getModelEntrySelection({
  agent,
  entry,
  primary,
  summarization,
}: {
  agent: ClutchModelSelection;
  entry: ConfigModelEntry;
  primary: ClutchModelSelection;
  summarization: ClutchModelSelection;
}): ClutchModelSelection {
  switch (entry) {
    case "agent":
      return agent;
    case "primary":
      return primary;
    case "summarization":
      return summarization;
  }
}

export function matchingModels({
  filter,
  models,
}: {
  filter: string;
  models: readonly Model<Api>[];
}) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (normalizedFilter.length === 0) {
    return models;
  }

  return models.filter(
    (model) =>
      model.id.toLowerCase().includes(normalizedFilter) ||
      model.name.toLowerCase().includes(normalizedFilter),
  );
}

export function getVisibleModels<T>({
  modelIndex,
  models,
}: {
  modelIndex: number;
  models: readonly T[];
}): { index: number; model: T }[] {
  const start = Math.max(0, modelIndex - Math.floor(VISIBLE_MODEL_COUNT / 2));
  return models
    .slice(start, start + VISIBLE_MODEL_COUNT)
    .map((model, index) => ({
      index: start + index,
      model,
    }));
}

export function indexOfModel(
  selection: ClutchModelSelection,
  models: readonly Model<Api>[],
): number {
  return Math.max(
    0,
    models.findIndex((model) => model.id === selection.model),
  );
}

export function providerIndexFor(
  provider: SupportedClutchLlmProvider,
  entry: ConfigModelEntry,
): number {
  const index = modelProvidersForEntry(entry).findIndex(
    (candidate) => candidate.id === provider,
  );
  if (index === -1) {
    throw new Error(
      `Provider ${provider} is not supported for ${entryLabel(entry)} models.`,
    );
  }
  return index;
}

export function effortIndexFor(effortLevel: ClutchModelEffortLevel): number {
  const index = CLUTCH_MODEL_EFFORT_LEVELS.findIndex(
    (candidate) => candidate === effortLevel,
  );
  if (index === -1) {
    throw new Error(`Unknown model effort level: ${effortLevel}`);
  }
  return index;
}

export function serviceTierIndexFor(
  serviceTier: ClutchModelServiceTier,
): number {
  const index = CLUTCH_MODEL_SERVICE_TIERS.findIndex(
    (candidate) => candidate === serviceTier,
  );
  if (index === -1) {
    throw new Error(`Unknown model service tier: ${serviceTier}`);
  }
  return index;
}

export function cycleIndex(
  index: number,
  length: number,
  direction: 1 | -1,
): number {
  return (index + direction + length) % length;
}

export function entryLabel(entry: ConfigModelEntry): string {
  switch (entry) {
    case "agent":
      return "Agent";
    case "primary":
      return "Primary";
    case "summarization":
      return "Summarization";
  }
}

export function sanitizeLineInput(input: string): string {
  return stripAnsiSequences(input)
    .replace(/[\n\r]/g, "")
    .trim();
}

function isSubscriptionProvider(provider: SupportedClutchLlmProvider): boolean {
  return provider === "openai-codex";
}

function parseJsonStringArray(value: string, message: string): string[] {
  const parsed = parseJsonValue(value.length === 0 ? "[]" : value, message);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  ) {
    throw new Error(message);
  }
  return parsed;
}

function parseJsonStringRecord(
  value: string,
  message: string,
): Record<string, string> {
  const parsed = parseJsonValue(value.length === 0 ? "{}" : value, message);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((item) => typeof item === "string")
  ) {
    throw new Error(message);
  }
  return parsed as Record<string, string>;
}

function parseJsonValue(value: string, message: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(message);
  }
}
