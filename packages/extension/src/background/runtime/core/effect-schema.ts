import * as Either from "effect/Either";
import * as Schema from "effect/Schema";

function decodeSchemaEither<S extends Schema.Schema.AnyNoContext>(
  schema: S,
  value: unknown,
) {
  return Schema.decodeUnknownEither(schema)(value);
}

export function decodeSchemaOrUndefined<S extends Schema.Schema.AnyNoContext>(
  schema: S,
  value: unknown,
): Schema.Schema.Type<S> | undefined {
  const decoded = decodeSchemaEither(schema, value);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

export function decodeSchemaSync<S extends Schema.Schema.AnyNoContext>(
  schema: S,
  value: unknown,
): Schema.Schema.Type<S> {
  return Schema.decodeUnknownSync(schema)(value);
}

export function decodeSchemaOrThrow<S extends Schema.Schema.AnyNoContext>(
  schema: S,
  value: unknown,
  message?: string,
): Schema.Schema.Type<S> {
  const decoded = decodeSchemaOrUndefined(schema, value);
  if (decoded !== undefined) {
    return decoded;
  }

  throw new Error(message ?? "Schema decode failed.");
}
