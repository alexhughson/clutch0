import type { LlmModel } from "../llm/types";
import type {
  OpenRouterCapabilities,
  OpenRouterOptions,
} from "./clutchConfig";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const OPENROUTER_GEMINI_REASONING_PREFIX = "google/gemini-3";
const OPENROUTER_OPENAI_REASONING_PREFIXES = [
  "openai/gpt-5",
  "openai/o",
  "xai/grok",
] as const;

export function openRouterModelTraits(modelId: string): {
  reasoning: boolean;
  thinkingLevelMap?: LlmModel["thinkingLevelMap"];
} {
  const normalized = modelId.toLowerCase();
  if (normalized.startsWith(OPENROUTER_GEMINI_REASONING_PREFIX)) {
    return {
      reasoning: true,
      thinkingLevelMap: { xhigh: "high" },
    };
  }
  if (
    OPENROUTER_OPENAI_REASONING_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix),
    )
  ) {
    return { reasoning: true };
  }
  return { reasoning: false };
}

export async function fetchOpenRouterCapabilities(
  modelId: string,
  {
    apiKey,
    fetchImpl = fetch,
  }: {
    apiKey: string;
    fetchImpl?: typeof fetch;
  },
): Promise<OpenRouterCapabilities> {
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${apiKey}`,
  };

  const slashIndex = modelId.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(
      `OpenRouter model id must include author/slug: "${modelId}".`,
    );
  }
  const author = modelId.slice(0, slashIndex);
  const slug = modelId.slice(slashIndex + 1);
  const endpointsUrl = `${OPENROUTER_BASE_URL}/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`;

  const [modelsResponse, endpointsResponse] = await Promise.all([
    fetchImpl(`${OPENROUTER_BASE_URL}/models`, { headers }),
    fetchImpl(endpointsUrl, { headers }),
  ]);

  if (!modelsResponse.ok) {
    const body = await modelsResponse.text().catch(() => "");
    throw new Error(
      `Could not load OpenRouter capabilities: HTTP ${modelsResponse.status}${body.trim().length === 0 ? "" : ` ${body.trim().slice(0, 300)}`}`,
    );
  }

  if (!endpointsResponse.ok) {
    const body = await endpointsResponse.text().catch(() => "");
    throw new Error(
      `Could not load OpenRouter endpoints for "${modelId}": HTTP ${endpointsResponse.status}${body.trim().length === 0 ? "" : ` ${body.trim().slice(0, 300)}`}`,
    );
  }

  const modelsJson = await modelsResponse.json();
  const record = findOpenRouterModelRecord(modelsJson, modelId);
  if (record === undefined) {
    throw new Error(`OpenRouter model "${modelId}" was not found.`);
  }

  const supportedParameters = readStringArray(record.supported_parameters);
  const supportsReasoning =
    supportedParameters.includes("reasoning") ||
    supportedParameters.includes("reasoning_effort");

  const { serviceTiers, vendors } = capabilitiesFromEndpointsResponse(
    await endpointsResponse.json(),
  );

  return {
    vendors,
    supportsReasoning,
    serviceTiers,
  };
}

export function validateOpenRouterOptions(
  options: OpenRouterOptions,
  capabilities: OpenRouterCapabilities,
): OpenRouterOptions {
  let validated: OpenRouterOptions = { ...options, capabilities };

  if (
    validated.vendor !== undefined &&
    !capabilities.vendors.includes(validated.vendor)
  ) {
    const { vendor: _vendor, allowFallbacks: _allowFallbacks, ...rest } =
      validated;
    validated = rest;
  }

  if (
    validated.serviceTier !== undefined &&
    validated.serviceTier !== "default" &&
    !capabilities.serviceTiers.includes(validated.serviceTier)
  ) {
    const { serviceTier: _serviceTier, ...rest } = validated;
    validated = rest;
  }

  return validated;
}

export function baseVendorTag(tag: string): string {
  if (tag.endsWith("/flex") || tag.endsWith("/priority")) {
    return tag.slice(0, tag.lastIndexOf("/"));
  }
  return tag;
}

function capabilitiesFromEndpointsResponse(responseJson: unknown): {
  serviceTiers: OpenRouterCapabilities["serviceTiers"];
  vendors: string[];
} {
  const tags = endpointTagsFromResponse(responseJson);
  const vendors = new Set<string>();
  let hasFlex = false;
  let hasPriority = false;

  for (const tag of tags) {
    if (tag.endsWith("/flex")) {
      hasFlex = true;
    } else if (tag.endsWith("/priority")) {
      hasPriority = true;
    }
    vendors.add(baseVendorTag(tag));
  }

  const serviceTiers: OpenRouterCapabilities["serviceTiers"] = [];
  if (hasFlex) {
    serviceTiers.push("flex");
  }
  if (hasPriority) {
    serviceTiers.push("priority");
  }

  return {
    serviceTiers,
    vendors: [...vendors].sort(),
  };
}

function endpointTagsFromResponse(responseJson: unknown): string[] {
  if (
    responseJson === null ||
    typeof responseJson !== "object" ||
    Array.isArray(responseJson)
  ) {
    throw new Error("OpenRouter endpoints response must be a JSON object.");
  }

  const data = (responseJson as Record<string, unknown>).data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      "OpenRouter endpoints response must include a data object.",
    );
  }

  const endpoints = (data as Record<string, unknown>).endpoints;
  if (!Array.isArray(endpoints)) {
    throw new Error(
      "OpenRouter endpoints response must include a data.endpoints array.",
    );
  }

  const tags: string[] = [];
  for (const item of endpoints) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const tag = (item as Record<string, unknown>).tag;
    if (typeof tag === "string" && tag.length > 0) {
      tags.push(tag);
    }
  }
  return tags;
}

function findOpenRouterModelRecord(
  responseJson: unknown,
  modelId: string,
): Record<string, unknown> | undefined {
  if (
    responseJson === null ||
    typeof responseJson !== "object" ||
    Array.isArray(responseJson)
  ) {
    throw new Error("OpenRouter models response must be a JSON object.");
  }

  const data = (responseJson as Record<string, unknown>).data;
  if (!Array.isArray(data)) {
    throw new Error("OpenRouter models response must include a data array.");
  }

  for (const item of data) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const id = (item as Record<string, unknown>).id;
    if (id === modelId) {
      return item as Record<string, unknown>;
    }
  }

  return undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
