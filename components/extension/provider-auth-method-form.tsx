import type { ExtensionAuthMethod } from "@/lib/extension-runtime-api"

type AuthField = NonNullable<ExtensionAuthMethod["fields"]>[number]

function shouldRenderField(field: AuthField, values: Record<string, string>) {
  const condition = field.condition
  if (!condition) return true
  return values[condition.key] === condition.equals
}

interface ProviderAuthMethodFormProps {
  fields: AuthField[]
  values: Record<string, string>
  errors?: Record<string, string>
  disabled?: boolean
  onChange: (key: string, value: string) => void
}

export function ProviderAuthMethodForm({
  fields,
  values,
  errors = {},
  disabled = false,
  onChange,
}: ProviderAuthMethodFormProps) {
  if (fields.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {fields.map((field) => {
        if (!shouldRenderField(field, values)) return null

        const value = values[field.key] ?? field.defaultValue ?? ""
        const error = errors[field.key]

        return (
          <label
            key={field.key}
            className="flex flex-col gap-1"
          >
            <span className="text-[11px] font-medium text-foreground">
              {field.label}
              {field.required ? " *" : ""}
            </span>

            {field.type === "select" ? (
              <select
                value={value}
                onChange={(event) => {
                  onChange(field.key, event.currentTarget.value)
                }}
                disabled={disabled}
                className="h-8 w-full rounded-none border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {!field.required && (
                  <option value="">
                    {field.placeholder ?? "Select an option"}
                  </option>
                )}
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.type === "secret" ? "password" : "text"}
                value={value}
                placeholder={field.placeholder}
                onChange={(event) => {
                  onChange(field.key, event.currentTarget.value)
                }}
                autoComplete="off"
                disabled={disabled}
                className="h-8 w-full rounded-none border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
              />
            )}

            {field.description && (
              <span className="text-[10px] leading-relaxed text-muted-foreground">
                {field.description}
              </span>
            )}
            {error && (
              <span className="text-[10px] text-destructive">
                {error}
              </span>
            )}
          </label>
        )
      })}
    </div>
  )
}
