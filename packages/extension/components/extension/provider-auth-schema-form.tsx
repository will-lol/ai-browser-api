import { useForm } from "@tanstack/react-form";
import type { ReactNode } from "react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import type { ExtensionResolvedAuthMethod } from "@/lib/extension-auth-methods";
import type { AuthField } from "@/lib/runtime/adapters/types";

type AuthFormValues = Record<string, string>;

interface ProviderAuthSchemaFormProps {
  method: ExtensionResolvedAuthMethod;
  disabled?: boolean;
  error?: string | null;
  submitLabel?: string;
  onBack: () => void;
  onSubmit: (values: AuthFormValues) => Promise<void> | void;
}

function shouldRenderField(field: AuthField, values: AuthFormValues) {
  const condition = field.condition;
  if (!condition) return true;
  return values[condition.key] === condition.equals;
}

function buildInitialValues(fields: ReadonlyArray<AuthField>) {
  const next: AuthFormValues = {};
  for (const field of fields) {
    next[field.key] = field.defaultValue ?? "";
  }
  return next;
}

function pickVisibleValues(
  fields: ReadonlyArray<AuthField>,
  values: AuthFormValues,
) {
  const next: AuthFormValues = {};

  for (const field of fields) {
    if (!shouldRenderField(field, values)) continue;
    next[field.key] = values[field.key] ?? "";
  }

  return next;
}

function firstErrorMessage(errors: ReadonlyArray<unknown>) {
  for (const error of errors) {
    if (typeof error === "string" && error.length > 0) return error;
    if (error instanceof Error && error.message) return error.message;
  }

  return undefined;
}

function renderInput(input: {
  field: AuthField;
  value: string;
  disabled: boolean;
  onBlur: () => void;
  onChange: (value: string) => void;
}) {
  if (input.field.type === "select") {
    return (
      <select
        value={input.value}
        onBlur={input.onBlur}
        onChange={(event) => {
          input.onChange(event.currentTarget.value);
        }}
        disabled={input.disabled}
        className="h-8 w-full rounded-none border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
      >
        {!input.field.required && (
          <option value="">
            {input.field.placeholder ?? "Select an option"}
          </option>
        )}
        {input.field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={input.field.type === "secret" ? "password" : "text"}
      value={input.value}
      placeholder={input.field.placeholder}
      onBlur={input.onBlur}
      onChange={(event) => {
        input.onChange(event.currentTarget.value);
      }}
      autoComplete="off"
      disabled={input.disabled}
      className="h-8 w-full rounded-none border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}

function parseValues(
  schema: z.ZodType<AuthFormValues> | undefined,
  values: AuthFormValues,
) {
  if (!schema) return values;
  return schema.parse(values);
}

function FieldBlock(input: {
  label: string;
  required?: boolean;
  description?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-foreground">
        {input.label}
        {input.required ? " *" : ""}
      </span>
      {input.children}
      {input.description && (
        <span className="text-[10px] leading-relaxed text-muted-foreground">
          {input.description}
        </span>
      )}
      {input.error && (
        <span className="text-[10px] text-destructive">{input.error}</span>
      )}
    </label>
  );
}

export function ProviderAuthSchemaForm({
  method,
  disabled = false,
  error,
  submitLabel = "Continue",
  onBack,
  onSubmit,
}: ProviderAuthSchemaFormProps) {
  const form = useForm({
    defaultValues: buildInitialValues(method.fields),
    validators: method.inputSchema
      ? {
          onChange: method.inputSchema as never,
          onSubmit: method.inputSchema as never,
        }
      : undefined,
    onSubmit: async ({ value }) => {
      const visibleValues = pickVisibleValues(method.fields, value);
      const parsed = parseValues(method.inputSchema, visibleValues);
      await onSubmit(parsed);
    },
  });

  return (
    <form
      className="mt-2 flex flex-col gap-4 bg-secondary/20 px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p className="text-xs font-medium text-foreground">{method.label}</p>

      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <>
            {method.fields.length > 0 && (
              <div className="flex flex-col gap-3">
                {method.fields.map((field) => {
                  if (!shouldRenderField(field, values)) return null;

                  return (
                    <form.Field
                      key={field.key}
                      name={field.key}
                    >
                      {(fieldApi) => (
                        <FieldBlock
                          label={field.label}
                          required={field.required}
                          description={field.description}
                          error={firstErrorMessage(fieldApi.state.meta.errors)}
                        >
                          {renderInput({
                            field,
                            value:
                              typeof fieldApi.state.value === "string"
                                ? fieldApi.state.value
                                : "",
                            disabled,
                            onBlur: fieldApi.handleBlur,
                            onChange: (value) => {
                              fieldApi.handleChange(value);
                            },
                          })}
                        </FieldBlock>
                      )}
                    </form.Field>
                  );
                })}
              </div>
            )}
          </>
        )}
      </form.Subscribe>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="mt-2 flex items-center justify-end gap-2">
        <Button
          type="button"
          onClick={onBack}
          disabled={disabled}
          variant="ghost"
        >
          Back
        </Button>
        <Button type="submit" disabled={disabled}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
