import { browser } from "@wxt-dev/browser"
import type { AuthAuthorization, AuthContinuationContext, AuthMethod, ResolvedAuthReference } from "@/lib/runtime/plugin-manager"
import {
  finishProviderAuth,
  listProviderAuthMethods,
  startProviderAuth,
} from "@/lib/runtime/provider-auth"
import { publishRuntimeEvent } from "@/lib/runtime/events/runtime-events"
import { refreshProviderCatalogForProvider } from "@/lib/runtime/provider-registry"

const AUTH_FLOW_WINDOW_WIDTH = 420
const AUTH_FLOW_WINDOW_HEIGHT = 640
const AUTH_FLOW_TTL_MS = 30 * 60_000
const AUTH_FLOW_SWEEP_INTERVAL_MS = 60_000

export type RuntimeAuthFlowStatus =
  | "idle"
  | "awaiting_input"
  | "awaiting_external"
  | "awaiting_code"
  | "running"
  | "success"
  | "error"
  | "canceled"

export interface RuntimeAuthFlowSnapshot {
  providerID: string
  status: RuntimeAuthFlowStatus
  methods: AuthMethod[]
  selectedMethodIndex?: number
  authorization?: AuthAuthorization
  error?: string
  updatedAt: number
  canRetry: boolean
  canCancel: boolean
}

export interface OpenProviderAuthWindowResult {
  providerID: string
  reused: boolean
  windowId: number
}

type AuthFlowState = {
  providerID: string
  status: RuntimeAuthFlowStatus
  methods: AuthMethod[]
  selectedMethodIndex?: number
  authorization?: AuthAuthorization
  error?: string
  updatedAt: number
  expiresAt: number
  windowId?: number
  resolved?: ResolvedAuthReference
  context?: AuthContinuationContext
  controller?: AbortController
  task?: Promise<void>
}

function isTerminalStatus(status: RuntimeAuthFlowStatus) {
  return status === "success" || status === "error" || status === "canceled"
}

function canRetry(status: RuntimeAuthFlowStatus) {
  return status === "error" || status === "canceled"
}

function canCancel(status: RuntimeAuthFlowStatus) {
  return status === "awaiting_input"
    || status === "awaiting_external"
    || status === "awaiting_code"
    || status === "running"
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("Authentication canceled")
  }
}

export class AuthFlowManager {
  private readonly flows = new Map<string, AuthFlowState>()
  private readonly providerWindows = new Map<string, number>()
  private readonly windowProviders = new Map<number, string>()
  private readonly sweepTimer: ReturnType<typeof setInterval>

  constructor() {
    this.sweepTimer = setInterval(() => {
      void this.pruneExpiredFlows()
    }, AUTH_FLOW_SWEEP_INTERVAL_MS)
  }

  dispose() {
    clearInterval(this.sweepTimer)
  }

  private currentTimestamp() {
    return Date.now()
  }

  private markUpdated(flow: AuthFlowState) {
    const now = this.currentTimestamp()
    flow.updatedAt = now
    flow.expiresAt = now + AUTH_FLOW_TTL_MS
  }

  private emitFlowChanged(flow: AuthFlowState) {
    publishRuntimeEvent({
      type: "runtime.authFlow.changed",
      payload: {
        providerID: flow.providerID,
        status: flow.status,
        updatedAt: flow.updatedAt,
      },
    })
  }

  private snapshot(flow: AuthFlowState): RuntimeAuthFlowSnapshot {
    return {
      providerID: flow.providerID,
      status: flow.status,
      methods: flow.methods,
      selectedMethodIndex: flow.selectedMethodIndex,
      authorization: flow.authorization,
      error: flow.error,
      updatedAt: flow.updatedAt,
      canRetry: canRetry(flow.status),
      canCancel: canCancel(flow.status),
    }
  }

