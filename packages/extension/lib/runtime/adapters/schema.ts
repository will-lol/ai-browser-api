import { RuntimeValidationError } from "@llm-bridge/contracts";
import { z } from "zod";
import type { AuthField, AuthMethodDefinition, RuntimeAuthMethod } from "./types";

const AUTH_FIELD_METADATA = Symbol.for("llm-bridge.auth-fields");

type AuthFieldTemplate = Omit<AuthField, "key">;

type AuthFieldDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
  schema: TSchema;
  ui: AuthFieldTemplate;
};

type AuthSchemaShape = Record<string, AuthFieldDefinition>;

type SchemaWithAuthFields = z.ZodTypeAny & {
  [AUTH_FIELD_METADATA]?: AuthField[];
};

export function defineAuthSchema<TShape extends AuthSchemaShape>(shape: TShape) {
  const schemaShape: Record<string, z.ZodTypeAny> = {};
  const fields: AuthField[] = [];

  for (const [key, definition] of Object.entries(shape)) {
    schemaShape[key] = definition.schema;
    fields.push({
      ...definition.ui,
      key,
    } as AuthField);
  }

  const schema = z.object(schemaShape) as z.ZodObject<{
    [K in keyof TShape]: TShape[K]["schema"];
  }>;

  Object.defineProperty(schema, AUTH_FIELD_METADATA, {
    value: fields,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return schema;
}

export function serializeAuthSchema(
  schema?: z.ZodTypeAny,
): RuntimeAuthMethod["fields"] {
  if (!schema) return undefined;
  const fields = (schema as SchemaWithAuthFields)[AUTH_FIELD_METADATA];
  if (!fields || fields.length === 0) return undefined;
  return fields.map((field) => ({
    ...field,
    options:
      field.type === "select" ? field.options.map((option) => ({ ...option })) : undefined,
  })) as RuntimeAuthMethod["fields"];
}

export function toRuntimeAuthMethod(
  method: AuthMethodDefinition,
): RuntimeAuthMethod {
  return {
    id: method.id.trim(),
    type: method.type,
    label: method.label.trim() || method.id.trim(),
    fields: serializeAuthSchema(method.inputSchema),
  };
}

export function parseAuthMethodValues(
  method: AuthMethodDefinition,
  values: Record<string, string>,
) {
  if (!method.inputSchema) {
    return {} as Record<string, string>;
  }

  const result = method.inputSchema.safeParse(values);
  if (result.success) {
    return result.data;
  }

  const issue = result.error.issues[0];
  throw new RuntimeValidationError({
    message: issue?.message ?? "Authentication input is invalid",
  });
}
