import * as Schema from "effect/Schema"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | ReadonlyArray<JsonValue> | { readonly [key: string]: JsonValue }

export const JsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.Null,
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Array(JsonValueSchema),
    Schema.Record({
      key: Schema.String,
      value: JsonValueSchema,
    }),
  ),
)

export const JsonObjectSchema: Schema.Schema<{ readonly [key: string]: JsonValue }> = Schema.Record({
  key: Schema.String,
  value: JsonValueSchema,
})
