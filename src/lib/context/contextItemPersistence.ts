import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";
import type { AgentOutputBlock } from "../agentOutput/agentOutputTypes";
import {
  AgentOutputStatusBlockSchema,
  AgentOutputStreamBlockSchema,
  AgentOutputToolBlockSchema,
  persistentContextItemSchemas,
  type PersistentContextItemType,
} from "./contextItemSchemas";
import type { PersistentContextItem } from "./contextItemTypes";

export function encodeContextItemV1(
  item: PersistentContextItem,
): PersistentContextItem {
  return item;
}

export function decodeContextItemV1(snapshot: unknown): PersistentContextItem {
  const type = readContextItemType(snapshot);
  if (!Object.hasOwn(persistentContextItemSchemas, type)) {
    throw new Error(`Unknown context item type: ${type}`);
  }

  const schema = persistentContextItemSchemas[type as PersistentContextItemType];
  return decodeSchema(schema, snapshot, type) as PersistentContextItem;
}

export function parseAgentOutputBlock(
  value: unknown,
  label: string,
): AgentOutputBlock {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const record = value as Record<string, unknown>;
  const kind = record.kind;
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

function readContextItemType(snapshot: unknown): string {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("context item snapshot must be an object.");
  }

  const record = snapshot as Record<string, unknown>;
  if (typeof record.type !== "string") {
    throw new Error("context item snapshot type must be a string.");
  }

  const schemaVersion = record.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isFinite(schemaVersion)) {
    throw new Error(`${record.type}.schemaVersion must be a finite number.`);
  }
  if (schemaVersion !== 1) {
    throw new Error(
      `Unsupported context item schema version for "${record.type}": ${schemaVersion}`,
    );
  }

  return record.type;
}

function decodeSchema<T>(schema: TSchema, snapshot: unknown, label: string): T {
  if (!Value.Check(schema, snapshot)) {
    throw formatSchemaValidationError(label, schema, snapshot);
  }

  return Value.Decode(schema, snapshot) as T;
}

function formatSchemaValidationError(
  label: string,
  schema: TSchema,
  snapshot: unknown,
): Error {
  const first = Value.Errors(schema, snapshot).First();
  if (first === undefined) {
    return new Error(`${label}: invalid context item snapshot.`);
  }

  return new Error(
    formatSchemaErrorMessage(label, first.path, first.message, first.schema),
  );
}

function formatSchemaErrorMessage(
  label: string,
  path: string,
  message: string,
  errorSchema?: TSchema,
): string {
  const fieldLabel = formatSchemaErrorPath(label, path);
  if (message === "Expected required property") {
    return `${fieldLabel} ${requiredPropertyMessage(errorSchema)}`;
  }
  if (message === "Expected string") {
    return `${fieldLabel} must be a string.`;
  }
  if (message === "Expected number") {
    return `${fieldLabel} must be a finite number.`;
  }
  if (message === "Expected boolean") {
    return `${fieldLabel} must be a boolean.`;
  }
  if (message === "Expected array") {
    return `${fieldLabel} must be an array.`;
  }
  if (message.startsWith("Expected union")) {
    const values = message.match(/Expected '([^']+)'/g)?.map((part) =>
      part.slice("Expected '".length, -1),
    );
    if (values !== undefined && values.length > 0) {
      return `${fieldLabel} must be one of: ${values.join(", ")}.`;
    }
  }

  return `${fieldLabel}: ${message}`;
}

function requiredPropertyMessage(schema?: TSchema): string {
  const type = schema?.type;
  if (type === "string") {
    return "must be a string.";
  }
  if (type === "number" || type === "integer") {
    return "must be a finite number.";
  }
  if (type === "boolean") {
    return "must be a boolean.";
  }
  if (type === "array") {
    return "must be an array.";
  }
  if (type === "object") {
    return "must be an object.";
  }

  return "is required.";
}

function formatSchemaErrorPath(label: string, path: string): string {
  if (path.length === 0) {
    return label;
  }

  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .reduce((fieldLabel, segment) => {
      if (/^\d+$/.test(segment)) {
        return `${fieldLabel}[${segment}]`;
      }

      return `${fieldLabel}.${segment}`;
    }, label);
}
