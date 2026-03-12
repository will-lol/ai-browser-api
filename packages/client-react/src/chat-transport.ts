import type {
  BridgeChatTransportOptions,
  BridgeClientApi,
} from "@llm-bridge/client";
import type { ChatTransport, UIMessage } from "ai";
import { useRef } from "react";

const TRANSPORT_UNAVAILABLE_ERROR = "Bridge chat transport is not ready yet.";

function getCurrentTransport(input: {
  transportRef: {
    current:
      | {
          client: BridgeClientApi | null;
          options: BridgeChatTransportOptions | undefined;
          transport: ChatTransport<UIMessage> | null;
        }
      | null;
  };
}) {
  const transport = input.transportRef.current?.transport;
  if (transport == null) {
    throw new Error(TRANSPORT_UNAVAILABLE_ERROR);
  }

  return transport;
}

// AI SDK useChat snapshots the initial transport, so keep one proxy object and
// forward each call to the latest bridge transport when the client becomes ready.
export function useBridgeChatTransportProxy(
  client: BridgeClientApi | null,
  options?: BridgeChatTransportOptions,
) {
  const currentTransportRef = useRef<{
    client: BridgeClientApi | null;
    options: BridgeChatTransportOptions | undefined;
    transport: ChatTransport<UIMessage> | null;
  } | null>(null);
  const proxyTransportRef = useRef<ChatTransport<UIMessage> | null>(null);

  if (
    currentTransportRef.current == null ||
    currentTransportRef.current.client !== client ||
    currentTransportRef.current.options !== options
  ) {
    currentTransportRef.current = {
      client,
      options,
      transport: client?.getChatTransport(options) ?? null,
    };
  }

  if (proxyTransportRef.current == null) {
    proxyTransportRef.current = {
      sendMessages: async (input) =>
        getCurrentTransport({
          transportRef: currentTransportRef,
        }).sendMessages(input),
      reconnectToStream: async (input) =>
        getCurrentTransport({
          transportRef: currentTransportRef,
        }).reconnectToStream(input),
    };
  }

  return proxyTransportRef.current;
}
