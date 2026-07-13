import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { AppActions, AppState, ConfigTaskState } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import {
  CLUTCH_CONFIG_DIR_ENV,
  saveClutchApiKey,
} from "../../lib/config/clutchConfig";
import {
  CLUTCH_MODEL_EFFORT_LEVELS,
  CLUTCH_MODEL_SERVICE_TIERS,
  SUPPORTED_CLUTCH_LLM_PROVIDERS,
} from "../../lib/config/clutchConfigSchemas";
import { MODEL_SETTINGS_ROWS } from "./configHelpers";
import { createMinimalConfigTask } from "./configInitialState";
import { reduceConfigKey, reduceConfigPaste } from "./configKeyHandling";
import { createConfigActions } from "./configWorkflow";

const originalConfigDir = process.env[CLUTCH_CONFIG_DIR_ENV];

function createHarness(
  initialState: Omit<AppState, "actions"> = createInitialAppState(),
) {
  let state: AppState = {
    ...initialState,
    actions: {} as AppActions,
  };

  const config = createConfigActions({
    get: () => state,
    set: (partial) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    },
  });

  return {
    config,
    get state() {
      return state;
    },
  };
}

function key(
  name: string,
  sequence = name,
  modifiers: { ctrl?: boolean } = {},
): { key: { ctrl?: boolean; name: string; sequence: string } } {
  return { key: { ...modifiers, name, sequence } };
}

function modelFixture({
  id,
  provider = "openai",
}: {
  id: string;
  provider?: string;
}): Model<Api> {
  return {
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    contextWindow: 128_000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 1, output: 2 },
    id,
    input: ["text"],
    maxTokens: 16_384,
    name: id,
    provider,
    reasoning: false,
  };
}

async function withTempConfigDir(run: (configDir: string) => void | Promise<void>) {
  const configDir = await mkdtemp(join(tmpdir(), "clutch-config-workflow-"));
  process.env[CLUTCH_CONFIG_DIR_ENV] = configDir;
  try {
    await run(configDir);
  } finally {
    if (originalConfigDir === undefined) {
      delete process.env[CLUTCH_CONFIG_DIR_ENV];
    } else {
      process.env[CLUTCH_CONFIG_DIR_ENV] = originalConfigDir;
    }
  }
}

function configuredModel(id: string) {
  const metadata = modelFixture({ id });
  return { metadata, model: id, provider: "openai" as const };
}

test("provider list navigation moves the cursor", () => {
  const task = createMinimalConfigTask("settings");
  const down = reduceConfigKey(task, { name: "down", sequence: "down" });
  expect(down).toMatchObject({
    kind: "update",
    task: { providerIndex: 1 },
  });

  const up = reduceConfigKey(
    down.kind === "update" ? down.task : task,
    { name: "up", sequence: "up" },
  );
  expect(up).toMatchObject({
    kind: "update",
    task: { providerIndex: 0 },
  });
});

test("provider selection opens token entry for api-key providers", () => {
  const task = createMinimalConfigTask("settings");
  const openaiIndex = SUPPORTED_CLUTCH_LLM_PROVIDERS.findIndex(
    (provider) => provider.id === "openai",
  );
  const effect = reduceConfigKey(
    { ...task, providerIndex: openaiIndex },
    { name: "return", sequence: "\r" },
  );

  expect(effect).toMatchObject({
    kind: "update",
    task: {
      stage: "token",
      token: "",
      tokenProvider: "openai",
    },
  });
});

test("first-run providers escape does not dismiss the pane", () => {
  const harness = createHarness({
    ...createInitialAppState(),
    activeTask: createMinimalConfigTask("first-run"),
  });

  harness.config.handleKey(key("escape"));
  expect(harness.state.activeTask).toMatchObject({
    kind: "config",
    mode: "first-run",
    stage: "providers",
  });
});

