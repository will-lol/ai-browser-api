import type {
  PermissionStatus,
  RuntimeAuthFlowSnapshot,
  RuntimeCancelProviderAuthFlowResponse,
  RuntimeCreatePermissionRequestResponse,
  RuntimeDismissPermissionRequestResponse,
  RuntimeDisconnectProviderResponse,
  RuntimeGenerateResponse,
  RuntimeModelCallOptions,
  RuntimeModelDescriptor,
  RuntimeModelSummary,
  RuntimeOpenProviderAuthWindowResponse,
  RuntimeOriginState,
  RuntimePendingRequest,
  RuntimePermissionDecision,
  RuntimePermissionEntry,
  RuntimeProviderSummary,
  RuntimeResolvePermissionRequestResponse,
  RuntimeRpcError,
  RuntimeSetOriginEnabledResponse,
  RuntimeStartProviderAuthFlowResponse,
  RuntimeStreamPart,
  RuntimeUpdatePermissionResponse,
} from "@llm-bridge/contracts";
import type * as Effect from "effect/Effect";
import * as Context from "effect/Context";

type AppEffect<A> = Effect.Effect<A, RuntimeRpcError>;

export interface ResolvedPermissionTarget {
  modelId: string;
  modelName: string;
  provider: string;
  capabilities: ReadonlyArray<string>;
}

export interface ProvidersRepositoryApi {
  listProviders: () => AppEffect<ReadonlyArray<RuntimeProviderSummary>>;
}

export class ProvidersRepository extends Context.Tag(
  "@llm-bridge/runtime-core/ProvidersRepository",
)<ProvidersRepository, ProvidersRepositoryApi>() {}

export interface ModelsRepositoryApi {
  listModels: (options: {
    connectedOnly?: boolean;
    providerID?: string;
  }) => AppEffect<ReadonlyArray<RuntimeModelSummary>>;
}

export class ModelsRepository extends Context.Tag(
  "@llm-bridge/runtime-core/ModelsRepository",
)<ModelsRepository, ModelsRepositoryApi>() {}

export interface AuthRepositoryApi {
  // Repository operations must only perform auth storage/window work.
  // Catalog refresh side-effects are owned by runtime-core services.
  openProviderAuthWindow: (
    providerID: string,
  ) => AppEffect<RuntimeOpenProviderAuthWindowResponse>;
  getProviderAuthFlow: (providerID: string) => AppEffect<{
    providerID: string;
    result: RuntimeAuthFlowSnapshot;
  }>;
  startProviderAuthFlow: (input: {
    providerID: string;
    methodID: string;
    values?: Record<string, string>;
  }) => AppEffect<RuntimeStartProviderAuthFlowResponse>;
  cancelProviderAuthFlow: (input: {
    providerID: string;
    reason?: string;
  }) => AppEffect<RuntimeCancelProviderAuthFlowResponse>;
  disconnectProvider: (
    providerID: string,
  ) => AppEffect<RuntimeDisconnectProviderResponse>;
}

export class AuthRepository extends Context.Tag(
  "@llm-bridge/runtime-core/AuthRepository",
)<AuthRepository, AuthRepositoryApi>() {}

export interface PermissionsRepositoryApi {
  getOriginState: (origin: string) => AppEffect<RuntimeOriginState>;
  listPermissions: (
    origin: string,
  ) => AppEffect<ReadonlyArray<RuntimePermissionEntry>>;
  getModelPermission: (
    origin: string,
    modelID: string,
  ) => AppEffect<PermissionStatus>;
  setOriginEnabled: (
    origin: string,
    enabled: boolean,
  ) => AppEffect<RuntimeSetOriginEnabledResponse>;
  updatePermission: (input: {
    origin: string;
    modelID: string;
    status: RuntimePermissionDecision;
    capabilities?: ReadonlyArray<string>;
  }) => AppEffect<RuntimeUpdatePermissionResponse>;
  createPermissionRequest: (input: {
    origin: string;
    modelId: string;
    provider: string;
    modelName: string;
    capabilities?: ReadonlyArray<string>;
  }) => AppEffect<RuntimeCreatePermissionRequestResponse>;
  resolvePermissionRequest: (input: {
    requestId: string;
    decision: RuntimePermissionDecision;
  }) => AppEffect<RuntimeResolvePermissionRequestResponse>;
  dismissPermissionRequest: (
    requestId: string,
  ) => AppEffect<RuntimeDismissPermissionRequestResponse>;
  waitForPermissionDecision: (
    requestId: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ) => AppEffect<"resolved" | "timeout" | "aborted">;
}

export class PermissionsRepository extends Context.Tag(
  "@llm-bridge/runtime-core/PermissionsRepository",
)<PermissionsRepository, PermissionsRepositoryApi>() {}

export interface PendingRequestsRepositoryApi {
  listPending: (
    origin: string,
  ) => AppEffect<ReadonlyArray<RuntimePendingRequest>>;
}

export class PendingRequestsRepository extends Context.Tag(
  "@llm-bridge/runtime-core/PendingRequestsRepository",
)<PendingRequestsRepository, PendingRequestsRepositoryApi>() {}

export interface ConfigRepositoryApi {
  currentOriginFallback: () => string;
}

export class ConfigRepository extends Context.Tag(
  "@llm-bridge/runtime-core/ConfigRepository",
)<ConfigRepository, ConfigRepositoryApi>() {}

export interface MetaRepositoryApi {
  parseProviderModel: (modelID: string) => {
    providerID: string;
    modelID: string;
  };
  resolvePermissionTarget: (
    modelID: string,
  ) => AppEffect<ResolvedPermissionTarget>;
}

export class MetaRepository extends Context.Tag(
  "@llm-bridge/runtime-core/MetaRepository",
)<MetaRepository, MetaRepositoryApi>() {}

export interface ModelExecutionRepositoryApi {
  // Repository operations execute models only.
  // Permission/origin policy checks are owned by runtime-core services.
  acquireModel: (input: {
    origin: string;
    sessionID: string;
    requestID: string;
    modelID: string;
  }) => AppEffect<RuntimeModelDescriptor>;
  generateModel: (input: {
    origin: string;
    sessionID: string;
    requestID: string;
    modelID: string;
    options: RuntimeModelCallOptions;
    signal?: AbortSignal;
  }) => AppEffect<RuntimeGenerateResponse>;
  streamModel: (input: {
    origin: string;
    sessionID: string;
    requestID: string;
    modelID: string;
    options: RuntimeModelCallOptions;
    signal?: AbortSignal;
  }) => AppEffect<ReadableStream<RuntimeStreamPart>>;
}

export class ModelExecutionRepository extends Context.Tag(
  "@llm-bridge/runtime-core/ModelExecutionRepository",
)<ModelExecutionRepository, ModelExecutionRepositoryApi>() {}

export interface CatalogRepositoryApi {
  ensureCatalog: () => AppEffect<void>;
  refreshCatalog: () => AppEffect<void>;
  refreshCatalogForProvider: (providerID: string) => AppEffect<void>;
}

export class CatalogRepository extends Context.Tag(
  "@llm-bridge/runtime-core/CatalogRepository",
)<CatalogRepository, CatalogRepositoryApi>() {}