  private async idleSnapshot(providerID: string): Promise<RuntimeAuthFlowSnapshot> {
    const methods = await listProviderAuthMethods(providerID)
    const now = this.currentTimestamp()
    return {
      providerID,
      status: "idle",
      methods,
      updatedAt: now,
      canRetry: false,
      canCancel: false,
    }
  }

  private async buildInputFlow(providerID: string, selectedMethodIndex?: number): Promise<AuthFlowState> {
    const methods = await listProviderAuthMethods(providerID)
    const now = this.currentTimestamp()
    return {
      providerID,
      status: "awaiting_input",
      methods,
      selectedMethodIndex: typeof selectedMethodIndex === "number"
        && selectedMethodIndex >= 0
        && selectedMethodIndex < methods.length
        ? selectedMethodIndex
        : undefined,
      updatedAt: now,
      expiresAt: now + AUTH_FLOW_TTL_MS,
    }
  }

  private setFlow(flow: AuthFlowState) {
    this.markUpdated(flow)
    this.flows.set(flow.providerID, flow)
    this.emitFlowChanged(flow)
  }

  private clearExecution(flow: AuthFlowState) {
    flow.controller = undefined
    flow.task = undefined
    flow.resolved = undefined
    flow.context = undefined
  }

  private async runAutoFlow(providerID: string, flow: AuthFlowState) {
    const resolved = flow.resolved
    const methodIndex = flow.selectedMethodIndex
    const method = typeof methodIndex === "number" ? flow.methods[methodIndex] : undefined
    const authorization = flow.authorization

    if (!resolved || typeof methodIndex !== "number" || !method || !authorization) {
      flow.status = "error"
      flow.error = "Auth flow is missing pending session context."
      this.clearExecution(flow)
      this.setFlow(flow)
      return
    }

    const signal = flow.controller?.signal

    try {
      let callbackUrl: string | undefined
      if (method.type === "oauth" && method.mode === "browser") {
        if (!browser.identity?.launchWebAuthFlow) {
          throw new Error("Browser OAuth flow is unavailable")
        }

        throwIfAborted(signal)

        callbackUrl = await browser.identity.launchWebAuthFlow({
          url: authorization.url,
          interactive: true,
        }) ?? undefined

        if (!callbackUrl) {
          throw new Error("OAuth flow did not return a callback URL")
        }
      }

      throwIfAborted(signal)

      const result = await finishProviderAuth({
        providerID,
        methodIndex,
        resolved,
        context: flow.context,
        callbackUrl,
        signal,
      })

      throwIfAborted(signal)

      if (result.connected) {
        await refreshProviderCatalogForProvider(providerID)
      }

      const latest = this.flows.get(providerID)
      if (!latest) return
      if (latest !== flow) return
      if (latest.status === "canceled") return

      latest.status = "success"
      latest.error = undefined
      latest.authorization = undefined
      this.clearExecution(latest)
      this.setFlow(latest)
    } catch (error) {
      const latest = this.flows.get(providerID)
      if (!latest) return
      if (latest !== flow) return
      if (latest.status === "canceled") return

      if (signal?.aborted) {
        latest.status = "canceled"
        latest.error = "Authentication canceled."
      } else {
        latest.status = "error"
        latest.error = toErrorMessage(error)
      }
      latest.authorization = undefined
      this.clearExecution(latest)
      this.setFlow(latest)
    }
  }

  async getProviderAuthFlow(providerID: string): Promise<RuntimeAuthFlowSnapshot> {
    const flow = this.flows.get(providerID)
    if (!flow) {
      return this.idleSnapshot(providerID)
    }

    if (flow.expiresAt <= this.currentTimestamp() && !isTerminalStatus(flow.status)) {
      return this.cancelProviderAuthFlow({
        providerID,
        reason: "expired",
      })
    }

    return this.snapshot(flow)
  }

