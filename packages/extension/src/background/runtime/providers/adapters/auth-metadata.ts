import * as Schema from "effect/Schema";
import { decodeSchemaOrUndefined } from "@/background/runtime/core/effect-schema";

function parseOptionalMetadataString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseOptionalMetadataObject<
  TSchema extends Schema.Schema.AnyNoContext,
>(schema: TSchema, value: unknown): Schema.Schema.Type<TSchema> | undefined {
  const decoded = decodeSchemaOrUndefined(schema, value);
  if (!decoded) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(decoded as Record<string, unknown>)
      .map(([key, fieldValue]) => [
        key,
        typeof fieldValue === "string"
          ? parseOptionalMetadataString(fieldValue)
          : fieldValue,
      ])
      .filter(([, fieldValue]) => fieldValue !== undefined),
  );

  if (Object.keys(normalized).length === 0) {
    return undefined;
  }

  return normalized as Schema.Schema.Type<TSchema>;
}
