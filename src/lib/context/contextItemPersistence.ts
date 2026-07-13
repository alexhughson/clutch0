import type { PersistentContextItem } from "./contextItemTypes";
import { decodeSchema } from "../schemaDecode";
import {
  persistentContextItemSchemas,
  type PersistentContextItemType,
} from "./contextItemSchemas";

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
