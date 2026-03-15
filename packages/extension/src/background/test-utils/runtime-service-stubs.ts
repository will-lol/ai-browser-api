import {
  AuthFlowService,
  type AppRuntime,
  CatalogService,
  ChatExecutionService,
  MetaService,
  ModelExecutionService,
  PermissionsService,
  type AuthFlowServiceApi,
  type CatalogServiceApi,
  type ChatExecutionServiceApi,
  type MetaServiceApi,
  type ModelExecutionServiceApi,
  type PermissionsServiceApi,
} from "@llm-bridge/runtime-core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

type RuntimeServiceName =
  | "catalog"
  | "permissions"
  | "authFlow"
  | "meta"
  | "modelExecution"
  | "chatExecution";

type RuntimeServiceByName = {
  catalog: CatalogService;
  permissions: PermissionsService;
  authFlow: AuthFlowService;
  meta: MetaService;
  modelExecution: ModelExecutionService;
  chatExecution: ChatExecutionService;
};

type RuntimeServicesForNames<Names extends ReadonlyArray<RuntimeServiceName>> =
  Names[number] extends never ? never : RuntimeServiceByName[Names[number]];

type RuntimeServiceOverrides = {
  catalog?: Partial<CatalogServiceApi>;
  permissions?: Partial<PermissionsServiceApi>;
  authFlow?: Partial<AuthFlowServiceApi>;
  meta?: Partial<MetaServiceApi>;
  modelExecution?: Partial<ModelExecutionServiceApi>;
  chatExecution?: Partial<ChatExecutionServiceApi>;
};

type MakeUnusedRuntimeLayerInput = {
  omit?: ReadonlyArray<RuntimeServiceName>;
  overrides?: RuntimeServiceOverrides;
};

function makeCatalogService(overrides?: Partial<CatalogServiceApi>) {
  return {
    ensureCatalog: () => Effect.die("unused"),
    refreshCatalog: () => Effect.die("unused"),
    refreshCatalogForProvider: () => Effect.die("unused"),
    listProviders: () => Effect.die("unused"),
    streamProviders: () => Stream.empty,
    listModels: () => Effect.die("unused"),
    streamModels: () => Stream.empty,
    ...(overrides ?? {}),
  } satisfies CatalogServiceApi;
}

function makePermissionsService(overrides?: Partial<PermissionsServiceApi>) {
  return {
    getOriginState: () => Effect.die("unused"),
    streamOriginState: () => Stream.empty,
    listPermissions: () => Effect.die("unused"),
    streamPermissions: () => Stream.empty,
    getModelPermission: () => Effect.die("unused"),
    setOriginEnabled: () => Effect.die("unused"),
    setModelPermission: () => Effect.die("unused"),
    createPermissionRequest: () => Effect.die("unused"),
    resolvePermissionRequest: () => Effect.die("unused"),
    dismissPermissionRequest: () => Effect.die("unused"),
    listPending: () => Effect.die("unused"),
    streamPending: () => Stream.empty,
    waitForPermissionDecision: () => Effect.die("unused"),
    streamOriginStates: () => Stream.empty,
    streamPermissionsMap: () => Stream.empty,
    streamPendingMap: () => Stream.empty,
    ...(overrides ?? {}),
  } satisfies PermissionsServiceApi;
}

function makeAuthFlowService(overrides?: Partial<AuthFlowServiceApi>) {
  return {
    openProviderAuthWindow: () => Effect.die("unused"),
    getProviderAuthFlow: () => Effect.die("unused"),
    streamProviderAuthFlow: () => Stream.empty,
    startProviderAuthFlow: () => Effect.die("unused"),
    cancelProviderAuthFlow: () => Effect.die("unused"),
    disconnectProvider: () => Effect.die("unused"),
    ...(overrides ?? {}),
  } satisfies AuthFlowServiceApi;
}

function makeMetaService(overrides?: Partial<MetaServiceApi>) {
  return {
    parseProviderModel: () => ({
      providerID: "unused",
      modelID: "unused",
    }),
    resolvePermissionTarget: () => Effect.die("unused"),
    ...(overrides ?? {}),
  } satisfies MetaServiceApi;
}

function makeModelExecutionService(overrides?: Partial<ModelExecutionServiceApi>) {
  return {
    acquireModel: () => Effect.die("unused"),
    generateModel: () => Effect.die("unused"),
    streamModel: () => Effect.die("unused"),
    ...(overrides ?? {}),
  } satisfies ModelExecutionServiceApi;
}

function makeChatExecutionService(overrides?: Partial<ChatExecutionServiceApi>) {
  return {
    sendMessages: () => Effect.die("unused"),
    reconnectStream: () => Effect.die("unused"),
    abortStream: () => Effect.die("unused"),
    ...(overrides ?? {}),
  } satisfies ChatExecutionServiceApi;
}

export function makeUnusedRuntimeLayer<
  const OmittedNames extends ReadonlyArray<RuntimeServiceName> = readonly [],
>(
  input: MakeUnusedRuntimeLayerInput & {
    omit?: OmittedNames;
  } = {},
): Layer.Layer<AppRuntime, never, RuntimeServicesForNames<OmittedNames>> {
  const omitted = new Set(input.omit ?? []);
  const overrides = input.overrides ?? {};

  const catalogLayer = omitted.has("catalog")
    ? Layer.service(CatalogService)
    : Layer.succeed(CatalogService, makeCatalogService(overrides.catalog));
  const permissionsLayer = omitted.has("permissions")
    ? Layer.service(PermissionsService)
    : Layer.succeed(
        PermissionsService,
        makePermissionsService(overrides.permissions),
      );
  const authFlowLayer = omitted.has("authFlow")
    ? Layer.service(AuthFlowService)
    : Layer.succeed(AuthFlowService, makeAuthFlowService(overrides.authFlow));
  const metaLayer = omitted.has("meta")
    ? Layer.service(MetaService)
    : Layer.succeed(MetaService, makeMetaService(overrides.meta));
  const modelExecutionLayer = omitted.has("modelExecution")
    ? Layer.service(ModelExecutionService)
    : Layer.succeed(
        ModelExecutionService,
        makeModelExecutionService(overrides.modelExecution),
      );
  const chatExecutionLayer = omitted.has("chatExecution")
    ? Layer.service(ChatExecutionService)
    : Layer.succeed(
        ChatExecutionService,
        makeChatExecutionService(overrides.chatExecution),
      );

  return Layer.mergeAll(
    catalogLayer,
    permissionsLayer,
    authFlowLayer,
    metaLayer,
    modelExecutionLayer,
    chatExecutionLayer,
  ) as Layer.Layer<AppRuntime, never, RuntimeServicesForNames<OmittedNames>>;
}
