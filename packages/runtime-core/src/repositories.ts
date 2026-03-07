import type {
  PermissionStatus,
  RuntimeRpcError,
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
  RuntimeSetOriginEnabledResponse,
  RuntimeStartProviderAuthFlowResponse,
  RuntimeStreamPart,
  RuntimeUpdatePermissionResponse,
} from "@llm-bridge/contracts";
import type * as Effect from "effect/Effect";
import * as Context from "effect/Context";

type AppEffect<A, E extends RuntimeRpcError = RuntimeRpcError> = Effect.Effect<
  A,
  E
>;

export interface ResolvedPermissionTarget {
  modelId: string;
  modelName: string;
  provider: string;
  capabilities: ReadonlyArray<string>;
}

export function makeProvidersRepository(input: {
  listProviders: () => AppEffect<ReadonlyArray<RuntimeProviderSummary>>;
}) {
  return input;
}

export type ProvidersRepositoryApi = ReturnType<typeof makeProvidersRepository>;

export class ProvidersRepository extends Context.Tag(
  "@llm-bridge/runtime-core/ProvidersRepository",
)<ProvidersRepository, ProvidersRepositoryApi>() {}

export function makeModelsRepository(input: {
  listModels: (options: {
    connectedOnly?: boolean;
    providerID?: string;
  }) => AppEffect<ReadonlyArray<RuntimeModelSummary>>;
}) {
  return input;
}

export type ModelsRepositoryApi = ReturnType<typeof makeModelsRepository>;

export class ModelsRepository extends Context.Tag(
  "@llm-bridge/runtime-core/ModelsRepository",
)<ModelsRepository, ModelsRepositoryApi>() {}

export function makeAuthRepository(input: {
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
}) {
  return input;
}

export type AuthRepositoryApi = ReturnType<typeof makeAuthRepository>;

export class AuthRepository extends Context.Tag(
  "@llm-bridge/runtime-core/AuthRepository",
)<AuthRepository, AuthRepositoryApi>() {}

export function makePermissionsRepository(input: {
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
}) {
  return input;
}

export type PermissionsRepositoryApi = ReturnType<
  typeof makePermissionsRepository
>;

export class PermissionsRepository extends Context.Tag(
  "@llm-bridge/runtime-core/PermissionsRepository",
)<PermissionsRepository, PermissionsRepositoryApi>() {}

export function makePendingRequestsRepository(input: {
  listPending: (
    origin: string,
  ) => AppEffect<ReadonlyArray<RuntimePendingRequest>>;
}) {
  return input;
}

export type PendingRequestsRepositoryApi = ReturnType<
  typeof makePendingRequestsRepository
>;

export class PendingRequestsRepository extends Context.Tag(
  "@llm-bridge/runtime-core/PendingRequestsRepository",
)<PendingRequestsRepository, PendingRequestsRepositoryApi>() {}

export function makeConfigRepository(input: {
  currentOriginFallback: () => string;
}) {
  return input;
}

export type ConfigRepositoryApi = ReturnType<typeof makeConfigRepository>;

export class ConfigRepository extends Context.Tag(
  "@llm-bridge/runtime-core/ConfigRepository",
)<ConfigRepository, ConfigRepositoryApi>() {}

export function makeMetaRepository(input: {
  parseProviderModel: (modelID: string) => {
    providerID: string;
    modelID: string;
  };
  resolvePermissionTarget: (
    modelID: string,
  ) => AppEffect<ResolvedPermissionTarget>;
}) {
  return input;
}

export type MetaRepositoryApi = ReturnType<typeof makeMetaRepository>;

export class MetaRepository extends Context.Tag(
  "@llm-bridge/runtime-core/MetaRepository",
)<MetaRepository, MetaRepositoryApi>() {}

export function makeModelExecutionRepository(input: {
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
}) {
  return input;
}

export type ModelExecutionRepositoryApi = ReturnType<
  typeof makeModelExecutionRepository
>;

export class ModelExecutionRepository extends Context.Tag(
  "@llm-bridge/runtime-core/ModelExecutionRepository",
)<ModelExecutionRepository, ModelExecutionRepositoryApi>() {}

export function makeCatalogRepository(input: {
  ensureCatalog: () => AppEffect<void>;
  refreshCatalog: () => AppEffect<void>;
  refreshCatalogForProvider: (providerID: string) => AppEffect<void>;
}) {
  return input;
}

export type CatalogRepositoryApi = ReturnType<typeof makeCatalogRepository>;

export class CatalogRepository extends Context.Tag(
  "@llm-bridge/runtime-core/CatalogRepository",
)<CatalogRepository, CatalogRepositoryApi>() {}
