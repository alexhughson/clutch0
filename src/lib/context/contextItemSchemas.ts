import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentOutputBlock } from "../agentOutput/agentOutputTypes";
import { patchProposalFromLegacyEdits } from "../patch/patchEngine";
import type { PatchProposal } from "../patch/types";

const GeneratedContextItemSummarySchema = Type.Object({
  details: Type.String(),
  generatedAt: Type.Number(),
  oneLine: Type.String(),
  sourceHash: Type.String(),
});

const RawContextItemSummaryStateSchema = Type.Union([
  Type.Object({ status: Type.Literal("missing") }),
  Type.Object({
    sourceHash: Type.String(),
    status: Type.Literal("ready"),
    summary: GeneratedContextItemSummarySchema,
  }),
  Type.Object({
    errorMessage: Type.String(),
    sourceHash: Type.String(),
    status: Type.Literal("error"),
    workerId: Type.String(),
  }),
  Type.Object({
    sourceHash: Type.String(),
    status: Type.Literal("pending"),
    workerId: Type.String(),
  }),
]);

export const ContextItemSummaryStateSchema = Type.Transform(
  RawContextItemSummaryStateSchema,
)
  .Decode((value) =>
    value.status === "pending" ? { status: "missing" as const } : value,
  )
  .Encode((value) => value);

const PersistentContextItemBaseSchema = Type.Object({
  id: Type.String(),
  schemaVersion: Type.Literal(1),
  summaryState: ContextItemSummaryStateSchema,
});

export const AgentOutputStatusBlockSchema = Type.Object({
  id: Type.String(),
  kind: Type.Literal("status"),
  message: Type.String(),
  timestamp: Type.Number(),
});

export const AgentOutputStreamBlockSchema = Type.Object({
  id: Type.String(),
  kind: Type.Literal("stream"),
  streamKind: Type.Union([Type.Literal("assistant"), Type.Literal("thinking")]),
  text: Type.String(),
  timestamp: Type.Number(),
  truncated: Type.Optional(Type.Boolean()),
});

export const AgentOutputToolBlockSchema = Type.Object({
  id: Type.String(),
  isError: Type.Optional(Type.Boolean()),
  kind: Type.Literal("tool"),
  phase: Type.Union([
    Type.Literal("end"),
    Type.Literal("start"),
    Type.Literal("update"),
  ]),
  summary: Type.String(),
  timestamp: Type.Number(),
  toolName: Type.String(),
});

export const AgentOutputBlockSchema = Type.Union([
  AgentOutputStatusBlockSchema,
  AgentOutputStreamBlockSchema,
  AgentOutputToolBlockSchema,
]);

export const ShellCommandResultSchema = Type.Object({
  command: Type.String(),
  durationMs: Type.Number(),
  exitCode: Type.Union([Type.Number(), Type.Null()]),
  signal: Type.Optional(Type.String()),
  stderr: Type.String(),
  stdout: Type.String(),
  timedOut: Type.Boolean(),
  truncated: Type.Boolean(),
});

const PatchProposalModernSchema = Type.Object({
  patch: Type.String(),
  summary: Type.String(),
  toolCallId: Type.Optional(Type.String()),
});

const PatchProposalLegacySchema = Type.Object({
  edits: Type.Array(
    Type.Object({
      newText: Type.String(),
      oldText: Type.String(),
      path: Type.String(),
    }),
  ),
  summary: Type.String(),
});

export const PatchProposalSchema = Type.Transform(
  Type.Union([PatchProposalModernSchema, PatchProposalLegacySchema]),
)
  .Decode((value) => {
    if ("patch" in value) {
      return value;
    }

    return patchProposalFromLegacyEdits({
      edits: value.edits,
      summary: value.summary,
    });
  })
  .Encode((value) => value);

export const AgentSandboxContextSchema = Type.Object({
  baselineTree: Type.String(),
  diffStatus: Type.Union([
    Type.Literal("clean"),
    Type.Literal("dirty"),
    Type.Literal("error"),
    Type.Literal("unknown"),
  ]),
  errorMessage: Type.Optional(Type.String()),
  path: Type.String(),
  root: Type.String(),
  summary: Type.Optional(Type.String()),
});

export const FileContextItemSchema = Type.Intersect([
  PersistentContextItemBaseSchema,
  Type.Object({
    filePath: Type.String(),
    type: Type.Literal("file"),
  }),
]);

