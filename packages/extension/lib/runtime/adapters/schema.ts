import { RuntimeValidationError } from "@llm-bridge/contracts";
import * as Either from "effect/Either";
import * as Schema from "effect/Schema";
import type {
  AuthField,
  AuthMethodDefinition,
  RuntimeAuthMethod,
} from "./types";
import {
  formatSchemaError,
  formatSchemaFieldErrors,
} from "@/lib/runtime/effect-schema";

const AUTH_FIELD_METADATA = Symbol.for("llm-bridge.auth-fields");

type AuthFieldTemplate = {
  type: AuthField["type"];
  label: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  description?: string;
  condition?: {
    key: string;
    equals: string;
  };
  options?: Array<{
    label: string;
    value: string;
    hint?: string;
  }>;
};

type AuthFieldDefinition<
  TSchema extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
> = {
  schema: TSchema;
  ui: AuthFieldTemplate;
};

type AuthSchemaShape = Record<string, AuthFieldDefinition>;

type SchemaWithAuthFields = Schema.Schema.AnyNoContext & {
  [AUTH_FIELD_METADATA]?: AuthField[];
};

export function defineAuthSchema<TShape extends AuthSchemaShape>(
  shape: TShape,
) {
  const schemaShape: Record<string, Schema.Schema.AnyNoContext> = {};
  const fields: AuthField[] = [];

  for (const [key, definition] of Object.entries(shape)) {
    schemaShape[key] = definition.schema;
    fields.push({
      ...definition.ui,
      key,
    } as AuthField);
  }

  const schema = Schema.Struct(
    Object.fromEntries(
      Object.entries(schemaShape).map(([key, value]) => [key, value]),
    ),
  );

  Object.defineProperty(schema, AUTH_FIELD_METADATA, {
    value: fields,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return schema;
}

export function getAuthSchemaFields(
  schema?: Schema.Schema.AnyNoContext,
): ReadonlyArray<AuthField> {
  if (!schema) return [];

  const fields = (schema as SchemaWithAuthFields)[AUTH_FIELD_METADATA];
  if (!fields || fields.length === 0) return [];

  return fields.map((field) => ({
    ...field,
    options:
      field.type === "select"
        ? field.options.map((option) => ({ ...option }))
        : undefined,
  })) as AuthField[];
}

export function toRuntimeAuthMethod(
  method: AuthMethodDefinition,
): RuntimeAuthMethod {
  return {
    id: method.id.trim(),
    type: method.type,
    label: method.label.trim() || method.id.trim(),
  };
}

function normalizeAuthMethodValues(
  schema: Schema.Schema.AnyNoContext,
  values: Record<string, string>,
) {
  const fields = getAuthSchemaFields(schema);

  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const field = fields.find((current) => current.key === key);
      if (!field) {
        return [key, value];
      }

      if (!field.required && value.trim().length === 0) {
        return [key, undefined];
      }

      return [key, value];
    }),
  );
}

export function parseAuthMethodValues(
  method: Pick<AuthMethodDefinition, "inputSchema">,
  values: Record<string, string>,
) {
  if (!method.inputSchema) {
    return {};
  }

  const result = Schema.decodeUnknownEither(method.inputSchema)(
    normalizeAuthMethodValues(method.inputSchema, values),
  );
  if (Either.isRight(result)) {
    return result.right;
  }

  throw new RuntimeValidationError({
    message: formatSchemaError(result.left),
  });
}

export function validateAuthMethodValues(
  method: Pick<AuthMethodDefinition, "inputSchema">,
  values: Record<string, string>,
) {
  if (!method.inputSchema) {
    return {};
  }

  const result = Schema.decodeUnknownEither(method.inputSchema)(
    normalizeAuthMethodValues(method.inputSchema, values),
  );
  if (Either.isRight(result)) {
    return {};
  }

  return formatSchemaFieldErrors(result.left);
}
