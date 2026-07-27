import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { LlmRequestState } from "../../app/appTypes";
import type { CreateFileValidationResult } from "../createFile/createFile";
import type { AgentOutputBlock } from "../agentOutput/agentOutputTypes";
import {
  AgentOutputStatusBlockSchema,
  AgentOutputStreamBlockSchema,
  AgentOutputToolBlockSchema,
  PatchProposalSchema,
  ShellCommandResultSchema,
} from "../context/contextItemSchemas";
import {
  decodeContextItemV1,
  encodeContextItemV1,
} from "../context/contextItemPersistence";
import type { PersistentContextItem } from "../context/contextItemTypes";
import {
  NonNegativeSafeInteger,
  PositiveSafeInteger,
  decodeSchema,
} from "../schemaDecode";

export const APP_SNAPSHOT_SCHEMA_VERSION = 1;
const NonNegativeNumber = Type.Number({ minimum: 0 });

export const ComposerStateSchema = Type.Object({
  cursorPosition: NonNegativeSafeInteger,
  message: Type.String(),
});

export const ContextItemReplacementTargetSchema = Type.Object({
  contextItemId: Type.String(),
  expectedResult: Type.Union([Type.Literal("diff"), Type.Literal("text")]),
});

export const ShellCommandReplacementTargetSchema = Type.Object({
  contextItemId: Type.String(),
});

export const RelevantFileCandidateSchema = Type.Object({
  confidence: Type.Optional(
    Type.Union([
      Type.Literal("high"),
      Type.Literal("low"),
      Type.Literal("medium"),
    ]),
  ),
  path: Type.String(),
  reason: Type.String(),
});

const CreateFileProposalSchema = Type.Object({
  content: Type.String(),
  path: Type.String(),
  summary: Type.String(),
});

const CreateFileValidationErrorSchema = Type.Object({
  message: Type.String(),
  path: Type.String(),
});

export const CreateFileValidationResultSchema = Type.Union([
  Type.Object({
    proposal: CreateFileProposalSchema,
    status: Type.Literal("valid"),
  }),
  Type.Object({
    errors: Type.Array(CreateFileValidationErrorSchema),
    proposal: CreateFileProposalSchema,
    status: Type.Literal("invalid"),
  }),
]);

const PatchValidationErrorSchema = Type.Object({
  editIndex: NonNegativeSafeInteger,
  message: Type.String(),
  path: Type.Optional(Type.String()),
});

const PatchApplyStatusSchema = Type.Union([
  Type.Literal("applied"),
  Type.Literal("apply-error"),
  Type.Literal("applying"),
  Type.Literal("pending"),
  Type.Literal("rejected"),
]);

export const PatchReviewStateSchema = Type.Union([
  Type.Object({
    applyErrorMessage: Type.Optional(Type.String()),
    applyStatus: PatchApplyStatusSchema,
    diffText: Type.String(),
    proposal: PatchProposalSchema,
    status: Type.Literal("valid"),
  }),
  Type.Object({
    applyErrorMessage: Type.Optional(Type.String()),
    applyStatus: PatchApplyStatusSchema,
    errors: Type.Array(PatchValidationErrorSchema),
    proposal: PatchProposalSchema,
    status: Type.Literal("invalid"),
  }),
]);

export const PatchProgressStateSchema = Type.Object({
  files: Type.Array(
    Type.Object({
      movePath: Type.Optional(Type.String()),
      operation: Type.Union([
        Type.Literal("add"),
        Type.Literal("delete"),
        Type.Literal("update"),
      ]),
      path: Type.String(),
    }),
  ),
  patchCharacterCount: NonNegativeSafeInteger,
});

export const LlmRequestLatencyStatsSchema = Type.Object({
  totalMs: Type.Optional(NonNegativeNumber),
  ttftMs: Type.Optional(NonNegativeNumber),
});

const LlmRequestBaseSchema = Type.Object({
  focusedContextItemId: Type.Union([Type.String(), Type.Null()]),
  id: PositiveSafeInteger,
  latencyStats: Type.Optional(LlmRequestLatencyStatsSchema),
  patch: Type.Optional(PatchReviewStateSchema),
  patchProgress: Type.Optional(PatchProgressStateSchema),
  question: Type.String(),
  replacement: Type.Optional(ContextItemReplacementTargetSchema),
  responseText: Type.String(),
  savedContextItemId: Type.Optional(Type.String()),
});

const InProgressLlmRequestStateSchema = Type.Intersect([
  LlmRequestBaseSchema,
  Type.Object({
    errorMessage: Type.Optional(Type.String()),
    status: Type.Union([Type.Literal("loading"), Type.Literal("streaming")]),
  }),
]);

