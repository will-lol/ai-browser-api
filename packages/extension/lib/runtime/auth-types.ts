import * as Schema from "effect/Schema";
import {
  JsonObjectSchema,
  type JsonValue as ContractJsonValue,
} from "@llm-bridge/contracts";

export type AuthMethodType = "oauth" | "pat" | "apikey";

type JsonValue = ContractJsonValue;
type JsonObject = {
  readonly [key: string]: JsonValue;
};

const authMethodTypeSchema = Schema.Literal("oauth", "pat", "apikey");

export type AuthRecord<TMetadata extends JsonObject | undefined = JsonObject | undefined> =
  | {
      type: "api";
      key: string;
      methodID: string;
      methodType: AuthMethodType;
      metadata?: TMetadata;
      createdAt: number;
      updatedAt: number;
    }
  | {
      type: "oauth";
      access: string;
      refresh?: string;
      expiresAt?: number;
      accountId?: string;
      methodID: string;
      methodType: AuthMethodType;
      metadata?: TMetadata;
      createdAt: number;
      updatedAt: number;
    };

const authRecordBaseSchema = Schema.Struct({
  methodID: Schema.String,
  methodType: authMethodTypeSchema,
  metadata: Schema.optional(JsonObjectSchema),
});

export const authRecordSchema = Schema.Union(
  Schema.Struct({
    ...authRecordBaseSchema.fields,
    type: Schema.Literal("api"),
    key: Schema.String,
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
  }),
  Schema.Struct({
    ...authRecordBaseSchema.fields,
    type: Schema.Literal("oauth"),
    access: Schema.String,
    refresh: Schema.optional(Schema.String),
    expiresAt: Schema.optional(Schema.Number),
    accountId: Schema.optional(Schema.String),
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
  }),
);

export type AuthResult<TMetadata extends JsonObject | undefined = JsonObject | undefined> =
  | {
      type: "api";
      key: string;
      methodID: string;
      methodType: AuthMethodType;
      metadata?: TMetadata;
    }
  | {
      type: "oauth";
      access: string;
      refresh?: string;
      expiresAt?: number;
      accountId?: string;
      methodID: string;
      methodType: AuthMethodType;
      metadata?: TMetadata;
    };
