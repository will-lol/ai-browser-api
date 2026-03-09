import { z } from "zod";

export type AuthMethodType = "oauth" | "pat" | "apikey";

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = {
  [key: string]: JsonValue;
};

const authMethodTypeSchema = z.enum(["oauth", "pat", "apikey"]);

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const jsonObjectSchema: z.ZodType<JsonObject> = z.record(
  z.string(),
  jsonValueSchema,
);

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

const authRecordBaseSchema = z.object({
  methodID: z.string(),
  methodType: authMethodTypeSchema,
  metadata: jsonObjectSchema.optional(),
});

export const authRecordSchema: z.ZodType<AuthRecord> = z.union([
  authRecordBaseSchema.extend({
    type: z.literal("api"),
    key: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
  authRecordBaseSchema.extend({
    type: z.literal("oauth"),
    access: z.string(),
    refresh: z.string().optional(),
    expiresAt: z.number().optional(),
    accountId: z.string().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
]);

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
