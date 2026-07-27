import {
  DEFAULT_CLUTCH_MODEL_EFFORT_LEVEL,
  getClutchModelEffortLevel,
  getClutchOpenRouterServiceTier,
  getClutchProviderLabel,
  OPENROUTER_PROVIDER_ID,
  type ClutchEndpoint,
  type ClutchModelSelection,
  type OpenRouterCapabilities,
  type OpenRouterOptions,
} from "../../lib/config/clutchConfig";
import {
  fetchOpenRouterCapabilities,
  validateOpenRouterOptions,
} from "../../lib/config/openRouterCapabilities";

export type ModelEntry = "agent" | "primary" | "summarization";

export type ModelSettingsRow =
  | {
      entry: ModelEntry;
      kind:
        | "effort"
        | "model"
        | "provider-extras"
        | "service-tier"
        | "sort"
        | "vendor";
    }
  | { kind: "done" };

export const OPENROUTER_SORT_OPTIONS = [
  { label: "Default", sort: undefined },
  { label: "Price", sort: "price" as const },
  { label: "Nitro (throughput)", sort: "throughput" as const },
  { label: "Latency", sort: "latency" as const },
];

export function buildModelSettingsRows({
  agent,
  primary,
  summarization,
}: {
  agent: ClutchModelSelection;
  primary: ClutchModelSelection;
  summarization: ClutchModelSelection;
}): ModelSettingsRow[] {
  const rows: ModelSettingsRow[] = [];
  for (const entry of ["primary", "agent", "summarization"] as const) {
    const selection = getModelEntrySelection({
      agent,
      entry,
      primary,
      summarization,
    });
    rows.push({ entry, kind: "model" });
    if (selection.provider !== OPENROUTER_PROVIDER_ID) {
      continue;
    }

    rows.push({ entry, kind: "sort" });
    const capabilities = selection.openRouter?.capabilities;
    if (capabilities !== undefined) {
      if (capabilities.vendors.length >= 1) {
        rows.push({ entry, kind: "vendor" });
      }
      if (capabilities.supportsServiceTier) {
        rows.push({ entry, kind: "service-tier" });
      }
      if (capabilities.supportsReasoning) {
        rows.push({ entry, kind: "effort" });
      }
    }
    if (selection.model.length > 0) {
      rows.push({ entry, kind: "provider-extras" });
    }
  }

  rows.push({ kind: "done" });
  return rows;
}

