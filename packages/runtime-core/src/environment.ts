import type {
  PermissionStatus,
  RuntimeAbortChatStreamInput,
  RuntimeAuthFlowSnapshot,
  RuntimeCancelProviderAuthFlowResponse,
  RuntimeCreatePermissionRequestResponse,
  RuntimeDismissPermissionRequestResponse,
  RuntimeDisconnectProviderResponse,
  RuntimeChatReconnectStreamInput,
  RuntimeChatSendMessagesInput,
  RuntimeChatStreamChunk,
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
  RuntimeRpcError,
} from "@llm-bridge/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

export interface ResolvedPermissionTarget {
  modelId: string;
  modelName: string;
  provider: string;
  capabilities: ReadonlyArray<string>;
}

export interface CatalogServiceApi {
  readonly ensureCatalog: () => AppEffect<void>;
  readonly refreshCatalog: () => AppEffect<void>;
  readonly refreshCatalogForProvider: (providerID: string) => AppEffect<void>;
  readonly listProviders: () => AppEffect<ReadonlyArray<RuntimeProviderSummary>>;
  readonly streamProviders: () => Stream.Stream<
    ReadonlyArray<RuntimeProviderSummary>
  >;
  readonly listModels: (options: {
    connectedOnly?: boolean;
    providerID?: string;
  }) => AppEffect<ReadonlyArray<RuntimeModelSummary>>;
  readonly streamModels: (options: {
    connectedOnly?: boolean;
    providerID?: string;
  }) => Stream.Stream<ReadonlyArray<RuntimeModelSummary>>;
}

export class CatalogService extends Context.Tag(
  "@llm-bridge/runtime-core/CatalogService",
)<CatalogService, CatalogServiceApi>() {}

export interface PermissionsServiceApi {
  readonly getOriginState: (origin: string) => AppEffect<RuntimeOriginState>;
  readonly streamOriginState: (
    origin: string,
  ) => Stream.Stream<RuntimeOriginState>;
  readonly listPermissions: (
    origin: string,
  ) => AppEffect<ReadonlyArray<RuntimePermissionEntry>>;
  readonly streamPermissions: (
    origin: string,
  ) => Stream.Stream<ReadonlyArray<RuntimePermissionEntry>>;
  readonly getModelPermission: (
    origin: string,
    modelID: string,
  ) => AppEffect<PermissionStatus>;
  readonly setOriginEnabled: (
    origin: string,
    enabled: boolean,
  ) => AppEffect<RuntimeSetOriginEnabledResponse>;
  readonly setModelPermission: (input: {
    origin: string;
    modelID: string;
    status: RuntimePermissionDecision;
    capabilities?: ReadonlyArray<string>;
  }) => AppEffect<RuntimeUpdatePermissionResponse>;
  readonly createPermissionRequest: (input: {
    origin: string;
    modelId: string;
    provider: string;
    modelName: string;
    capabilities?: ReadonlyArray<string>;
  }) => AppEffect<RuntimeCreatePermissionRequestResponse>;
  readonly resolvePermissionRequest: (input: {
    requestId: string;
    decision: RuntimePermissionDecision;
  }) => AppEffect<RuntimeResolvePermissionRequestResponse>;
  readonly dismissPermissionRequest: (
    requestId: string,
  ) => AppEffect<RuntimeDismissPermissionRequestResponse>;
  readonly listPending: (
    origin: string,
  ) => AppEffect<ReadonlyArray<RuntimePendingRequest>>;
  readonly streamPending: (
    origin: string,
  ) => Stream.Stream<ReadonlyArray<RuntimePendingRequest>>;
  readonly waitForPermissionDecision: (
    requestId: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ) => AppEffect<"resolved" | "timeout" | "aborted">;
  readonly streamOriginStates: () => Stream.Stream<
    ReadonlyMap<string, RuntimeOriginState>
  >;
  readonly streamPermissionsMap: () => Stream.Stream<
    ReadonlyMap<string, ReadonlyArray<RuntimePermissionEntry>>
  >;
  readonly streamPendingMap: () => Stream.Stream<
    ReadonlyMap<string, ReadonlyArray<RuntimePendingRequest>>
  >;
}