test("model-choice filter narrows visible matches and resets cursor", () => {
  const task = {
    ...createMinimalConfigTask("settings"),
    activeModelEntry: "primary" as const,
    modelFilter: "",
    modelIndex: 2,
    modelLoad: {
      models: [
        { id: "gpt-4.1", name: "GPT 4.1" },
        { id: "gpt-4.1-mini", name: "GPT 4.1 Mini" },
        { id: "o3", name: "O3" },
      ] as Model<Api>[],
      provider: "openai" as const,
      status: "loaded" as const,
    },
    stage: "model-model" as const,
  };

  const filtered = reduceConfigKey(task, { name: "g", sequence: "g" });
  expect(filtered).toMatchObject({
    kind: "update",
    task: {
      modelFilter: "g",
      modelIndex: 0,
    },
  });
});

test("agent-backend typing, paste, clear, save success, and validation error", async () => {
  await withTempConfigDir(() => {
    let task: ConfigTaskState = {
      ...createMinimalConfigTask("settings"),
      stage: "agent-backend",
    };

    const typed = reduceConfigKey(task, { name: "c", sequence: "c" });
    expect(typed).toMatchObject({
      kind: "update",
      task: { agentBackendForm: { command: "c" } },
    });
    task = typed.kind === "update" ? typed.task : task;

    const pasted = reduceConfigPaste(task, "ursor-agent");
    expect(pasted).toMatchObject({
      kind: "update",
      task: { agentBackendForm: { command: "cursor-agent" } },
    });
    task = pasted.kind === "update" ? pasted.task : task;

    const cleared = reduceConfigKey(task, { ctrl: true, name: "u", sequence: "u" });
    expect(cleared).toMatchObject({
      kind: "update",
      task: { agentBackendForm: { command: "" } },
    });
    task = cleared.kind === "update" ? cleared.task : task;

    task = {
      ...task,
      agentBackendForm: {
        ...task.agentBackendForm,
        command: "cursor-agent",
        argsJson: "[not-json",
      },
      agentBackendRowIndex: 3,
    };
    const invalidSave = reduceConfigKey(task, { name: "return", sequence: "\r" });
    expect(invalidSave).toMatchObject({
      kind: "update",
      task: {
        stage: "agent-backend",
        message: 'ACP backend args must be a JSON string array, for example ["acp"].',
      },
    });

    task = {
      ...(invalidSave.kind === "update" ? invalidSave.task : task),
      agentBackendForm: {
        argsJson: '["acp"]',
        command: "cursor-agent",
        envJson: "{}",
      },
      agentBackendRowIndex: 3,
    };
    const saved = reduceConfigKey(task, { name: "return", sequence: "\r" });
    expect(saved).toMatchObject({
      kind: "update",
      task: {
        stage: "providers",
        message: "Saved ACP backend.",
        agentBackend: { args: ["acp"], command: "cursor-agent" },
      },
    });
  });
});

test("token stage save, ctrl+s save, clear, and validation error", async () => {
  await withTempConfigDir(() => {
    const harness = createHarness({
      ...createInitialAppState(),
      activeTask: {
        ...createMinimalConfigTask("settings"),
        stage: "token",
        token: "",
        tokenProvider: "openai",
      },
    });

    harness.config.handleKey(key("return"));
    expect(harness.state.activeTask).toMatchObject({
      kind: "config",
      stage: "token",
      message: 'Missing Clutch API key for provider "openai".',
    });

    harness.config.handleKey({ key: { name: "s", sequence: "s", ctrl: true } });
    expect(harness.state.activeTask).toMatchObject({
      stage: "token",
      message: 'Missing Clutch API key for provider "openai".',
    });

    for (const character of "secret-token") {
      harness.config.handleKey({ key: { name: character, sequence: character } });
    }
    harness.config.handleKey(key("u", "u", { ctrl: true }));
    expect(harness.state.activeTask).toMatchObject({
      stage: "token",
      token: "",
    });

    for (const character of "secret-token") {
      harness.config.handleKey({ key: { name: character, sequence: character } });
    }
    harness.config.handleKey({ key: { name: "s", sequence: "s", ctrl: true } });
    expect(harness.state.activeTask).toMatchObject({
      stage: "providers",
      configuredProviders: ["openai"],
      message: "Saved token for OpenAI.",
      token: "",
    });
  });
});

