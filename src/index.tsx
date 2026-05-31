#!/usr/bin/env bun

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App";
import { loadFileList } from "./lib/fileListLoader";
import { isClutchConfigured } from "./lib/config/clutchConfig";
import { useAppStore } from "./store/appStore";
import { loadAgentAskSkillSlashCommands } from "./workflows/agentAsk/agentAskResources";
import { setAgentAskSkillSlashCommands } from "./workflows/llmTools/toolRegistry";

const agentAskSkillSlashCommands = await loadAgentAskSkillSlashCommands();
setAgentAskSkillSlashCommands(agentAskSkillSlashCommands);
const filePaths = await loadFileList();
if (!isClutchConfigured()) {
  useAppStore.getState().actions.config.openSetup();
}
const renderer = await createCliRenderer({
  exitOnCtrlC: true,
});

createRoot(renderer).render(<App filePaths={filePaths} />);
