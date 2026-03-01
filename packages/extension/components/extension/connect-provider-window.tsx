import { useEffect, useMemo, useState } from "react"
import { ExternalLink } from "lucide-react"
import { toast } from "sonner"
import { ProviderAuthMethodForm } from "@/components/extension/provider-auth-method-form"
import type { ExtensionAuthMethod } from "@/lib/extension-runtime-api"
import {
  useProviderAuthFlowQuery,
  useProviderCancelAuthFlowMutation,
  useProviderRetryAuthFlowMutation,
  useProviderStartAuthFlowMutation,
  useProviderSubmitAuthCodeMutation,
  useProvidersQuery,
} from "@/lib/extension-query-hooks"

type AuthField = NonNullable<ExtensionAuthMethod["fields"]>[number]

function shouldRenderField(field: AuthField, values: Record<string, string>) {
  const condition = field.condition
  if (!condition) return true
  return values[condition.key] === condition.equals
}

function normalizeFieldValues(fields: AuthField[], values: Record<string, string>) {
  const normalized: Record<string, string> = {}
  const errors: Record<string, string> = {}

  for (const field of fields) {
    if (!shouldRenderField(field, values)) continue

    const rawValue = values[field.key] ?? ""
    const value = rawValue.trim()
    normalized[field.key] = value

    if (field.required && !value) {
      errors[field.key] = `${field.label} is required`
      continue
    }

    if (!value || !field.validate) continue

    if (typeof field.validate.minLength === "number" && value.length < field.validate.minLength) {
      errors[field.key] = field.validate.message ?? `Must be at least ${field.validate.minLength} characters`
      continue
    }

    if (typeof field.validate.maxLength === "number" && value.length > field.validate.maxLength) {
      errors[field.key] = field.validate.message ?? `Must be no more than ${field.validate.maxLength} characters`
      continue
    }

    if (field.validate.regex) {
      try {
        const expression = new RegExp(field.validate.regex)
        if (!expression.test(value)) {
          errors[field.key] = field.validate.message ?? "Invalid value"
        }
      } catch {
        errors[field.key] = "Invalid validation rule"
      }
    }
  }

  return {
    values: normalized,
    errors,
  }
}

function buildInitialValues(fields: AuthField[]) {
  const next: Record<string, string> = {}
  for (const field of fields) {
    if (field.defaultValue != null) {
      next[field.key] = field.defaultValue
    }
  }
  return next
}