export function getModelEntrySelection({
  agent,
  entry,
  primary,
  summarization,
}: {
  agent: ClutchModelSelection;
  entry: ModelEntry;
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

export function modelSettingsRowKey(row: ModelSettingsRow): string {
  return row.kind === "done" ? "done" : `${row.entry}-${row.kind}`;
}

export function modelSettingsRowLabel({
  agent,
  endpoints,
  primary,
  row,
  summarization,
}: {
  agent: ClutchModelSelection;
  endpoints: readonly ClutchEndpoint[];
  primary: ClutchModelSelection;
  row: ModelSettingsRow;
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
  const prefix = entryLabel(row.entry);

  switch (row.kind) {
    case "effort":
      return `${prefix} effort: ${getClutchModelEffortLevel(selection)}`;
    case "service-tier":
      return `${prefix} service tier: ${getClutchOpenRouterServiceTier(selection)}`;
    case "sort":
      return `${prefix} sort: ${openRouterSortLabel(selection.openRouter?.sort)}`;
    case "vendor":
      return `${prefix} vendor: ${selection.openRouter?.vendor ?? "Auto"}`;
    case "provider-extras":
      return `${prefix} provider extras JSON`;
    case "model":
      return `${prefix} model: ${getClutchProviderLabel(selection.provider, { endpoints: [...endpoints] })} / ${selection.model.length === 0 ? "(choose model)" : selection.model}`;
  }
}

export function openRouterSortLabel(
  sort: OpenRouterOptions["sort"] | undefined,
): string {
  return (
    OPENROUTER_SORT_OPTIONS.find((option) => option.sort === sort)?.label ??
    "Default"
  );
}

export function openRouterVendorOptions(
  capabilities: OpenRouterCapabilities | undefined,
): string[] {
  if (capabilities === undefined || capabilities.vendors.length === 0) {
    return [];
  }
  return ["Auto", ...capabilities.vendors];
}

export function openRouterVendorIndex(
  selection: ClutchModelSelection,
  capabilities: OpenRouterCapabilities | undefined,
): number {
  const options = openRouterVendorOptions(capabilities);
  const vendor = selection.openRouter?.vendor;
  if (vendor === undefined) {
    return 0;
  }
  const index = options.indexOf(vendor);
  if (index === -1) {
    return 0;
  }
  return index;
}

export function openRouterSortIndex(selection: ClutchModelSelection): number {
  const sort = selection.openRouter?.sort;
  const index = OPENROUTER_SORT_OPTIONS.findIndex(
    (option) => option.sort === sort,
  );
  return index === -1 ? 0 : index;
}

export async function commitOpenRouterModelSelection({
  apiKey,
  fetchImpl,
  modelId,
  selection,
}: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  modelId: string;
  selection: ClutchModelSelection;
}): Promise<ClutchModelSelection> {
  const capabilities = await fetchOpenRouterCapabilities(modelId, {
    apiKey,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
  const openRouter = sanitizeOpenRouterOptionsAfterCapabilities({
    capabilities,
    options: {
      ...(selection.openRouter ?? {}),
      capabilities,
    },
  });

  return {
    ...selection,
    effortLevel: capabilities.supportsReasoning
      ? getClutchModelEffortLevel(selection)
      : DEFAULT_CLUTCH_MODEL_EFFORT_LEVEL,
    model: modelId,
    openRouter,
  };
}

export function sanitizeOpenRouterOptionsAfterCapabilities({
  capabilities,
  options,
}: {
  capabilities: OpenRouterCapabilities;
  options: OpenRouterOptions;
}): OpenRouterOptions {
  let validated = validateOpenRouterOptions(options, capabilities);
  if (
    !capabilities.supportsServiceTier &&
    validated.serviceTier !== undefined &&
    validated.serviceTier !== "default"
  ) {
    validated = validateOpenRouterOptions(
      { ...validated, serviceTier: "default" },
      capabilities,
    );
  }
  return validated;
}

export function providerExtrasJson(selection: ClutchModelSelection): string {
  const providerExtras = selection.openRouter?.providerExtras;
  return providerExtras === undefined
    ? "{}"
    : JSON.stringify(providerExtras);
}

export function selectionWithOpenRouterVendor(
  selection: ClutchModelSelection,
  vendorLabel: string,
): ClutchModelSelection {
  const openRouter = { ...(selection.openRouter ?? {}) };
  if (vendorLabel === "Auto") {
    delete openRouter.vendor;
  } else {
    openRouter.vendor = vendorLabel;
  }
  return {
    ...selection,
    openRouter,
  };
}

export function selectionWithOpenRouterSort(
  selection: ClutchModelSelection,
  sort: OpenRouterOptions["sort"] | undefined,
): ClutchModelSelection {
  const openRouter = { ...(selection.openRouter ?? {}) };
  if (sort === undefined) {
    delete openRouter.sort;
  } else {
    openRouter.sort = sort;
  }
  return {
    ...selection,
    openRouter,
  };
}

export function selectionWithProviderExtrasJson(
  selection: ClutchModelSelection,
  json: string,
): ClutchModelSelection {
  const parsed = parseJsonObject(
    json.length === 0 ? "{}" : json,
    "OpenRouter provider extras must be a JSON object.",
  );
  const openRouter = { ...(selection.openRouter ?? {}) };
  if (Object.keys(parsed).length === 0) {
    delete openRouter.providerExtras;
  } else {
    openRouter.providerExtras = parsed;
  }
  return {
    ...selection,
    openRouter,
  };
}

export function entryLabel(entry: ModelEntry): string {
  switch (entry) {
    case "agent":
      return "Agent";
    case "primary":
      return "Primary";
    case "summarization":
      return "Summarization";
  }
}

export function parseJsonObject(
  value: string,
  message: string,
): Record<string, unknown> {
  const parsed = parseJsonValue(value.length === 0 ? "{}" : value, message);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(message);
  }
  return parsed as Record<string, unknown>;
}

export function parseJsonStringArray(value: string, message: string): string[] {
  const parsed = parseJsonValue(value.length === 0 ? "[]" : value, message);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  ) {
    throw new Error(message);
  }
  return parsed;
}

export function parseJsonStringRecord(
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
