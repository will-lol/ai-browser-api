"use client"

import React, { createContext, useContext, useState, useCallback, type ReactNode } from "react"
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

interface ExtensionState {
  providers: Provider[]
  permissions: ModelPermission[]
  pendingRequests: PermissionRequest[]
  currentOrigin: string
  toggleProvider: (providerId: string) => void
  respondToRequest: (requestId: string, decision: "allowed" | "denied") => void
  dismissRequest: (requestId: string) => void
  updatePermission: (modelId: string, status: PermissionStatus) => void
  getAllAvailableModels: () => { modelId: string; modelName: string; provider: string; capabilities: string[] }[]
  getModelPermission: (modelId: string) => PermissionStatus
}

const ExtensionContext = createContext<ExtensionState | null>(null)

export function ExtensionProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<Provider[]>(PROVIDERS)
  const [permissions, setPermissions] = useState<ModelPermission[]>(INITIAL_PERMISSIONS)
  const [pendingRequests, setPendingRequests] = useState<PermissionRequest[]>(INITIAL_PENDING_REQUESTS)

  const toggleProvider = useCallback((providerId: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === providerId ? { ...p, connected: !p.connected } : p))
    )
  }, [])

  const respondToRequest = useCallback(
    (requestId: string, decision: "allowed" | "denied") => {
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId))
      const request = pendingRequests.find((r) => r.id === requestId)
      if (request) {
        setPermissions((prev) => {
          const existing = prev.findIndex((p) => p.modelId === request.modelId)
          const newPerm: ModelPermission = {
            modelId: request.modelId,
            modelName: request.modelName,
            provider: request.provider,
            status: decision,
            capabilities: request.capabilities,
          }
          if (existing >= 0) {
            const updated = [...prev]
            updated[existing] = newPerm
            return updated
          }
          return [...prev, newPerm]
        })
      }
    },
    [pendingRequests]
  )

  const dismissRequest = useCallback((requestId: string) => {
    setPendingRequests((prev) =>
      prev.map((r) => (r.id === requestId ? { ...r, dismissed: true } : r))
    )
  }, [])

  const updatePermission = useCallback((modelId: string, status: PermissionStatus) => {
    setPermissions((prev) => {
      const existing = prev.findIndex((p) => p.modelId === modelId)
      if (existing >= 0) {
        const updated = [...prev]
        updated[existing] = { ...updated[existing], status }
        return updated
      }
      // Find model info from providers
      const parts = modelId.split("/")
      const providerId = parts[0]
      const modelName = parts[1]
      const provider = providers.find((p) => p.id === providerId)
      if (!provider) return prev
      return [
        ...prev,
        {
          modelId,
          modelName,
          provider: providerId,
          status,
          capabilities: getCapabilitiesForModel(modelName),
        },
      ]
    })
  }, [providers])

  const getAllAvailableModels = useCallback(() => {
    const connected = providers.filter((p) => p.connected)
    return connected.flatMap((p) =>
      p.models.map((m) => ({
        modelId: `${p.id}/${m}`,
        modelName: m,
        provider: p.id,
        capabilities: getCapabilitiesForModel(m),
      }))
    )
  }, [providers])

  const getModelPermission = useCallback(
    (modelId: string): PermissionStatus => {
      const perm = permissions.find((p) => p.modelId === modelId)
      return perm?.status ?? "denied"
    },
    [permissions]
  )

  return (
    <ExtensionContext value={{
      providers,
      permissions,
      pendingRequests,
      currentOrigin: CURRENT_ORIGIN,
      toggleProvider,
      respondToRequest,
      dismissRequest,
      updatePermission,
      getAllAvailableModels,
      getModelPermission,
    }}>
      {children}
    </ExtensionContext>
  )
}

export function useExtension() {
  const ctx = useContext(ExtensionContext)
  if (!ctx) throw new Error("useExtension must be used within ExtensionProvider")
  return ctx
}
