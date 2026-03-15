import * as Schema from "effect/Schema";
import { decodeSchemaOrUndefined } from "@/background/runtime/core/effect-schema";

export function parseOptionalMetadataString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalMetadataRecord(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, fieldValue]) => [
        key,
        typeof fieldValue === "string"
          ? parseOptionalMetadataString(fieldValue)
          : fieldValue,
      ])
      .filter(([, fieldValue]) => fieldValue !== undefined),
  );
}

export function parseOptionalMetadataObject<
  TSchema extends Schema.Schema.AnyNoContext,
>(schema: TSchema, value: unknown): Schema.Schema.Type<TSchema> | undefined {
  const decoded = decodeSchemaOrUndefined(schema, value);
  if (!decoded) {
    return undefined;
  }

  const normalized = normalizeOptionalMetadataRecord(
    decoded as Record<string, unknown>,
  );

  if (Object.keys(normalized).length === 0) {
    return undefined;
  }

  return normalized as Schema.Schema.Type<TSchema>;
}

export function shallowEqualMetadata(
  left?: Record<string, unknown>,
  right?: Record<string, unknown>,
) {
  const leftEntries = Object.entries(
    normalizeOptionalMetadataRecord(left ?? {}),
  ).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(
    normalizeOptionalMetadataRecord(right ?? {}),
  ).sort(([a], [b]) => a.localeCompare(b));

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  for (let index = 0; index < leftEntries.length; index += 1) {
    const [leftKey, leftValue] = leftEntries[index] ?? [];
    const [rightKey, rightValue] = rightEntries[index] ?? [];
    if (leftKey !== rightKey) {
      return false;
    }
    if (leftValue !== rightValue) {
      return false;
    }
  }

  return true;
}
