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
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface ResolvedPermissionTarget {
  modelId: string;
  modelName: string;
  provider: string;
  capabilities: ReadonlyArray<string>;
}

export interface RuntimeEnvironmentApi {
  readonly catalog: {
    ensureCatalog: () => AppEffect<void>;
    refreshCatalog: () => AppEffect<void>;
    refreshCatalogForProvider: (providerID: string) => AppEffect<void>;
  };
  readonly providers: {
    listProviders: () => AppEffect<ReadonlyArray<RuntimeProviderSummary>>;
  };
  readonly models: {
    listModels: (options: {
      connectedOnly?: boolean;
      providerID?: string;
    }) => AppEffect<ReadonlyArray<RuntimeModelSummary>>;
  };
  readonly permissions: {
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
    setModelPermission: (input: {
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
  };
  readonly pending: {
    listPending: (
      origin: string,
    ) => AppEffect<ReadonlyArray<RuntimePendingRequest>>;
  };
  readonly auth: {
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
  };
  readonly meta: {
    parseProviderModel: (modelID: string) => {
      providerID: string;
      modelID: string;
    };
    resolvePermissionTarget: (
      modelID: string,
    ) => AppEffect<ResolvedPermissionTarget>;
  };
  readonly modelExecution: {
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
  };
}

export class RuntimeEnvironment extends Context.Tag(
  "@llm-bridge/runtime-core/RuntimeEnvironment",
)<RuntimeEnvironment, RuntimeEnvironmentApi>() {}

export type AppEffect<
  A,
  E extends RuntimeRpcError = RuntimeRpcError,
  R = RuntimeEnvironment,
> = Effect.Effect<A, E, R>;
