import { z } from "zod";

const nonEmptyTrimmedStringSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z.string().min(1),
);

export const optionalTrimmedStringSchema =
  nonEmptyTrimmedStringSchema.optional().catch(undefined);

export const optionalBooleanSchema = z.boolean().optional().catch(undefined);

export const optionalNumberSchema = z.number().optional().catch(undefined);

export const optionalStringRecordSchema = z
  .record(z.string(), z.string())
  .optional()
  .catch(undefined);

export function parseProviderOptions<
  TSchema extends z.ZodObject<z.ZodRawShape>,
>(schema: TSchema, value: unknown): z.output<TSchema> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  return schema.parse({});
}
