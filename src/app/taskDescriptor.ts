import type { ReactNode } from "react";
import type { TSchema } from "@sinclair/typebox";
import type { AppTask } from "./appTypes";
import type { SerializedAppTask } from "../lib/session/sessionSnapshotSchemas";

export type SnapshotTaskKind = SerializedAppTask["kind"];

export type TaskDescriptor<Kind extends AppTask["kind"]> = {
  canCloseWithCtrlC: (task: Extract<AppTask, { kind: Kind }>) => boolean;
  canUseContextListKeyboardWithPane: boolean;
  isWorkspacePaneTask: (task: Extract<AppTask, { kind: Kind }>) => boolean;
  kind: Kind;
  normalizeOnRestore: (
    task: Extract<AppTask, { kind: Kind }>,
  ) => Extract<AppTask, { kind: Kind }>;
  presentationTitle: string;
  render: (task: Extract<AppTask, { kind: Kind }>) => ReactNode;
  restoreFromSnapshot?: (
    task: Extract<SerializedAppTask, { kind: Kind }>,
  ) => Extract<AppTask, { kind: Kind }>;
  serializedSchema?: TSchema;
  serializeToSnapshot?: (
    task: Extract<AppTask, { kind: Kind }>,
  ) => Extract<SerializedAppTask, { kind: Kind }>;
};

export type TaskDescriptors = {
  [Kind in AppTask["kind"]]: TaskDescriptor<Kind>;
};
