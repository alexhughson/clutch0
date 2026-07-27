import {
  getClutchConfigPaths,
  hasUsableApiKey,
  loadClutchAuth,
  loadClutchSettings,
  OPENROUTER_BASE_URL,
  OPENROUTER_PROVIDER_ID,
  type ClutchConfigPaths,
  type ClutchEndpoint,
} from "./clutchConfig";

export type ClutchProviderModel = {
  id: string;
  name: string;
};

type FetchModelOptions = {
  fetchImpl?: typeof fetch;
  paths?: ClutchConfigPaths;
  signal?: AbortSignal;
};

export async function fetchClutchProviderModels({
  fetchImpl = fetch,
  paths = getClutchConfigPaths(),
  provider,
  signal,
}: FetchModelOptions & {
  provider: string;
}): Promise<ClutchProviderModel[]> {
  const settings = loadClutchSettings(paths);
  const endpoint = resolveProviderEndpoint(provider, settings.endpoints ?? []);
  const credential = loadClutchAuth(paths)[provider];
  if (!hasUsableApiKey(credential)) {
    throw new Error(
      `Missing Clutch credentials for provider "${provider}". Configure credentials before loading models.`,
    );
  }

  const response = await fetchImpl(`${endpoint.baseUrl}/models`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${credential.key}`,
      ...(endpoint.headers ?? {}),
    },
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Could not load ${provider} models: HTTP ${response.status}${body.trim().length === 0 ? "" : ` ${body.trim().slice(0, 300)}`}`,
    );
  }

  return modelsFromProviderResponse(await response.json());
}

export function modelsFromProviderResponse(
  responseJson: unknown,
): ClutchProviderModel[] {
  if (
    responseJson === null ||
    typeof responseJson !== "object" ||
    Array.isArray(responseJson)
  ) {
    throw new Error("Provider models response must be a JSON object.");
  }

  const data = (responseJson as Record<string, unknown>).data;
  if (!Array.isArray(data)) {
    throw new Error("Provider models response must include a data array.");
  }

  const modelsById = new Map<string, ClutchProviderModel>();
  for (const [index, item] of data.entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Provider models data[${index}] must be an object.`);
    }

    const record = item as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new Error(`Provider models data[${index}].id must be a string.`);
    }

    const name =
      typeof record.name === "string" ? record.name : titleFromModelId(id);
    modelsById.set(id, { id, name });
  }

  return [...modelsById.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function resolveProviderEndpoint(
  provider: string,
  endpoints: readonly ClutchEndpoint[],
): { baseUrl: string; headers?: Record<string, string> } {
  if (provider === OPENROUTER_PROVIDER_ID) {
    return { baseUrl: OPENROUTER_BASE_URL };
  }

  const endpoint = endpoints.find((candidate) => candidate.id === provider);
  if (endpoint === undefined) {
    throw new Error(`Unknown Clutch provider "${provider}".`);
  }

  return endpoint;
}

function titleFromModelId(id: string): string {
  return id
    .split("/")
    .at(-1)!
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
