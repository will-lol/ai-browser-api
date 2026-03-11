import type {
  BridgeChatTransportOptions,
  BridgeClientApi,
} from "@llm-bridge/client";
import type { ChatTransport, UIMessage } from "ai";
import { useRef } from "react";

const unavailableChatTransport: ChatTransport<UIMessage> = {
  sendMessages: async () => {
    throw new Error("Bridge chat transport is not ready yet.");
  },
  reconnectToStream: async () => null,
};

export function useStableBridgeChatTransport(
  client: BridgeClientApi | null,
  options?: BridgeChatTransportOptions,
) {
  const transportRef = useRef<{
    client: BridgeClientApi | null;
    options: BridgeChatTransportOptions | undefined;
    transport: ChatTransport<UIMessage>;
  } | null>(null);

  if (
    transportRef.current == null ||
    transportRef.current.client !== client ||
    transportRef.current.options !== options
  ) {
    transportRef.current = {
      client,
      options,
      transport: client?.getChatTransport(options) ?? unavailableChatTransport,
    };
  }

  return transportRef.current.transport;
}
