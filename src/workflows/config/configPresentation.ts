import type { ConfigStage } from "./configTypes";
import type { ConfigTaskState } from "../../app/appTypes";
import { entryLabel } from "./configHelpers";

export function stageTitle({
  activeModelEntry,
  stage,
  task,
}: {
  activeModelEntry: ConfigTaskState["activeModelEntry"];
  stage: ConfigStage;
  task: ConfigTaskState;
}): string {
  switch (stage) {
    case "agent-backend":
      return "ACP backend";
    case "providers":
      return task.mode === "first-run" ? "Setup providers" : "Providers";
    case "token":
      return "Provider token";
    case "subscription-login":
      return "OpenAI subscription";
    case "model-settings":
      return "Model settings";
    case "model-effort":
      return `${entryLabel(activeModelEntry)} effort`;
    case "model-service-tier":
      return `${entryLabel(activeModelEntry)} service tier`;
    case "model-provider":
      return `${entryLabel(activeModelEntry)} provider`;
    case "model-model":
      return `${entryLabel(activeModelEntry)} model`;
  }
}

export function hotkeysForStage(
  stage: ConfigStage,
  task: ConfigTaskState,
): string {
  switch (stage) {
    case "agent-backend":
      return "Esc providers · ↑/↓ field · type edit · Ctrl+u clear · Ctrl+s save";
    case "providers":
      return `${task.mode === "settings" ? "Esc return · " : ""}↑/↓ select · Enter open`;
    case "token":
      return "Esc back · paste/type token · Ctrl+u clear · Enter save";
    case "subscription-login":
      return "Esc back · Enter start";
    case "model-settings":
      return "Esc providers · ↑/↓ select · Enter edit/done";
    case "model-effort":
      return "Esc back · ↑/↓ choose effort · Enter choose";
    case "model-service-tier":
      return "Esc back · ↑/↓ choose tier · Enter choose";
    case "model-provider":
      return "Esc back · ↑/↓ choose provider · Enter next";
    case "model-model":
      return "Esc back · ↑/↓ choose model · type filter · Ctrl+u clear · Enter choose";
  }
}
