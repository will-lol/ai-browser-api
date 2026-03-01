import { browser } from "@wxt-dev/browser"
import type { RuntimeAuthMethod } from "@/lib/runtime/plugin-manager"
import {
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
  | "authorizing"
  | "success"
  | "error"
  | "canceled"

export interface RuntimeAuthFlowSnapshot {
  providerID: string
  status: RuntimeAuthFlowStatus
  methods: RuntimeAuthMethod[]
  runningMethodID?: string
  error?: string
  updatedAt: number
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
  methods: RuntimeAuthMethod[]
  runningMethodID?: string
  error?: string
  updatedAt: number
  expiresAt: number
  windowId?: number
  controller?: AbortController
  task?: Promise<unknown>
}

function isTerminalStatus(status: RuntimeAuthFlowStatus) {
  return status === "success" || status === "error" || status === "canceled"
}

function canCancel(status: RuntimeAuthFlowStatus) {
  return status === "authorizing"
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return String(error)
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
      runningMethodID: flow.runningMethodID,
      error: flow.error,
      updatedAt: flow.updatedAt,
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
      canCancel: false,
    }
  }

  private async buildIdleFlow(providerID: string): Promise<AuthFlowState> {
    const methods = await listProviderAuthMethods(providerID)
    const now = this.currentTimestamp()
    return {
      providerID,
      status: "idle",
      methods,
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
    flow.runningMethodID = undefined
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
    if (!flow || isTerminalStatus(flow.status)) {
      flow = await this.buildIdleFlow(providerID)
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
    methodID: string
    values?: Record<string, string>
  }): Promise<RuntimeAuthFlowSnapshot> {
    let flow = this.flows.get(input.providerID)
    if (!flow || isTerminalStatus(flow.status)) {
      flow = await this.buildIdleFlow(input.providerID)
      this.setFlow(flow)
    }

    if (flow.status === "authorizing") {
      throw new Error("Auth flow is already in progress")
    }

    flow.methods = await listProviderAuthMethods(input.providerID)
    const selected = flow.methods.find((method) => method.id === input.methodID)
    if (!selected) {
      throw new Error(`Auth method ${input.methodID} is not available for provider ${input.providerID}`)
    }

    this.clearExecution(flow)
    flow.status = "authorizing"
    flow.error = undefined
    flow.runningMethodID = selected.id
    flow.controller = new AbortController()
    this.setFlow(flow)

    try {
      const task = startProviderAuth({
        providerID: input.providerID,
        methodID: selected.id,
        values: input.values ?? {},
        signal: flow.controller.signal,
      })
      flow.task = task

      const result = await task
      if (result.connected) {
        await refreshProviderCatalogForProvider(input.providerID)
      }

      const latest = this.flows.get(input.providerID)
      if (!latest) {
        return this.idleSnapshot(input.providerID)
      }
      if (latest !== flow) {
        return this.snapshot(latest)
      }

      latest.status = "success"
      latest.error = undefined
      this.clearExecution(latest)
      latest.methods = await listProviderAuthMethods(input.providerID)
      this.setFlow(latest)
      return this.snapshot(latest)
    } catch (error) {
      const latest = this.flows.get(input.providerID)
      if (!latest) {
        throw error
      }
      if (latest !== flow) {
        return this.snapshot(latest)
      }

      if (latest.controller?.signal.aborted) {
        latest.status = "canceled"
        latest.error = "Authentication canceled."
      } else {
        latest.status = "error"
        latest.error = toErrorMessage(error)
      }
      this.clearExecution(latest)
      latest.methods = await listProviderAuthMethods(input.providerID)
      this.setFlow(latest)
      return this.snapshot(latest)
    }
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
