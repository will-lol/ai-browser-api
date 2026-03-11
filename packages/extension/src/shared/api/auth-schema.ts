import { RuntimeValidationError } from "@llm-bridge/contracts";
import * as Either from "effect/Either";
import * as Schema from "effect/Schema";
import * as ParseResult from "effect/ParseResult";

type AuthFieldCondition = {
  key: string;
  equals: string;
};

type AuthFieldValidation = {
  regex?: string;
  message?: string;
  minLength?: number;
  maxLength?: number;
};

type AuthFieldBase = {
  key: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  description?: string;
  condition?: AuthFieldCondition;
  validate?: AuthFieldValidation;
};

type AuthFieldOption = {
  label: string;
  value: string;
  hint?: string;
};

export type AuthField =
  | ({
      type: "text" | "secret";
    } & AuthFieldBase)
  | ({
      type: "select";
      options: ReadonlyArray<AuthFieldOption>;
    } & AuthFieldBase);

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

function formatSchemaError(error: ParseResult.ParseError) {
  const issues = ParseResult.ArrayFormatter.formatErrorSync(error);
  return issues[0]?.message ?? error.message;
}

function formatSchemaFieldErrors(error: ParseResult.ParseError) {
  const fieldErrors: Record<string, string> = {};

  for (const issue of ParseResult.ArrayFormatter.formatErrorSync(error)) {
    const path = issue.path.map((segment) => String(segment)).join(".");

    if (path.length === 0 || path in fieldErrors) {
      continue;
    }

    fieldErrors[path] = issue.message;
  }

  return fieldErrors;
}

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

function normalizeAuthMethodValues(
  fields: ReadonlyArray<AuthField>,
  values: Record<string, string>,
) {
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
  method: { inputSchema?: Schema.Schema.AnyNoContext },
  values: Record<string, string>,
) {
  if (!method.inputSchema) {
    return {};
  }

  const result = Schema.decodeUnknownEither(method.inputSchema)(
    normalizeAuthMethodValues(getAuthSchemaFields(method.inputSchema), values),
  );
  if (Either.isRight(result)) {
    return result.right;
  }

  throw new RuntimeValidationError({
    message: formatSchemaError(result.left),
  });
}

export function validateAuthMethodValues(
  method: {
    inputSchema?: Schema.Schema.AnyNoContext;
    fields?: ReadonlyArray<AuthField>;
  },
  values: Record<string, string>,
) {
  if (method.inputSchema) {
    const result = Schema.decodeUnknownEither(method.inputSchema)(
      normalizeAuthMethodValues(getAuthSchemaFields(method.inputSchema), values),
    );
    if (Either.isRight(result)) {
      return {};
    }

    return formatSchemaFieldErrors(result.left);
  }

  const fieldErrors: Record<string, string> = {};

  for (const field of method.fields ?? []) {
    if (field.condition && values[field.condition.key] !== field.condition.equals) {
      continue;
    }

    const value = values[field.key] ?? "";
    if (field.required && value.trim().length === 0) {
      fieldErrors[field.key] = `${field.label} is required`;
      continue;
    }

    if (
      field.type === "select" &&
      value.length > 0 &&
      !field.options.some((option) => option.value === value)
    ) {
      fieldErrors[field.key] = `${field.label} is invalid`;
    }
  }

  return fieldErrors;
}
