import type { BridgeChatTransportOptions } from "@llm-bridge/client";
import {
  useMutationResource,
  useQueryResourceRefresh,
  useQueryResourceState,
} from "@llm-bridge/reactive-core";
import { useMemo } from "react";
import { useStableBridgeChatTransport } from "./chat-transport";
import { useBridgeResources } from "./runtime";
import type {
  BridgeChatTransportState,
  BridgeConnectionState,
  BridgeModelState,
  BridgeModelsState,
  BridgePermissionRequestState,
} from "./types";

function toBridgeConnectionState(
  state: ReturnType<typeof useQueryResourceState<import("@llm-bridge/client").BridgeClientApi>>,
): BridgeConnectionState {
  return {
    ...state,
    client: state.value,
  };
}

export function useBridgeClient() {
  return useBridgeConnectionState().client;
}

export function useBridgeConnectionState(): BridgeConnectionState {
  const { clientResource } = useBridgeResources();
  return toBridgeConnectionState(useQueryResourceState(clientResource));
}

export function useBridgeModels(): BridgeModelsState {
  const { modelsResource } = useBridgeResources();
  const state = useQueryResourceState(modelsResource);
  const refresh = useQueryResourceRefresh(modelsResource);

  return {
    ...state,
    models: state.value ?? [],
    refresh,
  };
}

export function useBridgeModel(modelId: string): BridgeModelState {
  const { getModelResource } = useBridgeResources();
  const resource = useMemo(() => getModelResource(modelId), [getModelResource, modelId]);
  const state = useQueryResourceState(resource);
  const refresh = useQueryResourceRefresh(resource);

  return {
    ...state,
    model: state.value,
    refresh,
  };
}

export function useBridgeChatTransport(
  options?: BridgeChatTransportOptions,
): BridgeChatTransportState {
  const connection = useBridgeConnectionState();
  const transport = useStableBridgeChatTransport(connection.client, options);

  return {
    ...connection,
    transport,
    options,
  };
}

export function useBridgePermissionRequest(): BridgePermissionRequestState {
  const { requestPermissionResource } = useBridgeResources();
  const mutation = useMutationResource(requestPermissionResource);

  return {
    requestPermission: mutation.execute,
    error: mutation.error,
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