export function ConnectProviderWindow({
  providerID,
}: {
  providerID: string
}) {
  const providersQuery = useProvidersQuery()
  const authFlowQuery = useProviderAuthFlowQuery(providerID)
  const startAuthFlowMutation = useProviderStartAuthFlowMutation()
  const submitAuthCodeMutation = useProviderSubmitAuthCodeMutation()
  const retryAuthFlowMutation = useProviderRetryAuthFlowMutation()
  const cancelAuthFlowMutation = useProviderCancelAuthFlowMutation()

  const provider = useMemo(
    () => (providersQuery.data ?? []).find((item) => item.id === providerID),
    [providerID, providersQuery.data],
  )

  const flow = authFlowQuery.data
  const methods = flow?.methods ?? []

  const [selectedMethodIndex, setSelectedMethodIndex] = useState<number | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [flowError, setFlowError] = useState<string | null>(null)
  const [oauthCode, setOauthCode] = useState("")
  const [successToastShown, setSuccessToastShown] = useState(false)

  const selectedMethod = selectedMethodIndex == null ? undefined : methods[selectedMethodIndex]

  useEffect(() => {
    if (typeof flow?.selectedMethodIndex === "number") {
      setSelectedMethodIndex(flow.selectedMethodIndex)
      return
    }

    setSelectedMethodIndex((current) => {
      if (current != null && current < methods.length) return current
      if (methods.length === 1) return 0
      return null
    })
  }, [flow?.selectedMethodIndex, methods.length])

  useEffect(() => {
    setFieldErrors({})
    setFlowError(null)
    setOauthCode("")

    if (!selectedMethod?.fields) {
      setValues({})
      return
    }

    setValues(buildInitialValues(selectedMethod.fields))
  }, [selectedMethodIndex, selectedMethod?.fields])

  useEffect(() => {
    if (flow?.status !== "success") return

    const timeout = window.setTimeout(() => {
      window.close()
    }, 1200)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [flow?.status])

  useEffect(() => {
    if (!flow) return
    if (flow.status !== "success") {
      setSuccessToastShown(false)
      return
    }
    if (successToastShown) return

    setSuccessToastShown(true)
    toast.success(`${provider?.name ?? providerID} connected`)
  }, [flow, provider?.name, providerID, successToastShown])

  async function handleStart() {
    if (selectedMethodIndex == null || !selectedMethod) return

    const fields = selectedMethod.fields ?? []
    const validated = normalizeFieldValues(fields, values)
    setFieldErrors(validated.errors)
    if (Object.keys(validated.errors).length > 0) return

    setFlowError(null)
    await startAuthFlowMutation.mutateAsync({
      providerID,
      methodIndex: selectedMethodIndex,
      values: validated.values,
    })
  }

  async function handleSubmitCode() {
    const code = oauthCode.trim()
    if (!code) {
      setFlowError("Authorization code is required")
      return
    }
    setFlowError(null)
    await submitAuthCodeMutation.mutateAsync({
      providerID,
      code,
    })
  }

  async function handleRetry() {
    setFlowError(null)
    await retryAuthFlowMutation.mutateAsync({
      providerID,
    })
  }

  async function handleCancel() {
    if (!flow) return

    if (flow.status === "error" || flow.status === "canceled" || flow.status === "success") {
      window.close()
      return
    }

    await cancelAuthFlowMutation.mutateAsync({
      providerID,
      reason: "user",
    })
    window.close()
  }

  const status = flow?.status ?? "idle"
  const hasMethodSelection = methods.length > 1 && selectedMethodIndex == null
  const isBusy = startAuthFlowMutation.isPending
    || submitAuthCodeMutation.isPending
    || retryAuthFlowMutation.isPending
    || cancelAuthFlowMutation.isPending

  const displayError = flowError
    ?? (status === "error" || status === "canceled" ? flow?.error : null)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-4">
        <header className="border border-border bg-card px-4 py-3">
          <h1 className="text-sm font-semibold">
            Connect {provider?.name ?? providerID}
          </h1>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            {status === "awaiting_input" || status === "idle"
              ? (hasMethodSelection ? "Select auth method" : selectedMethod?.label ?? "Authentication")
              : "Authentication in progress"}
          </p>
        </header>

        <main className="border border-border bg-card px-4 py-3">
          {(providersQuery.isPending || authFlowQuery.isPending) && (
            <p className="text-xs text-muted-foreground">Loading authentication flow...</p>
          )}

          {authFlowQuery.isError && (
            <p className="text-xs text-destructive">Failed to load authentication flow.</p>
          )}

          {!authFlowQuery.isPending && !authFlowQuery.isError && methods.length === 0 && (
            <p className="text-xs text-muted-foreground">No auth methods are available for this provider.</p>
          )}

          {(status === "awaiting_input" || status === "idle") && hasMethodSelection && (
            <div className="flex flex-col gap-2">
              {methods.map((method, index) => (
                <button
                  key={`${method.type}:${method.label}:${index}`}
                  onClick={() => {
                    setSelectedMethodIndex(index)
                    setFlowError(null)
                  }}
                  className="flex items-center justify-between border border-border px-3 py-2 text-left transition-colors hover:bg-secondary/40"
                >
                  <span className="text-xs font-medium text-foreground">{method.label}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {method.type}
                  </span>
                </button>
              ))}
            </div>
          )}

          {(status === "awaiting_input" || status === "idle") && !hasMethodSelection && selectedMethod && (
            <div className="flex flex-col gap-3">
              {selectedMethod.fields && selectedMethod.fields.length > 0 && (
                <ProviderAuthMethodForm
                  fields={selectedMethod.fields}
                  values={values}
                  errors={fieldErrors}
                  disabled={isBusy}
                  onChange={(key, value) => {
                    setValues((previous) => ({
                      ...previous,
                      [key]: value,
                    }))
                    setFieldErrors((previous) => ({
                      ...previous,
                      [key]: "",
                    }))
                  }}
                />
              )}

              <div className="mt-1 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    void handleCancel().catch((error) => {
                      setFlowError(error instanceof Error ? error.message : String(error))
                    })
                  }}
                  disabled={isBusy}
                  className="border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleStart().catch((error) => {
                      setFlowError(error instanceof Error ? error.message : String(error))
                    })
                  }}
                  disabled={isBusy}
                  className="bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {startAuthFlowMutation.isPending ? "Starting..." : "Continue"}
                </button>
              </div>
            </div>
          )}

          {(status === "awaiting_external" || status === "running" || status === "awaiting_code") && flow?.authorization && (
            <div className="mb-3 flex flex-col gap-2 border border-border bg-secondary/20 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-foreground">Authorization in progress</span>
                <a
                  href={flow.authorization.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-primary hover:underline"
                >
                  Open
                  <ExternalLink className="size-3" />
                </a>
              </div>
              {flow.authorization.instructions && (
                <p className="text-xs text-muted-foreground">{flow.authorization.instructions}</p>
              )}
            </div>
          )}

          {status === "awaiting_external" && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                Complete the authorization steps in your browser and this window will update automatically.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    void handleCancel().catch((error) => {
                      setFlowError(error instanceof Error ? error.message : String(error))
                    })
                  }}
                  disabled={isBusy}
                  className="border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {status === "awaiting_code" && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-foreground">Authorization code</span>
                <input
                  value={oauthCode}
                  onChange={(event) => {
                    setOauthCode(event.currentTarget.value)
                  }}
                  placeholder="Paste code"
                  autoComplete="off"
                  disabled={isBusy}
                  className="h-8 w-full rounded-none border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    void handleCancel().catch((error) => {
                      setFlowError(error instanceof Error ? error.message : String(error))
                    })
                  }}
                  disabled={isBusy}
                  className="border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleSubmitCode().catch((error) => {
                      setFlowError(error instanceof Error ? error.message : String(error))
                    })
                  }}
                  disabled={isBusy}
                  className="bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitAuthCodeMutation.isPending ? "Finishing..." : "Finish"}
                </button>
              </div>
            </div>
          )}

          {status === "running" && (
            <p className="text-xs text-muted-foreground">Finishing authentication...</p>
          )}

          {status === "success" && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-foreground">
                {provider?.name ?? providerID} connected successfully.
              </p>
              <p className="text-xs text-muted-foreground">Closing window...</p>
            </div>
          )}

          {(status === "error" || status === "canceled") && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-destructive">
                {displayError ?? "Authentication failed."}
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    void handleCancel().catch((error) => {
                      setFlowError(error instanceof Error ? error.message : String(error))
                    })
                  }}
                  disabled={isBusy}
                  className="border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleRetry().catch((error) => {
                      setFlowError(error instanceof Error ? error.message : String(error))
                    })
                  }}
                  disabled={isBusy}
                  className="bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {displayError && status !== "error" && status !== "canceled" && (
            <p className="mt-3 text-xs text-destructive">{displayError}</p>
          )}
        </main>
      </div>
    </div>
  )
}
