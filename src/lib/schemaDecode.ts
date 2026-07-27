import { Kind, TypeRegistry } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const SAFE_INTEGER_KIND = "SafeInteger";

TypeRegistry.Set(SAFE_INTEGER_KIND, (schema: TSchema, value) => {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !Number.isSafeInteger(value)
  ) {
    return false;
  }

  const minimum = readNumericConstraint(schema, "minimum");
  if (minimum !== undefined && value < minimum) {
    return false;
  }

  const maximum = readNumericConstraint(schema, "maximum");
  if (maximum !== undefined && value > maximum) {
    return false;
  }

  return true;
});

export function SafeInteger(options?: { maximum?: number; minimum?: number }) {
  return Type.Unsafe<number>({
    [Kind]: SAFE_INTEGER_KIND,
    type: "integer",
    ...options,
  });
}

export const PositiveSafeInteger = SafeInteger({ minimum: 1 });
export const NonNegativeSafeInteger = SafeInteger({ minimum: 0 });

export function decodeSchema<T>(
  schema: TSchema,
  snapshot: unknown,
  label: string,
): T {
  if (!Value.Check(schema, snapshot)) {
    throw formatSchemaValidationError(label, schema, snapshot);
  }

  return Value.Decode(schema, snapshot) as T;
}

export function formatSchemaValidationError(
  label: string,
  schema: TSchema,
  snapshot: unknown,
): Error {
  const errors = [...Value.Errors(schema, snapshot)];
  const first = pickSchemaError(errors);
  if (first === undefined) {
    return new Error(`${label}: invalid snapshot.`);
  }

  return new Error(
    formatSchemaErrorMessage(label, first.path, first.message, first.schema),
  );
}

function pickSchemaError(
  errors: Iterable<{
    message: string;
    path: string;
    schema: TSchema;
  }>,
) {
  const collected = [...errors];
  return (
    collected.find(
      (error) =>
        error.path.length > 0 &&
        error.message !== "Expected union value" &&
        error.message !== "Expected required property",
    ) ??
    collected.find((error) => error.path.length > 0) ??
    collected[0]
  );
}

export function formatSchemaErrorMessage(
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
  if (message === "Expected integer") {
    return integerConstraintMessage(fieldLabel, errorSchema);
  }
  if (message === `Expected kind '${SAFE_INTEGER_KIND}'`) {
    return integerConstraintMessage(fieldLabel, errorSchema);
  }
  if (message.startsWith("Expected integer to be greater or equal to")) {
    const minimum = Number(message.match(/equal to (\d+)/)?.[1]);
    if (minimum === 1) {
      return `${fieldLabel} must be a positive safe integer.`;
    }
    if (minimum === 0) {
      return `${fieldLabel} must be a non-negative safe integer.`;
    }
  }
  if (message.startsWith("Expected integer to be less or equal to")) {
    return `${fieldLabel} must be an integer.`;
  }
  if (message === "Expected boolean") {
    return `${fieldLabel} must be a boolean.`;
  }
  if (message === "Expected array") {
    return `${fieldLabel} must be an array.`;
  }
  if (message.startsWith("Expected union")) {
    const values = message
      .match(/Expected '([^']+)'/g)
      ?.map((part) => part.slice("Expected '".length, -1));
    if (values !== undefined && values.length > 0) {
      return `${fieldLabel} must be one of: ${values.join(", ")}.`;
    }
  }

  return `${fieldLabel}: ${message}`;
}

function integerConstraintMessage(
  fieldLabel: string,
  schema?: TSchema,
): string {
  const minimum = readNumericConstraint(schema, "minimum");
  if (minimum === 1) {
    return `${fieldLabel} must be a positive safe integer.`;
  }
  if (minimum === 0) {
    return `${fieldLabel} must be a non-negative safe integer.`;
  }

  return `${fieldLabel} must be an integer.`;
}

function readNumericConstraint(
  schema: TSchema | undefined,
  key: "minimum" | "maximum",
): number | undefined {
  if (schema === undefined || !("const" in schema)) {
    const value = (schema as { [key: string]: unknown } | undefined)?.[key];
    return typeof value === "number" ? value : undefined;
  }

  return undefined;
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

export function formatSchemaErrorPath(label: string, path: string): string {
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
