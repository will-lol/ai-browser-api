import {
  useChat as useAiChat,
  type UIMessage,
} from "@ai-sdk/react";
import type { BridgeChatTransportOptions } from "@llm-bridge/client";
import {
  useMutationResource,
  useQueryResourceRefresh,
  useQueryResourceState,
} from "@llm-bridge/reactive-core";
import type { ChatTransport } from "ai";
import { useMemo } from "react";
import { useBridgeChatTransportProxy } from "./chat-transport";
import { useBridgeResources } from "./runtime";
import type {
  BridgeConnectionState,
  BridgeModelState,
  BridgeModelsState,
  BridgePermissionRequestState,
  UseChatHelpers,
  UseChatOptions,
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

  return {
    ...state,
    models: state.value ?? [],
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

export function useChat<UI_MESSAGE extends UIMessage = UIMessage>({
  transportOptions,
  ...options
}: UseChatOptions<UI_MESSAGE> = {}): UseChatHelpers<UI_MESSAGE> {
  const connection = useBridgeConnectionState();
  const transport = useBridgeChatTransportProxy(
    connection.client,
    transportOptions as BridgeChatTransportOptions | undefined,
  ) as ChatTransport<UI_MESSAGE>;
  const chat = useAiChat<UI_MESSAGE>({
    ...options,
    transport,
  });

  return {
    ...chat,
    isReady: connection.isReady,
    isLoading: connection.isLoading,
    hasError: connection.hasError,
    transportError: connection.error,
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