const DoneLlmRequestStateSchema = Type.Intersect([
  LlmRequestBaseSchema,
  Type.Object({
    errorMessage: Type.Optional(Type.String()),
    status: Type.Literal("done"),
  }),
]);

const ErrorLlmRequestStateSchema = Type.Intersect([
  LlmRequestBaseSchema,
  Type.Object({
    errorMessage: Type.String(),
    status: Type.Literal("error"),
  }),
]);

export const LlmRequestStateSchema = Type.Union([
  InProgressLlmRequestStateSchema,
  DoneLlmRequestStateSchema,
  ErrorLlmRequestStateSchema,
]);

export const ContextItemViewerTaskSchema = Type.Intersect([
  Type.Object({
    itemId: Type.String(),
    kind: Type.Literal("context-item-viewer"),
    rejectComposer: Type.Optional(ComposerStateSchema),
  }),
  Type.Union([
    Type.Object({
      applyStatus: Type.Literal("idle"),
    }),
    Type.Object({
      applyStatus: Type.Literal("applying"),
    }),
    Type.Object({
      applyErrorMessage: Type.String(),
      applyStatus: Type.Literal("apply-error"),
    }),
  ]),
]);

export const CreateFileTaskSchema = Type.Intersect([
  Type.Object({
    id: PositiveSafeInteger,
    kind: Type.Literal("create-file"),
    prompt: Type.String(),
    rejectComposer: Type.Optional(ComposerStateSchema),
  }),
  Type.Union([
    Type.Object({
      applyStatus: Type.Literal("pending"),
    }),
    Type.Object({
      applyStatus: Type.Literal("applying"),
    }),
    Type.Object({
      applyErrorMessage: Type.String(),
      applyStatus: Type.Literal("apply-error"),
    }),
  ]),
]);

const CreateFileTaskParseSchema = Type.Intersect([
  CreateFileTaskSchema,
  Type.Object({
    validation: Type.Unknown(),
  }),
]);

export { CreateFileTaskParseSchema };

export const FindFilesTaskSchema = Type.Intersect([
  Type.Object({
    goal: Type.String(),
    hints: Type.Array(Type.String()),
    kind: Type.Literal("find-files"),
    rejectComposer: Type.Optional(ComposerStateSchema),
  }),
  Type.Union([
    Type.Object({
      status: Type.Literal("searching"),
    }),
    Type.Object({
      candidates: Type.Array(RelevantFileCandidateSchema),
      selectedIndex: NonNegativeSafeInteger,
      status: Type.Literal("results"),
    }),
    Type.Object({
      errorMessage: Type.String(),
      status: Type.Literal("error"),
    }),
  ]),
]);

const FindFilesTaskParseSchema = Type.Intersect([
  FindFilesTaskSchema,
  Type.Object({
    agentOutput: Type.Array(Type.Unknown()),
  }),
]);

export { FindFilesTaskParseSchema };

export const ShellCommandTaskSchema = Type.Intersect([
  Type.Object({
    id: PositiveSafeInteger,
    kind: Type.Literal("shell-command"),
    prompt: Type.String(),
    rejectComposer: Type.Optional(ComposerStateSchema),
    replacement: Type.Optional(ShellCommandReplacementTargetSchema),
  }),
  Type.Union([
    Type.Object({
      status: Type.Literal("running"),
    }),
    Type.Object({
      result: ShellCommandResultSchema,
      savedContextItemId: Type.Optional(Type.String()),
      status: Type.Literal("done"),
    }),
    Type.Object({
      errorMessage: Type.String(),
      status: Type.Literal("error"),
    }),
  ]),
]);

export const ShowContextTaskSchema = Type.Intersect([
  Type.Object({
    id: PositiveSafeInteger,
    kind: Type.Literal("show-context"),
    question: Type.String(),
    rejectComposer: Type.Optional(ComposerStateSchema),
  }),
  Type.Union([
    Type.Object({
      status: Type.Literal("loading"),
    }),
    Type.Object({
      content: Type.String(),
      status: Type.Literal("done"),
    }),
    Type.Object({
      errorMessage: Type.String(),
      status: Type.Literal("error"),
    }),
  ]),
]);

export const ResponseTaskSchema = Type.Object({
  kind: Type.Literal("response"),
  rejectComposer: Type.Optional(ComposerStateSchema),
  request: LlmRequestStateSchema,
});

export const SerializedAppTaskSchema = Type.Union([
  ContextItemViewerTaskSchema,
  CreateFileTaskParseSchema,
  FindFilesTaskParseSchema,
  ShellCommandTaskSchema,
  ShowContextTaskSchema,
  ResponseTaskSchema,
]);

const RawWorkspaceSchema = Type.Object({
  composer: ComposerStateSchema,
  contextItems: Type.Array(Type.Unknown()),
  focusedContextItemId: Type.Union([Type.String(), Type.Null()]),
});

