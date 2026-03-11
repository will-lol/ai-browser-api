import * as Effect from "effect/Effect";
import {
  combineQueryStates,
  createQueryResource,
  useQueryResourceState,
} from "@llm-bridge/reactive-core";
import {
  fetchModels,
  fetchOriginState,
  fetchPendingRequests,
  fetchPermissions,
  fetchProviderAuthFlow,
  fetchProviders,
} from "@/app/api/runtime-api";
import { extensionReactiveRuntime } from "@/app/state/atom-runtime";
import { runtimeReactivityKeys } from "@/app/state/runtime-reactivity";

const providersResource = createQueryResource(extensionReactiveRuntime, {
  key: runtimeReactivityKeys.providers,
  load: fetchProviders(),
});

function buildModelsResource(input?: {
  connectedOnly?: boolean;
  providerID?: string;
}) {
  return createQueryResource(extensionReactiveRuntime, {
    key: runtimeReactivityKeys.models,
    load: fetchModels({
      connectedOnly: input?.connectedOnly,
      providerID: input?.providerID,
    }),
  });
}

function buildProviderAuthFlowResource(providerID: string) {
  return createQueryResource(extensionReactiveRuntime, {
    key: runtimeReactivityKeys.authFlow(providerID),
    load: fetchProviderAuthFlow({
      providerID,
    }).pipe(Effect.map((response) => response.result)),
  });
}

function buildOriginStateResource(origin: string) {
  return createQueryResource(extensionReactiveRuntime, {
    key: runtimeReactivityKeys.origin(origin),
    load: fetchOriginState(origin),
  });
}

function buildPermissionsResource(origin: string) {
  return createQueryResource(extensionReactiveRuntime, {
    key: runtimeReactivityKeys.permissions(origin),
    load: fetchPermissions(origin),
  });
}

function buildPendingRequestsResource(origin: string) {
  return createQueryResource(extensionReactiveRuntime, {
    key: runtimeReactivityKeys.pending(origin),
    load: fetchPendingRequests(origin),
  });
}

const modelsResources = new Map<string, ReturnType<typeof buildModelsResource>>();
const providerAuthFlowResources = new Map<
  string,
  ReturnType<typeof buildProviderAuthFlowResource>
>();
const originStateResources = new Map<
  string,
  ReturnType<typeof buildOriginStateResource>
>();
const permissionsResources = new Map<
  string,
  ReturnType<typeof buildPermissionsResource>
>();
const pendingRequestsResources = new Map<
  string,
  ReturnType<typeof buildPendingRequestsResource>
>();

function modelResourceKey(input?: {
  connectedOnly?: boolean;
  providerID?: string;
}) {
  return `${input?.connectedOnly === true ? "connected" : "all"}:${input?.providerID ?? ""}`;
}

function getModelsResource(input?: {
  connectedOnly?: boolean;
  providerID?: string;
}): ReturnType<typeof buildModelsResource> {
  const key = modelResourceKey(input);
  const cached = modelsResources.get(key);
  if (cached) {
    return cached;
  }

  const resource = buildModelsResource(input);
  modelsResources.set(key, resource);
  return resource;
}

function getProviderAuthFlowResource(
  providerID: string,
): ReturnType<typeof buildProviderAuthFlowResource> {
  const cached = providerAuthFlowResources.get(providerID);
  if (cached) {
    return cached;
  }

  const resource = buildProviderAuthFlowResource(providerID);
  providerAuthFlowResources.set(providerID, resource);
  return resource;
}

function getOriginStateResource(
  origin: string,
): ReturnType<typeof buildOriginStateResource> {
  const cached = originStateResources.get(origin);
  if (cached) {
    return cached;
  }

  const resource = buildOriginStateResource(origin);
  originStateResources.set(origin, resource);
  return resource;
}

function getPermissionsResource(
  origin: string,
): ReturnType<typeof buildPermissionsResource> {
  const cached = permissionsResources.get(origin);
  if (cached) {
    return cached;
  }

  const resource = buildPermissionsResource(origin);
  permissionsResources.set(origin, resource);
  return resource;
}

function getPendingRequestsResource(
  origin: string,
): ReturnType<typeof buildPendingRequestsResource> {
  const cached = pendingRequestsResources.get(origin);
  if (cached) {
    return cached;
  }

  const resource = buildPendingRequestsResource(origin);
  pendingRequestsResources.set(origin, resource);
  return resource;
}

export function useProvidersState() {
  return useQueryResourceState(providersResource);
}

export function useProviderConnectData(providerID: string) {
  return combineQueryStates({
    providers: useQueryResourceState(providersResource),
    authFlow: useQueryResourceState(getProviderAuthFlowResource(providerID)),
  });
}

export function useFloatingPermissionData(origin: string) {
  return combineQueryStates({
    originState: useQueryResourceState(getOriginStateResource(origin)),
    pendingRequests: useQueryResourceState(getPendingRequestsResource(origin)),
  });
}

export function useSitePermissionsData(origin: string) {
  return combineQueryStates({
    originState: useQueryResourceState(getOriginStateResource(origin)),
    models: useQueryResourceState(
      getModelsResource({
        connectedOnly: true,
      }),
    ),
    permissions: useQueryResourceState(getPermissionsResource(origin)),
    pendingRequests: useQueryResourceState(getPendingRequestsResource(origin)),
  });
}
