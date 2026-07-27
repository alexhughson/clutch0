import { decodePasteBytes } from "@opentui/core";
import { useKeyboard, usePaste } from "@opentui/react";
import { useEffect } from "react";
import type { ConfigTaskState } from "../../app/appTypes";
import { MenuStep } from "../../components/MenuStep";
import {
  CLUTCH_MODEL_EFFORT_LEVELS,
  CLUTCH_MODEL_SERVICE_TIERS,
} from "../../lib/config/clutchConfigSchemas";
import { getSupportedClutchProviderLabel } from "../../lib/config/clutchConfig";
import { useAppStore } from "../../store/appStore";
import { startConfigModelFetch } from "./configModelFetchController";
import {
  AGENT_BACKEND_ROWS,
  MODEL_SETTINGS_ROWS,
  agentBackendRowLabel,
  entryLabel,
  getModelEntrySelection,
  getVisibleModels,
  matchingModels,
  modelChoiceStatusLabel,
  modelProvidersForEntry,
  modelSettingsRowKey,
  modelSettingsRowLabel,
  providerRows,
  sanitizeLineInput,
} from "./configHelpers";
import { isConfigKeyHandled, keyInputFromEvent } from "./configKeyHandling";
import { hotkeysForStage, stageTitle } from "./configPresentation";

type ConfigScreenProps = {
  task: ConfigTaskState;
};

