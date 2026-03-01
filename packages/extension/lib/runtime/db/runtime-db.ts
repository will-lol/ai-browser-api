import Dexie, { type EntityTable } from "dexie"
import type {
  RuntimeDbAuth,
  RuntimeDbConfig,
  RuntimeDbMeta,
  RuntimeDbModel,
  RuntimeDbOrigin,
  RuntimeDbPendingRequest,
  RuntimeDbPermission,
  RuntimeDbProvider,
} from "@/lib/runtime/db/runtime-db-types"

const RUNTIME_DB_NAME = "llm-bridge-runtime-db-v1"

export class RuntimeDb extends Dexie {
  providers!: EntityTable<RuntimeDbProvider, "id">
  models!: EntityTable<RuntimeDbModel, "id">
  auth!: EntityTable<RuntimeDbAuth, "providerID">
  origins!: EntityTable<RuntimeDbOrigin, "origin">
  permissions!: EntityTable<RuntimeDbPermission, "id">
  pendingRequests!: EntityTable<RuntimeDbPendingRequest, "id">
  meta!: EntityTable<RuntimeDbMeta, "key">
  config!: EntityTable<RuntimeDbConfig, "id">

  constructor() {
    super(RUNTIME_DB_NAME)

    this.version(1).stores({
      providers: "id, connected, updatedAt, name",
      models: "id, [providerID+modelID], providerID, modelID, status, updatedAt, name",
      auth: "providerID, updatedAt",
      origins: "origin, enabled, updatedAt",
      permissions: "id, [origin+modelId], origin, modelId, status, updatedAt",
      pendingRequests: "id, origin, status, dismissed, requestedAt, modelId",
      meta: "key, updatedAt",
      config: "id, updatedAt",
    })
  }
}

export const runtimeDb = new RuntimeDb()