export class PermissionsService extends Context.Tag(
  "@llm-bridge/runtime-core/PermissionsService",
)<PermissionsService, PermissionsServiceApi>() {}

export interface AuthFlowServiceApi {
  readonly openProviderAuthWindow: (
    providerID: string,
  ) => AppEffect<RuntimeOpenProviderAuthWindowResponse>;
  readonly getProviderAuthFlow: (providerID: string) => AppEffect<{
    providerID: string;
    result: RuntimeAuthFlowSnapshot;
  }>;
  readonly streamProviderAuthFlow: (
    providerID: string,
  ) => Stream.Stream<
    {
      providerID: string;
      result: RuntimeAuthFlowSnapshot;
    },
    unknown
  >;
  readonly startProviderAuthFlow: (input: {
    providerID: string;
    methodID: string;
    values?: Record<string, string>;
  }) => AppEffect<RuntimeStartProviderAuthFlowResponse>;
  readonly cancelProviderAuthFlow: (input: {
    providerID: string;
    reason?: string;
  }) => AppEffect<RuntimeCancelProviderAuthFlowResponse>;
  readonly disconnectProvider: (
    providerID: string,
  ) => AppEffect<RuntimeDisconnectProviderResponse>;
}

export class AuthFlowService extends Context.Tag(
  "@llm-bridge/runtime-core/AuthFlowService",
)<AuthFlowService, AuthFlowServiceApi>() {}

export interface MetaServiceApi {
  readonly parseProviderModel: (modelID: string) => {
    providerID: string;
    modelID: string;
  };
  readonly resolvePermissionTarget: (
    modelID: string,
  ) => AppEffect<ResolvedPermissionTarget>;
}

export class MetaService extends Context.Tag(
  "@llm-bridge/runtime-core/MetaService",
)<MetaService, MetaServiceApi>() {}

export interface ModelExecutionServiceApi {
  readonly acquireModel: (input: {
    origin: string;
    sessionID: string;
    requestID: string;
    modelID: string;
  }) => AppEffect<RuntimeModelDescriptor>;
  readonly generateModel: (input: {
    origin: string;
    sessionID: string;
    requestID: string;
    modelID: string;
    options: RuntimeModelCallOptions;
    signal?: AbortSignal;
  }) => AppEffect<RuntimeGenerateResponse>;
  readonly streamModel: (input: {
    origin: string;
    sessionID: string;
    requestID: string;
    modelID: string;
    options: RuntimeModelCallOptions;
    signal?: AbortSignal;
  }) => AppEffect<ReadableStream<RuntimeStreamPart>>;
}

export class ModelExecutionService extends Context.Tag(
  "@llm-bridge/runtime-core/ModelExecutionService",
)<ModelExecutionService, ModelExecutionServiceApi>() {}

export interface ChatExecutionServiceApi {
  readonly sendMessages: (
    input: RuntimeChatSendMessagesInput,
  ) => AppEffect<
    Stream.Stream<RuntimeChatStreamChunk, RuntimeRpcError>,
    RuntimeRpcError
  >;
  readonly reconnectStream: (
    input: RuntimeChatReconnectStreamInput,
  ) => AppEffect<
    Stream.Stream<RuntimeChatStreamChunk, RuntimeRpcError>,
    RuntimeRpcError
  >;
  readonly abortStream: (
    input: RuntimeAbortChatStreamInput,
  ) => AppEffect<void, RuntimeRpcError>;
}

export class ChatExecutionService extends Context.Tag(
  "@llm-bridge/runtime-core/ChatExecutionService",
)<ChatExecutionService, ChatExecutionServiceApi>() {}

export type AppRuntime =
  | CatalogService
  | PermissionsService
  | AuthFlowService
  | MetaService
  | ModelExecutionService
  | ChatExecutionService;

export type AppEffect<A, E = unknown, R = AppRuntime> = Effect.Effect<A, E, R>;