export function ConfigScreen({ task }: ConfigScreenProps) {
  const actions = useAppStore((state) => state.actions);

  useEffect(() => {
    if (task.stage !== "model-model") {
      return;
    }

    return startConfigModelFetch({
      actions: actions.config,
      requestId: task.modelLoadRequestId,
    });
  }, [
    actions.config,
    task.activeModelEntry,
    task.agent,
    task.modelLoadRequestId,
    task.primary,
    task.stage,
    task.summarization,
  ]);

  useEffect(() => {
    return () => {
      actions.config.cancelSubscriptionLogin();
    };
  }, [actions.config]);

  usePaste((event) => {
    const currentTask = useAppStore.getState().activeTask;
    if (
      currentTask?.kind !== "config" ||
      (currentTask.stage !== "token" && currentTask.stage !== "agent-backend")
    ) {
      return;
    }

    const pastedText = sanitizeLineInput(decodePasteBytes(event.bytes));
    if (pastedText.length === 0) {
      return;
    }

    actions.config.appendPaste({ text: pastedText });
    event.preventDefault();
    event.stopPropagation();
  });

  useKeyboard((event) => {
    const currentTask = useAppStore.getState().activeTask;
    if (currentTask?.kind !== "config") {
      return;
    }

    const key = keyInputFromEvent(event);
    if (!isConfigKeyHandled(currentTask, key)) {
      return;
    }

    actions.config.handleKey({ key });
    event.preventDefault();
    event.stopPropagation();
  });

  return (
    <box
      style={{
        alignItems: "center",
        flexGrow: 1,
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <box
        title={stageTitle({
          activeModelEntry: task.activeModelEntry,
          stage: task.stage,
          task,
        })}
        bottomTitle={hotkeysForStage(task.stage, task)}
        bottomTitleAlignment="right"
        borderStyle="rounded"
        style={{
          border: true,
          flexDirection: "column",
          gap: 1,
          padding: 1,
          width: "80%",
        }}
      >
        {renderStage(task)}
      </box>
    </box>
  );
}

function renderStage(task: ConfigTaskState) {
  switch (task.stage) {
    case "providers":
      return (
        <MenuStep
          description={
            task.mode === "first-run"
              ? "Add provider credentials, then configure models and ACP."
              : "Provider credentials"
          }
          items={providerRows({
            agentBackendConfigured:
              task.agentBackendForm.command.trim().length > 0,
            configuredProviders: task.configuredProviders,
          }).map((row) => ({ key: row.key, label: row.label }))}
          message={task.message}
          messageColor="yellow"
          selectedIndex={task.providerIndex}
        />
      );
    case "token":
      return (
        <>
          <text>{`Provider: ${getSupportedClutchProviderLabel(task.tokenProvider)}`}</text>
          <text>{`Token: ${task.token.length === 0 ? "" : "*".repeat(task.token.length)}`}</text>
          <text style={{ fg: "gray" }}>Paste or type the API token.</text>
          {task.message === null ? null : (
            <text style={{ fg: "red" }}>{task.message}</text>
          )}
        </>
      );
    case "subscription-login":
      return <SubscriptionLoginView login={task.subscriptionLogin} />;
    case "agent-backend":
      return (
        <MenuStep
          items={AGENT_BACKEND_ROWS.map((row) => ({
            key: row,
            label: agentBackendRowLabel({ form: task.agentBackendForm, row }),
          }))}
          message={task.message}
          messageColor="red"
          selectedIndex={task.agentBackendRowIndex}
          title="ACP backend"
        />
      );
    case "model-settings":
      return (
        <MenuStep
          items={MODEL_SETTINGS_ROWS.map((row) => ({
            key: modelSettingsRowKey(row),
            label: modelSettingsRowLabel({
              agent: task.agent,
              primary: task.primary,
              row,
              summarization: task.summarization,
            }),
          }))}
          message={task.message}
          selectedIndex={task.modelSettingsIndex}
          title="Model settings"
        />
      );
    case "model-provider":
      return (
        <MenuStep
          description={`Choose provider for ${entryLabel(task.activeModelEntry)}.`}
          items={modelProvidersForEntry(task.activeModelEntry).map(
            (provider) => ({
              key: provider.id,
              label: provider.label,
            }),
          )}
          message={task.message}
          selectedIndex={task.modelProviderIndex}
        />
      );
    case "model-effort":
      return (
        <MenuStep
          description={`Choose effort for ${entryLabel(task.activeModelEntry)}.`}
          items={CLUTCH_MODEL_EFFORT_LEVELS.map((effortLevel) => ({
            key: effortLevel,
            label: effortLevel,
          }))}
          message={task.message}
          selectedIndex={task.modelEffortIndex}
        />
      );
    case "model-service-tier":
      return (
        <MenuStep
          description={`Choose service tier for ${entryLabel(task.activeModelEntry)}.`}
          items={CLUTCH_MODEL_SERVICE_TIERS.map((serviceTier) => ({
            key: serviceTier,
            label: serviceTier,
          }))}
          message={task.message}
          selectedIndex={task.modelServiceTierIndex}
        />
      );
    case "model-model":
      return <ModelChoiceView task={task} />;
  }
}

function ModelChoiceView({ task }: { task: ConfigTaskState }) {
  const selection = getModelEntrySelection({
    agent: task.agent,
    entry: task.activeModelEntry,
    primary: task.primary,
    summarization: task.summarization,
  });
  const matches = matchingModels({
    filter: task.modelFilter,
    models: task.modelLoad.models,
  });
  const visibleModels = getVisibleModels({
    modelIndex: task.modelIndex,
    models: matches,
  });
  const visibleSelectedIndex = visibleModels.findIndex(
    ({ index }) => index === task.modelIndex,
  );

  return (
    <MenuStep
      description={`Choose model for ${entryLabel(task.activeModelEntry)}.`}
      extraContent={
        <>
          {task.modelLoad.status === "loading" ? (
            <text>Loading models…</text>
          ) : null}
          {task.modelLoad.status === "error" ? (
            <text style={{ fg: "red" }}>{task.modelLoad.errorMessage}</text>
          ) : null}
          {task.modelLoad.status === "loaded" && matches.length === 0 ? (
            <text>No matching models.</text>
          ) : null}
        </>
      }
      items={visibleModels.map(({ model }) => ({
        key: model.id,
        label: `${model.id} — ${model.name}`,
      }))}
      message={task.message}
      messageColor="red"
      selectedIndex={Math.max(0, visibleSelectedIndex)}
      statusText={modelChoiceStatusLabel({
        filter: task.modelFilter,
        modelLoad: task.modelLoad,
        provider: selection.provider,
      })}
    />
  );
}

function SubscriptionLoginView({
  login,
}: {
  login: ConfigTaskState["subscriptionLogin"];
}) {
  return (
    <>
      <text>{`Provider: ${getSupportedClutchProviderLabel("openai-codex")}`}</text>
      <text>Use your ChatGPT Plus or Pro subscription.</text>
      {login.status === "idle" ? (
        <text style={{ fg: "gray" }}>
          Press Enter to start device-code login.
        </text>
      ) : null}
      {login.status === "working" ? <text>{login.message}</text> : null}
      {login.status === "waiting-for-device" ? (
        <>
          <text>{`Open: ${login.info.verificationUri}`}</text>
          <text>{`Code: ${login.info.userCode}`}</text>
          <text style={{ fg: "gray" }}>Waiting for browser approval…</text>
        </>
      ) : null}
      {login.status === "error" ? (
        <text style={{ fg: "red" }}>{login.message}</text>
      ) : null}
    </>
  );
}
