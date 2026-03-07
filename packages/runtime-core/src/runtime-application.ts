import type {
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
  RuntimePermissionEntry,
  RuntimeProviderSummary,
  RuntimeRequestPermissionInput,
  RuntimeResolvePermissionRequestResponse,
  RuntimeSetOriginEnabledResponse,
  RuntimeStartProviderAuthFlowResponse,
  RuntimeStreamPart,
  RuntimeUpdatePermissionInput,
  RuntimeUpdatePermissionResponse,
} from "@llm-bridge/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  CatalogRepository,
  ModelsRepository,
  PendingRequestsRepository,
  PermissionsRepository,
  ProvidersRepository,
  type CatalogRepositoryApi,
  type ModelsRepositoryApi,
  type PendingRequestsRepositoryApi,
  type PermissionsRepositoryApi,
  type ProvidersRepositoryApi,
} from "./repositories";
import {
  AuthFlowService,
  AuthFlowServiceLive,
  ModelExecutionService,
  ModelExecutionServiceLive,
  PermissionService,
  PermissionServiceLive,
  type AuthFlowServiceApi,
  type ModelExecutionServiceApi,
  type PermissionServiceApi,
} from "./services";

type AppEffect<A, E = unknown> = Effect.Effect<A, E>;

export function makeRuntimeApplication(input: {
  catalog: CatalogRepositoryApi;
  providers: ProvidersRepositoryApi;
  models: ModelsRepositoryApi;
  permissions: PermissionsRepositoryApi;
  pending: PendingRequestsRepositoryApi;
  auth: AuthFlowServiceApi;
  permission: PermissionServiceApi;
  model: ModelExecutionServiceApi;
}) {
  const { catalog, providers, models, permissions, pending, auth, permission, model } =
    input;

  return {
    startup: (): AppEffect<void> => catalog.ensureCatalog(),
    ensureOriginEnabled: (origin: string): AppEffect<void> =>
      permission.ensureOriginEnabled(origin),
    listProviders: (): AppEffect<ReadonlyArray<RuntimeProviderSummary>> =>
      providers.listProviders(),
    listModels: (request: {
      connectedOnly?: boolean;
      providerID?: string;
    }): AppEffect<ReadonlyArray<RuntimeModelSummary>> =>
      models.listModels(request),
    listConnectedModels: (): AppEffect<ReadonlyArray<RuntimeModelSummary>> =>
      models.listModels({
        connectedOnly: true,
      }),
    getOriginState: (origin: string): AppEffect<RuntimeOriginState> =>
      permissions.getOriginState(origin),
    listPermissions: (
      origin: string,
    ): AppEffect<ReadonlyArray<RuntimePermissionEntry>> =>
      permissions.listPermissions(origin),
    listPending: (
      origin: string,
    ): AppEffect<ReadonlyArray<RuntimePendingRequest>> =>
      pending.listPending(origin),
    openProviderAuthWindow: (
      providerID: string,
    ): AppEffect<RuntimeOpenProviderAuthWindowResponse> =>
      auth.openProviderAuthWindow(providerID),
    getProviderAuthFlow: (
      providerID: string,
    ): AppEffect<{ providerID: string; result: RuntimeAuthFlowSnapshot }> =>
      auth.getProviderAuthFlow(providerID),
    startProviderAuthFlow: (request: {
      providerID: string;
      methodID: string;
      values?: Record<string, string>;
    }): AppEffect<RuntimeStartProviderAuthFlowResponse> =>
      auth.startProviderAuthFlow(request),
    cancelProviderAuthFlow: (request: {
      providerID: string;
      reason?: string;
    }): AppEffect<RuntimeCancelProviderAuthFlowResponse> =>
      auth.cancelProviderAuthFlow(request),
    disconnectProvider: (
      providerID: string,
    ): AppEffect<RuntimeDisconnectProviderResponse> =>
      auth.disconnectProvider(providerID),
    updatePermission: (
      request: RuntimeUpdatePermissionInput,
    ): AppEffect<
      RuntimeSetOriginEnabledResponse | RuntimeUpdatePermissionResponse
    > =>
      request.mode === "origin"
        ? permission.setOriginEnabled(request.origin, request.enabled)
        : permission.updatePermission({
            origin: request.origin,
            modelID: request.modelId,
            status: request.status,
            capabilities: request.capabilities,
          }),
    requestPermission: (
      request: RuntimeRequestPermissionInput,
    ): AppEffect<
      | RuntimeCreatePermissionRequestResponse
      | RuntimeDismissPermissionRequestResponse
      | RuntimeResolvePermissionRequestResponse
    > => permission.requestPermission(request),
    acquireModel: (request: {
      origin: string;
      requestID: string;
      sessionID: string;
      modelID: string;
    }): AppEffect<RuntimeModelDescriptor> =>
      model.acquireModel(request),
    modelDoGenerate: (request: {
      origin: string;
      requestID: string;
      sessionID: string;
      modelID: string;
      options: RuntimeModelCallOptions;
    }): AppEffect<RuntimeGenerateResponse> =>
      model.generateModel(request),
    modelDoStream: (request: {
      origin: string;
      requestID: string;
      sessionID: string;
      modelID: string;
      options: RuntimeModelCallOptions;
    }): AppEffect<ReadableStream<RuntimeStreamPart>> =>
      model.streamModel(request),
    abortModelCall: (request: {
      origin: string;
      sessionID: string;
      requestID: string;
    }): AppEffect<void> => model.abortModelCall(request),
  };
}

export type RuntimeApplicationApi = ReturnType<typeof makeRuntimeApplication>;

export class RuntimeApplication extends Context.Tag(
  "@llm-bridge/runtime-core/RuntimeApplication",
)<RuntimeApplication, RuntimeApplicationApi>() {}

export const RuntimeApplicationLive = Layer.effect(
  RuntimeApplication,
  Effect.gen(function* () {
    return makeRuntimeApplication({
      catalog: yield* CatalogRepository,
      providers: yield* ProvidersRepository,
      models: yield* ModelsRepository,
      permissions: yield* PermissionsRepository,
      pending: yield* PendingRequestsRepository,
      auth: yield* AuthFlowService,
      permission: yield* PermissionService,
      model: yield* ModelExecutionService,
    });
  }),
).pipe(
  Layer.provide(
    Layer.mergeAll(
      AuthFlowServiceLive,
      ModelExecutionServiceLive.pipe(Layer.provideMerge(PermissionServiceLive)),
    ),
  ),
);