export const SavedLlmResponseContextItemSchema = Type.Intersect([
  PersistentContextItemBaseSchema,
  Type.Object({
    createdAt: Type.Number(),
    output: Type.String(),
    prompt: Type.String(),
    sourceRequestId: Type.Number(),
    type: Type.Literal("llm-response"),
  }),
]);

export const ShellCommandOutputContextItemSchema = Type.Intersect([
  PersistentContextItemBaseSchema,
  Type.Object({
    createdAt: Type.Number(),
    result: ShellCommandResultSchema,
    sourceRequestId: Type.Number(),
    type: Type.Literal("shell-command-output"),
  }),
]);

export const UserTextContextItemSchema = Type.Intersect([
  PersistentContextItemBaseSchema,
  Type.Object({
    createdAt: Type.Number(),
    text: Type.String(),
    type: Type.Literal("user-text"),
  }),
]);

export const LiveLlmResponseContextItemSchema = Type.Intersect([
  PersistentContextItemBaseSchema,
  Type.Object({
    createdAt: Type.Number(),
    errorMessage: Type.Optional(Type.String()),
    output: Type.String(),
    prompt: Type.String(),
    sourceRequestId: Type.Number(),
    status: Type.Union([Type.Literal("error"), Type.Literal("running")]),
    type: Type.Literal("llm-response-live"),
  }),
]);

export const PiAgentContextItemSchema = Type.Intersect([
  PersistentContextItemBaseSchema,
  Type.Object({
    blocks: Type.Array(AgentOutputBlockSchema),
    createdAt: Type.Number(),
    errorMessage: Type.Optional(Type.String()),
    mode: Type.Union([Type.Literal("ask"), Type.Literal("edit")]),
    prompt: Type.String(),
    sandbox: Type.Optional(AgentSandboxContextSchema),
    sessionAvailability: Type.Union([
      Type.Literal("detached"),
      Type.Literal("live"),
    ]),
    status: Type.Union([
      Type.Literal("error"),
      Type.Literal("idle"),
      Type.Literal("running"),
    ]),
    type: Type.Literal("pi-agent"),
  }),
]);

export const SavedDiffContextItemSchema = Type.Intersect([
  PersistentContextItemBaseSchema,
  Type.Object({
    createdAt: Type.Number(),
    diffText: Type.String(),
    prompt: Type.String(),
    proposal: PatchProposalSchema,
    sourceRequestId: Type.Number(),
    summary: Type.String(),
    type: Type.Literal("diff"),
  }),
]);

export const SavedAgentSandboxDiffContextItemSchema = Type.Intersect([
  PersistentContextItemBaseSchema,
  Type.Object({
    createdAt: Type.Number(),
    diffText: Type.String(),
    prompt: Type.String(),
    sourceAgentItemId: Type.String(),
    summary: Type.String(),
    type: Type.Literal("agent-sandbox-diff"),
  }),
]);

export const persistentContextItemSchemas = {
  "agent-sandbox-diff": SavedAgentSandboxDiffContextItemSchema,
  diff: SavedDiffContextItemSchema,
  file: FileContextItemSchema,
  "llm-response": SavedLlmResponseContextItemSchema,
  "llm-response-live": LiveLlmResponseContextItemSchema,
  "pi-agent": PiAgentContextItemSchema,
  "shell-command-output": ShellCommandOutputContextItemSchema,
  "user-text": UserTextContextItemSchema,
} as const;

export type PersistentContextItemType =
  keyof typeof persistentContextItemSchemas;

export type FileContextItemState = Static<typeof FileContextItemSchema>;
export type SavedLlmResponseContextItemState = Static<
  typeof SavedLlmResponseContextItemSchema
>;
export type ShellCommandOutputContextItemState = Static<
  typeof ShellCommandOutputContextItemSchema
>;
export type UserTextContextItemState = Static<typeof UserTextContextItemSchema>;
export type LiveLlmResponseContextItemState = Static<
  typeof LiveLlmResponseContextItemSchema
>;
export type PiAgentContextItemState = Omit<
  Static<typeof PiAgentContextItemSchema>,
  "blocks"
> & {
  blocks: readonly AgentOutputBlock[];
};
export type SavedDiffContextItemState = Omit<
  Static<typeof SavedDiffContextItemSchema>,
  "proposal"
> & {
  proposal: PatchProposal;
};
export type SavedAgentSandboxDiffContextItemState = Static<
  typeof SavedAgentSandboxDiffContextItemSchema
>;
