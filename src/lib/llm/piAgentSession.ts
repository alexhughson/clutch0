import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
} from "@earendil-works/pi-coding-agent";
import {
  getClutchConfigPaths,
  resolveConfiguredLlmModel,
  type ClutchConfigPaths,
  type ClutchModelRole,
} from "../config/clutchConfig";

export type CreateConfiguredPiAgentSessionOptions = Omit<
  CreateAgentSessionOptions,
  "authStorage" | "model" | "modelRegistry"
> & {
  modelRole?: ClutchModelRole;
};

export async function createConfiguredPiAgentSession({
  modelRole = "agent",
  ...options
}: CreateConfiguredPiAgentSessionOptions): Promise<CreateAgentSessionResult> {
  const services = createPiAgentModelServices({ modelRole });
  return createAgentSession({
    ...services,
    ...options,
    thinkingLevel: options.thinkingLevel ?? services.thinkingLevel,
  });
}

export function createPiAgentModelServices({
  modelRole = "agent",
  paths = getClutchConfigPaths(),
}: {
  modelRole?: ClutchModelRole;
  paths?: ClutchConfigPaths;
} = {}) {
  const { effortLevel, model } = resolveConfiguredLlmModel(modelRole, paths);
  const authStorage = AuthStorage.create(paths.authPath);

  return {
    authStorage,
    model,
    modelRegistry: ModelRegistry.inMemory(authStorage),
    thinkingLevel: effortLevel,
  };
}
