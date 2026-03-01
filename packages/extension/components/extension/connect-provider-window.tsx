import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { ProviderAuthMethodForm } from "@/components/extension/provider-auth-method-form"
import type { ExtensionAuthMethod } from "@/lib/extension-runtime-api"
import {
  useProviderAuthFlowQuery,
  useProviderCancelAuthFlowMutation,
  useProviderStartAuthFlowMutation,
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
  const cancelAuthFlowMutation = useProviderCancelAuthFlowMutation()

  const provider = useMemo(
    () => (providersQuery.data ?? []).find((item) => item.id === providerID),
    [providerID, providersQuery.data],
  )

  const flow = authFlowQuery.data
  const methods = flow?.methods ?? []

  const [selectedMethodID, setSelectedMethodID] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [flowError, setFlowError] = useState<string | null>(null)
  const [successToastShown, setSuccessToastShown] = useState(false)

  const selectedMethod = useMemo(
    () => methods.find((method) => method.id === selectedMethodID),
    [methods, selectedMethodID],
  )

  useEffect(() => {
    if (!selectedMethodID) return
    const exists = methods.some((method) => method.id === selectedMethodID)
    if (!exists) {
      setSelectedMethodID(null)
      setValues({})
    }
  }, [methods, selectedMethodID])

  useEffect(() => {
    if (flow?.status !== "error" && flow?.status !== "canceled") return
    setSelectedMethodID(null)
    setValues({})
  }, [flow?.status])

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
    if (!selectedMethod) {
      setFlowError("Select an authentication method")
      return
    }

    const fields = selectedMethod.fields ?? []
    const validated = normalizeFieldValues(fields, values)
    setFieldErrors(validated.errors)
    if (Object.keys(validated.errors).length > 0) return

    setFlowError(null)
    await startAuthFlowMutation.mutateAsync({
      providerID,
      methodID: selectedMethod.id,
      values: validated.values,
    })
  }

  async function handleCancel() {
    if (!flow) {
      window.close()
      return
    }

    if (flow.status === "authorizing") {
      await cancelAuthFlowMutation.mutateAsync({
        providerID,
        reason: "user",
      })
    }

    window.close()
  }

  const status = flow?.status ?? "idle"
  const isBusy = startAuthFlowMutation.isPending || cancelAuthFlowMutation.isPending

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
            {status === "authorizing"
              ? "Authentication in progress"
              : "Select auth method"}
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

          {status === "authorizing" && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">Finishing authentication...</p>
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

          {status === "success" && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-foreground">
                {provider?.name ?? providerID} connected successfully.
              </p>
              <p className="text-xs text-muted-foreground">Closing window...</p>
            </div>
          )}

          {status !== "authorizing" && status !== "success" && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                {methods.map((method) => (
                  <button
                    key={method.id}
                    onClick={() => {
                      setSelectedMethodID(method.id)
                      setValues(buildInitialValues(method.fields ?? []))
                      setFieldErrors({})
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

              {selectedMethod && (
                <div className="flex flex-col gap-3 border border-border bg-secondary/20 px-3 py-3">
                  <p className="text-xs font-medium text-foreground">{selectedMethod.label}</p>

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
                        setSelectedMethodID(null)
                        setValues({})
                        setFieldErrors({})
                        setFlowError(null)
                      }}
                      disabled={isBusy}
                      className="border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Back
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

              <div className="flex items-center justify-end">
                <button
                  onClick={() => {
                    void handleCancel().catch((error) => {
                      setFlowError(error instanceof Error ? error.message : String(error))
                    })
                  }}
                  disabled={isBusy}
                  className="border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Close
                </button>
              </div>

              {displayError && (
                <p className="text-xs text-destructive">{displayError}</p>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