  async openProviderAuthWindow(providerID: string): Promise<OpenProviderAuthWindowResult> {
    let flow = this.flows.get(providerID)
    if (!flow || flow.status === "idle" || isTerminalStatus(flow.status)) {
      flow = await this.buildInputFlow(providerID)
      this.setFlow(flow)
    }

    if (typeof flow.windowId === "number") {
      try {
        await browser.windows.update(flow.windowId, {
          focused: true,
        })
        return {
          providerID,
          reused: true,
          windowId: flow.windowId,
        }
      } catch {
        this.providerWindows.delete(providerID)
        this.windowProviders.delete(flow.windowId)
        flow.windowId = undefined
      }
    }

    const url = new URL(browser.runtime.getURL("/connect.html"))
    url.searchParams.set("providerID", providerID)
    const windowRef = await browser.windows.create({
      url: url.toString(),
      type: "popup",
      focused: true,
      width: AUTH_FLOW_WINDOW_WIDTH,
      height: AUTH_FLOW_WINDOW_HEIGHT,
    })

    if (!windowRef || typeof windowRef.id !== "number") {
      throw new Error("Failed to open provider auth window")
    }

    flow.windowId = windowRef.id
    this.providerWindows.set(providerID, windowRef.id)
    this.windowProviders.set(windowRef.id, providerID)
    this.setFlow(flow)

    return {
      providerID,
      reused: false,
      windowId: windowRef.id,
    }
  }

  async startProviderAuthFlow(input: {
    providerID: string
    methodIndex: number
    values?: Record<string, string>
  }): Promise<RuntimeAuthFlowSnapshot> {
    let flow = this.flows.get(input.providerID)
    if (!flow) {
      flow = await this.buildInputFlow(input.providerID)
      this.setFlow(flow)
    }

    if (flow.status === "running" || flow.status === "awaiting_external" || flow.status === "awaiting_code") {
      throw new Error("Auth flow is already in progress")
    }

    if (input.methodIndex < 0 || input.methodIndex >= flow.methods.length) {
      throw new Error(`Auth method index ${input.methodIndex} is out of bounds for provider ${input.providerID}`)
    }

    this.clearExecution(flow)
    flow.status = "running"
    flow.error = undefined
    flow.selectedMethodIndex = input.methodIndex
    flow.authorization = undefined
    this.setFlow(flow)

    try {
      const result = await startProviderAuth({
        providerID: input.providerID,
        methodIndex: input.methodIndex,
        values: input.values ?? {},
      })

      if (result.connected) {
        await refreshProviderCatalogForProvider(input.providerID)
        const latest = this.flows.get(input.providerID)
        if (!latest) {
          return this.idleSnapshot(input.providerID)
        }

        latest.status = "success"
        latest.error = undefined
        latest.authorization = undefined
        this.clearExecution(latest)
        this.setFlow(latest)
        return this.snapshot(latest)
      }

      const latest = this.flows.get(input.providerID)
      if (!latest) {
        return this.idleSnapshot(input.providerID)
      }

      latest.selectedMethodIndex = result.methodIndex
      latest.authorization = result.authorization
      latest.resolved = result.resolved
      latest.context = result.context

      if (result.authorization.mode === "code") {
        latest.status = "awaiting_code"
        latest.error = undefined
        this.setFlow(latest)
        return this.snapshot(latest)
      }

      latest.status = "awaiting_external"
      latest.error = undefined
      latest.controller = new AbortController()
      const task = this.runAutoFlow(input.providerID, latest)
      latest.task = task
      this.setFlow(latest)

      return this.snapshot(latest)
    } catch (error) {
      const latest = this.flows.get(input.providerID)
      if (!latest) {
        throw error
      }

      latest.status = "error"
      latest.error = toErrorMessage(error)
      latest.authorization = undefined
      this.clearExecution(latest)
      this.setFlow(latest)
      return this.snapshot(latest)
    }
  }

