import * as Schema from "effect/Schema";
import {
  decodeSchemaOrUndefined,
  decodeSchemaSync,
} from "@/background/runtime/effect-schema";

export function parseOptionalTrimmedString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeProviderOptionsRecord<T extends Record<string, unknown>>(
  value: T,
): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => [
      key,
      typeof fieldValue === "string"
        ? parseOptionalTrimmedString(fieldValue)
        : fieldValue,
    ]),
  ) as T;
}

export function parseProviderOptions<
  TSchema extends Schema.Schema.AnyNoContext,
>(schema: TSchema, value: unknown): Schema.Schema.Type<TSchema> {
  const decoded = decodeSchemaOrUndefined(schema, value);
  if (decoded !== undefined) {
    return normalizeProviderOptionsRecord(
      decoded as Record<string, unknown>,
    ) as Schema.Schema.Type<TSchema>;
  }

  return normalizeProviderOptionsRecord(
    decodeSchemaSync(schema, {}),
  ) as Schema.Schema.Type<TSchema>;
}