const RawResponseTaskSchema = Type.Object({
  kind: Type.Literal("response"),
  rejectComposer: Type.Optional(ComposerStateSchema),
  request: Type.Intersect([
    LlmRequestStateSchema,
    Type.Object({
      contextItems: Type.Array(Type.Unknown()),
    }),
  ]),
});

const RawSerializedAppTaskSchema = Type.Union([
  ContextItemViewerTaskSchema,
  CreateFileTaskParseSchema,
  FindFilesTaskParseSchema,
  ShellCommandTaskSchema,
  ShowContextTaskSchema,
  RawResponseTaskSchema,
]);

export const RawAppSnapshotSchema = Type.Object({
  activeTask: Type.Union([
    RawSerializedAppTaskSchema,
    Type.Null(),
    Type.Object({ kind: Type.Literal("config") }),
    Type.Object({ kind: Type.String() }),
  ]),
  nextContextItemId: PositiveSafeInteger,
  nextLlmRequestId: PositiveSafeInteger,
  schemaVersion: Type.Literal(APP_SNAPSHOT_SCHEMA_VERSION),
  workspace: RawWorkspaceSchema,
  workspaceRoot: Type.String(),
});

export type RawAppSnapshot = Static<typeof RawAppSnapshotSchema>;
export type SerializedLlmRequestState = Omit<
  LlmRequestState,
  "contextItems"
> & {
  contextItems: PersistentContextItem[];
};
export type SerializedResponseTaskState = Omit<
  Static<typeof ResponseTaskSchema>,
  "request"
> & {
  request: SerializedLlmRequestState;
};
export type SerializedAppTask =
  | Exclude<
      Static<typeof SerializedAppTaskSchema>,
      { kind: "create-file" | "find-files" | "response" }
    >
  | (Static<typeof CreateFileTaskSchema> & {
      kind: "create-file";
      validation: CreateFileValidationResult;
    })
  | (Static<typeof FindFilesTaskSchema> & {
      agentOutput: AgentOutputBlock[];
      kind: "find-files";
    })
  | SerializedResponseTaskState;
export type SerializedWorkspace = Omit<
  Static<typeof RawWorkspaceSchema>,
  "contextItems"
> & {
  contextItems: PersistentContextItem[];
};
export type AppSnapshot = Omit<
  Static<typeof RawAppSnapshotSchema>,
  "activeTask" | "workspace"
> & {
  activeTask: SerializedAppTask | null;
  workspace: SerializedWorkspace;
};

export function decodeCreateFileValidationResult(
  value: unknown,
  label: string,
): CreateFileValidationResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const record = value as Record<string, unknown>;
  const status = record.status;
  if (status !== "valid" && status !== "invalid") {
    throw new Error(`${label}.status must be one of: valid, invalid.`);
  }

  const proposal = decodeSchema<Static<typeof CreateFileProposalSchema>>(
    CreateFileProposalSchema,
    record.proposal,
    `${label}.proposal`,
  );
  if (status === "valid") {
    return { proposal, status };
  }

  return {
    errors: decodeSchema(
      Type.Array(CreateFileValidationErrorSchema),
      record.errors,
      `${label}.errors`,
    ),
    proposal,
    status,
  };
}

export function decodeAgentOutputBlocks(
  blocks: unknown,
  label: string,
): AgentOutputBlock[] {
  if (!Array.isArray(blocks)) {
    throw new Error(`${label} must be an array.`);
  }

  return blocks.map((block, index) =>
    decodeAgentOutputBlock(block, `${label}[${index}]`),
  );
}

export function decodeAgentOutputBlock(
  value: unknown,
  label: string,
): AgentOutputBlock {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const kind = (value as { kind?: unknown }).kind;
  if (kind === "status") {
    return decodeSchema(AgentOutputStatusBlockSchema, value, label);
  }
  if (kind === "stream") {
    return decodeSchema(AgentOutputStreamBlockSchema, value, label);
  }
  if (kind === "tool") {
    return decodeSchema(AgentOutputToolBlockSchema, value, label);
  }

  throw new Error(`${label}.kind must be one of: status, stream, tool.`);
}

export function decodePersistentContextItems(
  snapshots: readonly unknown[],
  label: string,
): PersistentContextItem[] {
  const ids = new Set<string>();
  return snapshots.map((snapshot, index) => {
    const item = decodeContextItemV1(snapshot);
    if (ids.has(item.id)) {
      throw new Error(`${label}[${index}].id duplicates ${item.id}.`);
    }

    ids.add(item.id);
    return item;
  });
}

export function encodePersistentContextItems(
  items: readonly PersistentContextItem[],
): PersistentContextItem[] {
  return items.map(encodeContextItemV1);
}
