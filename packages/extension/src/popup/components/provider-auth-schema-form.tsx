import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/shared/ui/button";
import type { ExtensionResolvedAuthMethod } from "@/shared/api/auth-methods";
import {
  validateAuthMethodValues,
  type AuthField,
} from "@/shared/api/auth-schema";

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
  const [values, setValues] = useState<AuthFormValues>(() =>
    buildInitialValues(method.fields),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setValues(buildInitialValues(method.fields));
    setFieldErrors({});
    setSubmitted(false);
  }, [method]);

  const visibleValues = useMemo(
    () => pickVisibleValues(method.fields, values),
    [method.fields, values],
  );

  const refreshErrors = (nextValues: AuthFormValues) => {
    if (!submitted) {
      return;
    }

    setFieldErrors(
      validateAuthMethodValues(
        method,
        pickVisibleValues(method.fields, nextValues),
      ),
    );
  };

  const handleSubmit = async () => {
    const nextErrors = validateAuthMethodValues(method, visibleValues);
    setSubmitted(true);
    setFieldErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    await onSubmit(visibleValues);
  };

  return (
    <form
      className="mt-2 flex flex-col gap-4 bg-secondary/20 px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <p className="text-xs font-medium text-foreground">{method.label}</p>

      {method.fields.length > 0 && (
        <div className="flex flex-col gap-3">
          {method.fields.map((field) => {
            if (!shouldRenderField(field, values)) return null;

            return (
              <FieldBlock
                key={field.key}
                label={field.label}
                required={field.required}
                description={field.description}
                error={firstErrorMessage([fieldErrors[field.key]])}
              >
                {renderInput({
                  field,
                  value: values[field.key] ?? "",
                  disabled,
                  onBlur: () => undefined,
                  onChange: (value) => {
                    const nextValues = {
                      ...values,
                      [field.key]: value,
                    };
                    setValues(nextValues);
                    refreshErrors(nextValues);
                  },
                })}
              </FieldBlock>
            );
          })}
        </div>
      )}

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
