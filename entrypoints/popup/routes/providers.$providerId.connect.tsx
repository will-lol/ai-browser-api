import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, ExternalLink } from "lucide-react"
import { browser } from "@wxt-dev/browser"
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { toast } from "sonner"
import { PopupNav } from "@/components/extension/popup-nav"
import { ProviderAuthMethodForm } from "@/components/extension/provider-auth-method-form"
import type { ExtensionAuthMethod } from "@/lib/extension-runtime-api"
import {
  useProviderAuthMethodsQuery,
  useProviderFinishAuthMutation,
  useProviderStartAuthMutation,
  useProvidersQuery,
} from "@/lib/extension-query-hooks"

type AuthField = NonNullable<ExtensionAuthMethod["fields"]>[number]

type PendingOauthState = {
  methodIndex: number
  method: ExtensionAuthMethod
  authorization: {
    mode: "auto" | "code"
    url: string
    instructions?: string
  }
}

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

export const Route = createFileRoute("/providers/$providerId/connect")({
  staticData: {
    title: "Connect provider",
  },
  component: ConnectProviderRoute,
})

function ConnectProviderRoute() {
  const router = useRouter()
  const navigate = useNavigate()
  const { providerId } = Route.useParams()
  const providersQuery = useProvidersQuery()
  const methodsQuery = useProviderAuthMethodsQuery(providerId)
  const startAuthMutation = useProviderStartAuthMutation()
  const finishAuthMutation = useProviderFinishAuthMutation()

  const provider = useMemo(
    () => (providersQuery.data ?? []).find((item) => item.id === providerId),
    [providerId, providersQuery.data],
  )
  const methods = methodsQuery.data ?? []

  const [selectedMethodIndex, setSelectedMethodIndex] = useState<number | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [flowError, setFlowError] = useState<string | null>(null)
  const [oauthCode, setOauthCode] = useState("")
  const [pendingOauth, setPendingOauth] = useState<PendingOauthState | null>(null)

  const selectedMethod = selectedMethodIndex == null ? undefined : methods[selectedMethodIndex]

  useEffect(() => {
    if (methods.length === 1) {
      setSelectedMethodIndex(0)
      return
    }

    setSelectedMethodIndex((current) => {
      if (current == null) return null
      return current < methods.length ? current : null
    })
  }, [methods])

  useEffect(() => {
    setFieldErrors({})
    setFlowError(null)
    setOauthCode("")
    setPendingOauth(null)

    if (!selectedMethod?.fields) {
      setValues({})
      return
    }

    setValues(buildInitialValues(selectedMethod.fields))
  }, [selectedMethodIndex, selectedMethod?.fields])

  async function completeOauth(input: {
    methodIndex: number
    code?: string
    callbackUrl?: string
  }) {
    const response = await finishAuthMutation.mutateAsync({
      providerID: providerId,
      methodIndex: input.methodIndex,
      code: input.code,
      callbackUrl: input.callbackUrl,
    })

    if (!response.result.connected) {
      throw new Error("Provider authentication did not complete")
    }

    toast.success(`${provider?.name ?? providerId} connected`)
    await navigate({ to: "/providers" })
  }

  async function launchBrowserOauth(pending: PendingOauthState) {
    if (!browser.identity?.launchWebAuthFlow) {
      throw new Error("Browser OAuth flow is unavailable")
    }

    const callbackUrl = await browser.identity.launchWebAuthFlow({
      url: pending.authorization.url,
      interactive: true,
    })

    if (!callbackUrl) {
      throw new Error("OAuth flow did not return a callback URL")
    }

    await completeOauth({
      methodIndex: pending.methodIndex,
      callbackUrl,
    })
  }

  async function beginAuth() {
    if (selectedMethodIndex == null || !selectedMethod) return

    const fields = selectedMethod.fields ?? []
    const validated = normalizeFieldValues(fields, values)
    setFieldErrors(validated.errors)
    if (Object.keys(validated.errors).length > 0) return

    setFlowError(null)
    setPendingOauth(null)
    setOauthCode("")

    const response = await startAuthMutation.mutateAsync({
      providerID: providerId,
      methodIndex: selectedMethodIndex,
      values: validated.values,
    })

    if (response.result.connected) {
      toast.success(`${provider?.name ?? providerId} connected`)
      await navigate({ to: "/providers" })
      return
    }

    if (!response.result.pending || !response.result.authorization) {
      throw new Error("Unsupported auth response")
    }

    const pending: PendingOauthState = {
      methodIndex: response.result.methodIndex,
      method: response.result.method,
      authorization: response.result.authorization,
    }

    setPendingOauth(pending)

    if (pending.authorization.mode === "code") return

    if (pending.method.type !== "oauth") {
      throw new Error("Invalid OAuth method")
    }

    if (pending.method.mode === "browser") {
      await launchBrowserOauth(pending)
      return
    }

    await completeOauth({
      methodIndex: pending.methodIndex,
    })
  }

  async function submitCode() {
    if (!pendingOauth) return
    const code = oauthCode.trim()
    if (!code) {
      setFlowError("Authorization code is required")
      return
    }
    setFlowError(null)
    await completeOauth({
      methodIndex: pendingOauth.methodIndex,
      code,
    })
  }

  if (providersQuery.isPending || methodsQuery.isPending) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden rounded-none border border-border bg-background font-sans [&_*]:rounded-none">
        <PopupNav
          title={<span className="text-[13px] font-semibold text-foreground">Connect provider</span>}
          leftSlot={(
            <button
              onClick={() => {
                void router.history.back()
              }}
              className="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Back"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
        />
        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <p className="text-xs text-muted-foreground">Loading provider authentication...</p>
        </div>
      </div>
    )
  }

  if (!provider) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden rounded-none border border-border bg-background font-sans [&_*]:rounded-none">
        <PopupNav
          title={<span className="text-[13px] font-semibold text-foreground">Connect provider</span>}
          leftSlot={(
            <button
              onClick={() => {
                void navigate({ to: "/providers" })
              }}
              className="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Back"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
        />
        <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
          <p className="text-xs text-destructive">Provider not found.</p>
        </div>
      </div>
    )
  }

  if (methodsQuery.isError) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden rounded-none border border-border bg-background font-sans [&_*]:rounded-none">
        <PopupNav
          title={<span className="text-[13px] font-semibold text-foreground">Connect {provider.name}</span>}
          leftSlot={(
            <button
              onClick={() => {
                void navigate({ to: "/providers" })
              }}
              className="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Back"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
        />
        <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
          <p className="text-xs text-destructive">Failed to load auth methods.</p>
        </div>
      </div>
    )
  }

  const hasMethodSelection = methods.length > 1 && selectedMethodIndex == null

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-none border border-border bg-background font-sans [&_*]:rounded-none">
      <PopupNav
        title={<span className="text-[13px] font-semibold text-foreground">Connect {provider.name}</span>}
        subtitle={(
          <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
            {hasMethodSelection ? "Select auth method" : selectedMethod?.label}
          </span>
        )}
        leftSlot={(
          <button
            onClick={() => {
              if (!hasMethodSelection && methods.length > 1 && !pendingOauth) {
                setSelectedMethodIndex(null)
                return
              }
              void navigate({ to: "/providers" })
            }}
            className="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Back"
          >
            <ArrowLeft className="size-4" />
          </button>
        )}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
        {methods.length === 0 && (
          <div className="flex flex-1 items-center justify-center px-4 text-center">
            <p className="text-xs text-muted-foreground">No auth methods are available for this provider.</p>
          </div>
        )}

        {hasMethodSelection && (
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

        {!hasMethodSelection && selectedMethod && (
          <div className="flex flex-col gap-3">
            {selectedMethod.fields && selectedMethod.fields.length > 0 && !pendingOauth && (
              <ProviderAuthMethodForm
                fields={selectedMethod.fields}
                values={values}
                errors={fieldErrors}
                disabled={startAuthMutation.isPending || finishAuthMutation.isPending}
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

            {pendingOauth && (
              <div className="flex flex-col gap-2 border border-border bg-secondary/20 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-foreground">Authorization in progress</span>
                  <a
                    href={pendingOauth.authorization.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-primary hover:underline"
                  >
                    Open
                    <ExternalLink className="size-3" />
                  </a>
                </div>
                {pendingOauth.authorization.instructions && (
                  <p className="text-xs text-muted-foreground">{pendingOauth.authorization.instructions}</p>
                )}
              </div>
            )}

            {pendingOauth && pendingOauth.authorization.mode === "code" && (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-foreground">Authorization code</span>
                <input
                  value={oauthCode}
                  onChange={(event) => {
                    setOauthCode(event.currentTarget.value)
                  }}
                  placeholder="Paste code"
                  autoComplete="off"
                  disabled={finishAuthMutation.isPending}
                  className="h-8 w-full rounded-none border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
            )}

            {flowError && (
              <p className="text-xs text-destructive">{flowError}</p>
            )}

            <div className="mt-1 flex items-center justify-end gap-2">
              {!pendingOauth && (
                <button
                  onClick={() => {
                    void beginAuth().catch((error) => {
                      setFlowError(error instanceof Error ? error.message : String(error))
                    })
                  }}
                  disabled={startAuthMutation.isPending || finishAuthMutation.isPending}
                  className="bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {startAuthMutation.isPending ? "Starting..." : "Continue"}
                </button>
              )}

              {pendingOauth && pendingOauth.authorization.mode === "code" && (
                <button
                  onClick={() => {
                    void submitCode().catch((error) => {
                      setFlowError(error instanceof Error ? error.message : String(error))
                    })
                  }}
                  disabled={finishAuthMutation.isPending}
                  className="bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {finishAuthMutation.isPending ? "Finishing..." : "Finish"}
                </button>
              )}

              {pendingOauth
                && pendingOauth.authorization.mode !== "code"
                && pendingOauth.method.type === "oauth"
                && pendingOauth.method.mode === "browser" && (
                <button
                  onClick={() => {
                    void launchBrowserOauth(pendingOauth).catch((error) => {
                      setFlowError(error instanceof Error ? error.message : String(error))
                    })
                  }}
                  disabled={finishAuthMutation.isPending}
                  className="border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Open browser flow
                </button>
              )}

              {pendingOauth
                && pendingOauth.authorization.mode !== "code"
                && pendingOauth.method.type === "oauth"
                && pendingOauth.method.mode !== "browser" && (
                <button
                  onClick={() => {
                    void completeOauth({
                      methodIndex: pendingOauth.methodIndex,
                    }).catch((error) => {
                      setFlowError(error instanceof Error ? error.message : String(error))
                    })
                  }}
                  disabled={finishAuthMutation.isPending}
                  className="border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {finishAuthMutation.isPending ? "Waiting..." : "Check status"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
