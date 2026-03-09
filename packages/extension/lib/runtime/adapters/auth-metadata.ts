import { z } from "zod";

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
