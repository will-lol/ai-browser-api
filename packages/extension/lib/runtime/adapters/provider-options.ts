import * as Either from "effect/Either";
import * as Schema from "effect/Schema";

const stringRecordSchema = Schema.Record({
  key: Schema.String,
  value: Schema.String,
});

export function parseOptionalTrimmedString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseOptionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

export function parseOptionalNumber(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

export function parseOptionalStringRecord(value: unknown) {
  const decoded = Schema.decodeUnknownEither(stringRecordSchema)(value);
  return Either.isRight(decoded) ? decoded.right : undefined;
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
  const decoded = Schema.decodeUnknownEither(schema)(value);
  if (Either.isRight(decoded)) {
    return normalizeProviderOptionsRecord(
      decoded.right as Record<string, unknown>,
    ) as Schema.Schema.Type<TSchema>;
  }

  return normalizeProviderOptionsRecord(
    Schema.decodeUnknownSync(schema)({}),
  ) as Schema.Schema.Type<TSchema>;
}
