import * as Either from "effect/Either";
import * as Schema from "effect/Schema";

export const RuntimeEventSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("runtime.providers.changed"),
    payload: Schema.Struct({
      providerIDs: Schema.Array(Schema.String),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime.models.changed"),
    payload: Schema.Struct({
      providerIDs: Schema.Array(Schema.String),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime.auth.changed"),
    payload: Schema.Struct({
      providerID: Schema.String,
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime.authFlow.changed"),
    payload: Schema.Struct({
      providerID: Schema.String,
      status: Schema.String,
      updatedAt: Schema.Number,
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime.origin.changed"),
    payload: Schema.Struct({
      origin: Schema.String,
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime.permissions.changed"),
    payload: Schema.Struct({
      origin: Schema.String,
      modelIds: Schema.Array(Schema.String),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime.pending.changed"),
    payload: Schema.Struct({
      origin: Schema.String,
      requestIds: Schema.Array(Schema.String),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime.catalog.refreshed"),
    payload: Schema.Struct({
      updatedAt: Schema.Number,
    }),
  }),
);

export type RuntimeEvent = Schema.Schema.Type<typeof RuntimeEventSchema>;

const decodeRuntimeEvent = Schema.decodeUnknownEither(RuntimeEventSchema);

export function parseRuntimeEvent(input: unknown): RuntimeEvent | undefined {
  const result = decodeRuntimeEvent(input);
  if (Either.isLeft(result)) {
    return undefined;
  }
  return result.right;
}
