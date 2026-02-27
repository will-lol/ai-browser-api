"use client"

import type { ReactNode } from "react"
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { browser } from "wxt/browser"
import {
  PROVIDERS,
  INITIAL_PERMISSIONS,
  INITIAL_PENDING_REQUESTS,
  CURRENT_ORIGIN,
  getCapabilitiesForModel,
  type Provider,
  type ModelPermission,
  type PermissionRequest,
  type PermissionStatus,
} from "@/lib/mock-data"

const STORE_KEY = "llm-bridge-extension-state"

interface AvailableModel {
  modelId: string
  modelName: string
  provider: string
  capabilities: string[]
}

interface ExtensionStoreState {
  providers: Provider[]
  permissions: ModelPermission[]
  pendingRequests: PermissionRequest[]
  currentOrigin: string
  originEnabled: boolean
}

interface ExtensionStoreActions {
  toggleProvider: (providerId: string) => void
  setOriginEnabled: (enabled: boolean) => void
  addPendingRequest: (
    request?: Partial<
      Omit<PermissionRequest, "id" | "requestedAt" | "dismissed">
    >
  ) => string
  dismissRequest: (requestId: string) => void
  respondToRequest: (requestId: string, decision: "allowed" | "denied") => void
  updatePermission: (modelId: string, status: PermissionStatus) => void
  getAllAvailableModels: () => AvailableModel[]
  getModelPermission: (modelId: string) => PermissionStatus
}

type ExtensionState = ExtensionStoreState & ExtensionStoreActions

const initialState: ExtensionStoreState = {
  providers: PROVIDERS,
  permissions: INITIAL_PERMISSIONS,
  pendingRequests: INITIAL_PENDING_REQUESTS,
  currentOrigin: CURRENT_ORIGIN,
  originEnabled: true,
}

const storage = createJSONStorage<ExtensionStoreState>(() => ({
  getItem: async (name) => {
    const value = await browser.storage.local.get(name)
    const stored = value[name]
    if (stored == null) return null
    return typeof stored === "string" ? stored : JSON.stringify(stored)
  },
  setItem: async (name, value) => {
    await browser.storage.local.set({ [name]: value })
  },
  removeItem: async (name) => {
    await browser.storage.local.remove(name)
  },
}))

function getPendingRequestKey(request: Pick<PermissionRequest, "origin" | "modelId">) {
  return `${request.origin}::${request.modelId}`
}

export const useExtensionStore = create<ExtensionState>()(
  persist(
    (set, get) => ({
      ...initialState,
      toggleProvider: (providerId) => {
        set((state) => ({
          providers: state.providers.map((provider) =>
            provider.id === providerId
              ? { ...provider, connected: !provider.connected }
              : provider
          ),
        }))
      },
      setOriginEnabled: (enabled) => {
        set(() => ({ originEnabled: enabled }))
      },
      addPendingRequest: (request = {}) => {
        const state = get()
        if (!state.originEnabled) return ""

        const availableModels = state.getAllAvailableModels()
        const fallbackModel = availableModels[0] ?? {
          modelId: "openai/gpt-4o-mini",
          modelName: "gpt-4o-mini",
          provider: "openai",
          capabilities: getCapabilitiesForModel("gpt-4o-mini"),
        }

        const modelId = request.modelId ?? fallbackModel.modelId
        const modelName = request.modelName ?? modelId.split("/")[1] ?? fallbackModel.modelName
        const provider = request.provider ?? modelId.split("/")[0] ?? fallbackModel.provider
        const origin = request.origin ?? state.currentOrigin
        const capabilities = request.capabilities ?? getCapabilitiesForModel(modelName)

        const requestId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

        const resolvedModelId = `${provider}/${modelName}`
        const existingRequest = state.pendingRequests.find(
          (pendingRequest) =>
            getPendingRequestKey(pendingRequest) ===
            getPendingRequestKey({ origin, modelId: resolvedModelId })
        )

        if (existingRequest) {
          return existingRequest.id
        }

        const nextRequest: PermissionRequest = {
          id: requestId,
          origin,
          modelId: resolvedModelId,
          modelName,
          provider,
          capabilities,
          requestedAt: Date.now(),
          dismissed: false,
        }

        set((prev) => ({
          pendingRequests: [nextRequest, ...prev.pendingRequests],
        }))

        return requestId
      },
      dismissRequest: (requestId) => {
        set((state) => ({
          pendingRequests: state.pendingRequests.map((request) =>
            request.id === requestId
              ? { ...request, dismissed: true }
              : request
          ),
        }))
      },
      respondToRequest: (requestId, decision) => {
        set((state) => {
          const request = state.pendingRequests.find((item) => item.id === requestId)
          const pendingRequests = state.pendingRequests.filter(
            (item) => item.id !== requestId
          )

          if (!request) return { pendingRequests }

          const nextPermission: ModelPermission = {
            modelId: request.modelId,
            modelName: request.modelName,
            provider: request.provider,
            status: decision,
            capabilities: request.capabilities,
          }

          const existingIndex = state.permissions.findIndex(
            (permission) => permission.modelId === request.modelId
          )

          const permissions = [...state.permissions]
          if (existingIndex >= 0) {
            permissions[existingIndex] = nextPermission
          } else {
            permissions.push(nextPermission)
          }

          return { pendingRequests, permissions }
        })
      },
      updatePermission: (modelId, status) => {
        set((state) => {
          const existingIndex = state.permissions.findIndex(
            (permission) => permission.modelId === modelId
          )

          if (existingIndex >= 0) {
            const permissions = [...state.permissions]
            permissions[existingIndex] = {
              ...permissions[existingIndex],
              status,
            }
            return { permissions }
          }

          const [providerId, modelName] = modelId.split("/")
          const provider = state.providers.find((item) => item.id === providerId)
          if (!provider) return {}

          return {
            permissions: [
              ...state.permissions,
              {
                modelId,
                modelName,
                provider: providerId,
                status,
                capabilities: getCapabilitiesForModel(modelName),
              },
            ],
          }
        })
      },
      getAllAvailableModels: () => {
        const { providers } = get()
        return providers
          .filter((provider) => provider.connected)
          .flatMap((provider) =>
            provider.models.map((modelName) => ({
              modelId: `${provider.id}/${modelName}`,
              modelName,
              provider: provider.id,
              capabilities: getCapabilitiesForModel(modelName),
            }))
          )
      },
      getModelPermission: (modelId) => {
        const { permissions } = get()
        const permission = permissions.find((item) => item.modelId === modelId)
        return permission?.status ?? "denied"
      },
    }),
    {
      name: STORE_KEY,
      storage,
      partialize: (state) => ({
        providers: state.providers,
        permissions: state.permissions,
        pendingRequests: state.pendingRequests,
        currentOrigin: state.currentOrigin,
        originEnabled: state.originEnabled,
      }),
    }
  )
)

let attachedStorageSyncListener = false

function attachStorageSyncListener() {
  if (attachedStorageSyncListener) return
  attachedStorageSyncListener = true

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return
    if (!changes[STORE_KEY]) return
    void useExtensionStore.persist.rehydrate()
  })
}

attachStorageSyncListener()

export function ExtensionProvider({ children }: { children: ReactNode }) {
  return children
}

export function useExtension() {
  return useExtensionStore()
}
