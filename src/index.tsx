#!/usr/bin/env bun

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App";
import { loadFileList } from "./lib/fileListLoader";

const filePaths = await loadFileList();
const renderer = await createCliRenderer({
  exitOnCtrlC: true,
});

createRoot(renderer).render(<App filePaths={filePaths} />);