  async submitProviderAuthCode(input: {
    providerID: string
    code: string
  }): Promise<RuntimeAuthFlowSnapshot> {
    const flow = this.flows.get(input.providerID)
    if (!flow) {
      return this.idleSnapshot(input.providerID)
    }

    if (flow.status !== "awaiting_code") {
      throw new Error("Auth flow is not awaiting an authorization code")
    }

    if (!flow.resolved || typeof flow.selectedMethodIndex !== "number") {
      throw new Error("Auth flow is missing pending session context")
    }

    const code = input.code.trim()
    if (!code) {
      throw new Error("Authorization code is required")
    }

    flow.status = "running"
    flow.error = undefined
    flow.controller = new AbortController()
    this.setFlow(flow)

    try {
      const result = await finishProviderAuth({
        providerID: input.providerID,
        methodIndex: flow.selectedMethodIndex,
        resolved: flow.resolved,
        context: flow.context,
        code,
        signal: flow.controller.signal,
      })

      throwIfAborted(flow.controller.signal)

      if (result.connected) {
        await refreshProviderCatalogForProvider(input.providerID)
      }

      const latest = this.flows.get(input.providerID)
      if (!latest) {
        return this.idleSnapshot(input.providerID)
      }

      latest.status = "success"
      latest.error = undefined
      latest.authorization = undefined
      this.clearExecution(latest)
      this.setFlow(latest)
      return this.snapshot(latest)
    } catch (error) {
      const latest = this.flows.get(input.providerID)
      if (!latest) {
        throw error
      }

      if (latest.controller?.signal.aborted) {
        latest.status = "canceled"
        latest.error = "Authentication canceled."
      } else {
        latest.status = "error"
        latest.error = toErrorMessage(error)
      }
      latest.authorization = undefined
      this.clearExecution(latest)
      this.setFlow(latest)
      return this.snapshot(latest)
    }
  }

  async retryProviderAuthFlow(providerID: string): Promise<RuntimeAuthFlowSnapshot> {
    const flow = this.flows.get(providerID)
    if (!flow) {
      const next = await this.buildInputFlow(providerID)
      this.setFlow(next)
      return this.snapshot(next)
    }

    if (!canRetry(flow.status)) {
      throw new Error("Auth flow cannot be retried from the current state")
    }

    const selectedMethodIndex = flow.selectedMethodIndex
    const next = await this.buildInputFlow(providerID, selectedMethodIndex)
    next.windowId = flow.windowId
    this.setFlow(next)
    return this.snapshot(next)
  }

  async cancelProviderAuthFlow(input: {
    providerID: string
    reason?: string
  }): Promise<RuntimeAuthFlowSnapshot> {
    const flow = this.flows.get(input.providerID)
    if (!flow) {
      return this.idleSnapshot(input.providerID)
    }

    if (isTerminalStatus(flow.status)) {
      return this.snapshot(flow)
    }

    flow.controller?.abort()
    flow.status = "canceled"
    flow.error = input.reason === "expired"
      ? "Authentication expired."
      : "Authentication canceled."
    flow.authorization = undefined
    this.clearExecution(flow)
    this.setFlow(flow)
    return this.snapshot(flow)
  }

  async handleWindowClosed(windowId: number) {
    const providerID = this.windowProviders.get(windowId)
    if (!providerID) return

    this.windowProviders.delete(windowId)
    this.providerWindows.delete(providerID)

    const flow = this.flows.get(providerID)
    if (flow) {
      flow.windowId = undefined
    }

    await this.cancelProviderAuthFlow({
      providerID,
      reason: "window_closed",
    })
  }

  private async pruneExpiredFlows() {
    const now = this.currentTimestamp()

    for (const [providerID, flow] of this.flows) {
      if (flow.expiresAt > now) continue

      if (isTerminalStatus(flow.status)) {
        this.flows.delete(providerID)
        if (typeof flow.windowId === "number") {
          this.windowProviders.delete(flow.windowId)
          this.providerWindows.delete(providerID)
        }
        continue
      }

      await this.cancelProviderAuthFlow({
        providerID,
        reason: "expired",
      })
    }
  }
}

let manager: AuthFlowManager | undefined

export function getAuthFlowManager() {
  if (!manager) {
    manager = new AuthFlowManager()
  }
  return manager
}
