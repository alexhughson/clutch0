import {
  loginOpenAICodexDeviceCode,
  type OAuthDeviceCodeInfo,
} from "@earendil-works/pi-ai/oauth";
import {
  getClutchConfigPaths,
  saveClutchOAuthCredential,
  type ClutchConfigPaths,
} from "./clutchConfig";

export type OpenAiSubscriptionDeviceCode = OAuthDeviceCodeInfo;

export async function loginClutchOpenAiSubscription({
  onDeviceCode,
  paths = getClutchConfigPaths(),
  signal,
}: {
  onDeviceCode: (info: OAuthDeviceCodeInfo) => void;
  paths?: ClutchConfigPaths;
  signal?: AbortSignal;
}) {
  const credential = await loginOpenAICodexDeviceCode({
    onDeviceCode,
    signal,
  });
  saveClutchOAuthCredential({
    credential,
    paths,
    provider: "openai-codex",
  });
}
