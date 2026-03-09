import { z } from "zod";
import type { AuthRecord, JsonObject } from "@/lib/runtime/auth-store";
import type { ParsedAuthRecord } from "./types";

export const optionalMetadataString = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : undefined))
  .catch(undefined)
  .optional();

export function parseOptionalMetadataObject<
  TSchema extends z.ZodObject<z.ZodRawShape>,
>(schema: TSchema, value: unknown): z.output<TSchema> | undefined {
  const result = schema.safeParse(value);
  if (!result.success) return undefined;

  const normalized = Object.fromEntries(
    Object.entries(result.data).filter(([, fieldValue]) => fieldValue !== undefined),
  );
  if (Object.keys(normalized).length === 0) return undefined;
  return normalized as z.output<TSchema>;
}

export function ensureMethodIdentity<
  TMetadata extends JsonObject | undefined = JsonObject | undefined,
>(input: {
  auth: AuthRecord;
  defaultMethodID: string;
  defaultMethodType: "oauth" | "pat" | "apikey";
  metadata?: TMetadata;
}): ParsedAuthRecord<TMetadata> {
  return {
    ...input.auth,
    methodID: input.auth.methodID ?? input.defaultMethodID,
    methodType: input.auth.methodType ?? input.defaultMethodType,
    metadata: input.metadata,
  } as ParsedAuthRecord<TMetadata>;
}