test("model-settings transitions into effort and service-tier pickers", () => {
  const base = {
    ...createMinimalConfigTask("settings"),
    stage: "model-settings" as const,
  };
  const effortRowIndex = MODEL_SETTINGS_ROWS.findIndex(
    (row) => row.kind === "effort" && row.entry === "primary",
  );
  const serviceTierRowIndex = MODEL_SETTINGS_ROWS.findIndex(
    (row) => row.kind === "service-tier" && row.entry === "primary",
  );

  const effort = reduceConfigKey(
    { ...base, modelSettingsIndex: effortRowIndex },
    { name: "return", sequence: "\r" },
  );
  expect(effort).toMatchObject({
    kind: "update",
    task: {
      activeModelEntry: "primary",
      stage: "model-effort",
    },
  });

  const effortTask = effort.kind === "update" ? effort.task : base;
  const mediumIndex = CLUTCH_MODEL_EFFORT_LEVELS.indexOf("medium");
  const effortChosen = reduceConfigKey(
    { ...effortTask, modelEffortIndex: mediumIndex },
    { name: "return", sequence: "\r" },
  );
  expect(effortChosen).toMatchObject({
    kind: "update",
    task: {
      primary: { provider: "openai", model: "gpt-test", effortLevel: "medium" },
      stage: "model-settings",
      message: "Primary effort updated. Choose Done to save.",
    },
  });

  const serviceTier = reduceConfigKey(
    { ...base, modelSettingsIndex: serviceTierRowIndex },
    { name: "return", sequence: "\r" },
  );
  expect(serviceTier).toMatchObject({
    kind: "update",
    task: {
      activeModelEntry: "primary",
      stage: "model-service-tier",
    },
  });

  const serviceTierTask = serviceTier.kind === "update" ? serviceTier.task : base;
  const priorityIndex = CLUTCH_MODEL_SERVICE_TIERS.indexOf("priority");
  const tierChosen = reduceConfigKey(
    { ...serviceTierTask, modelServiceTierIndex: priorityIndex },
    { name: "return", sequence: "\r" },
  );
  expect(tierChosen).toMatchObject({
    kind: "update",
    task: {
      primary: { provider: "openai", model: "gpt-test", serviceTier: "priority" },
      stage: "model-settings",
      message: "Primary service tier updated. Choose Done to save.",
    },
  });
});

test("model-settings Done saves and closes through actions", async () => {
  await withTempConfigDir(() => {
    const model = configuredModel("gpt-live-primary");
    saveClutchApiKey({ apiKey: "secret-token", provider: "openai" });

    const harness = createHarness({
      ...createInitialAppState(),
      activeTask: {
        ...createMinimalConfigTask("settings"),
        agent: model,
        primary: model,
        summarization: model,
        modelSettingsIndex: MODEL_SETTINGS_ROWS.length - 1,
        stage: "model-settings",
      },
    });

    harness.config.handleKey(key("return"));
    expect(harness.state.activeTask).toBeNull();
  });
});

test("subscription login enter, duplicate enter, and escape abort", () => {
  const startTask = {
    ...createMinimalConfigTask("settings"),
    stage: "subscription-login" as const,
    subscriptionLoginRequestId: 2,
  };

  const start = reduceConfigKey(startTask, { name: "return", sequence: "\r" });
  expect(start).toMatchObject({
    kind: "start-subscription-login",
    requestId: 3,
    task: {
      subscriptionLogin: { status: "working" },
      subscriptionLoginRequestId: 3,
    },
  });

  const runningTask =
    start.kind === "start-subscription-login"
      ? start.task
      : startTask;
  const duplicate = reduceConfigKey(runningTask, { name: "return", sequence: "\r" });
  expect(duplicate).toMatchObject({
    kind: "update",
    task: {
      message: "OpenAI subscription login is already running.",
    },
  });

  const harness = createHarness({
    ...createInitialAppState(),
    activeTask: runningTask,
  });
  harness.config.handleKey(key("escape"));
  expect(harness.state.activeTask).toMatchObject({
    stage: "providers",
    subscriptionLogin: { status: "idle" },
    subscriptionLoginRequestId: 4,
  });
});

test("model-provider enter kicks off model-model load state", () => {
  const task = {
    ...createMinimalConfigTask("settings"),
    activeModelEntry: "primary" as const,
    modelLoadRequestId: 4,
    modelProviderIndex: SUPPORTED_CLUTCH_LLM_PROVIDERS.findIndex(
      (provider) => provider.id === "openai",
    ),
    stage: "model-provider" as const,
  };

  const effect = reduceConfigKey(task, { name: "return", sequence: "\r" });
  expect(effect).toMatchObject({
    kind: "update",
    task: {
      stage: "model-model",
      modelLoadRequestId: 5,
      modelLoad: {
        provider: "openai",
        status: "loading",
        models: [],
      },
      modelFilter: "",
      modelIndex: 0,
    },
  });
});

test("stale model-load completion does not update a closed config task", () => {
  const harness = createHarness({
    ...createInitialAppState(),
    activeTask: {
      ...createMinimalConfigTask("settings"),
      modelLoadRequestId: 3,
      stage: "model-model",
    },
  });

  harness.config.finishModelLoad({
    models: [{ id: "gpt-4.1", name: "GPT 4.1" } as Model<Api>],
    requestId: 2,
  });

  expect(harness.state.activeTask).toMatchObject({
    kind: "config",
    modelLoad: { status: "idle" },
  });

  harness.config.finishModelLoad({
    models: [{ id: "gpt-4.1", name: "GPT 4.1" } as Model<Api>],
    requestId: 3,
  });

  expect(harness.state.activeTask).toMatchObject({
    kind: "config",
    modelLoad: {
      status: "loaded",
      models: [{ id: "gpt-4.1", name: "GPT 4.1" }],
    },
  });

  harness.config.closeAfterSave();
  harness.config.finishModelLoad({
    models: [{ id: "o3", name: "O3" } as Model<Api>],
    requestId: 3,
  });

  expect(harness.state.activeTask).toBeNull();
});

test("stale subscription-login completion does not update a closed config task", () => {
  const harness = createHarness({
    ...createInitialAppState(),
    activeTask: {
      ...createMinimalConfigTask("settings"),
      stage: "subscription-login",
      subscriptionLoginRequestId: 5,
    },
  });

  harness.config.subscriptionLoginFinish({ requestId: 4 });
  expect(harness.state.activeTask).toMatchObject({
    stage: "subscription-login",
    configuredProviders: [],
  });

  harness.config.subscriptionLoginFinish({ requestId: 5 });
  expect(harness.state.activeTask).toMatchObject({
    stage: "providers",
    configuredProviders: ["openai-codex"],
  });

  harness.config.closeAfterSave();
  harness.config.subscriptionLoginFinish({ requestId: 5 });
  expect(harness.state.activeTask).toBeNull();
});

test("settings mode escape on providers dismisses the pane", () => {
  const harness = createHarness({
    ...createInitialAppState(),
    activeTask: createMinimalConfigTask("settings"),
  });

  harness.config.handleKey(key("escape"));
  expect(harness.state.activeTask).toBeNull();
});

test("openSetup creates a fresh providers-stage task", () => {
  const harness = createHarness();
  harness.config.openSetup();

  expect(harness.state.activeTask).toMatchObject({
    kind: "config",
    mode: "first-run",
    stage: "providers",
    providerIndex: 0,
    token: "",
  });
});
