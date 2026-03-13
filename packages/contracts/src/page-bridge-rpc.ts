export {
  RuntimePublicRpcGroup as PageBridgeRpcGroup,
  type RuntimePublicRpc as PageBridgeRpc,
} from "./runtime-rpc";

export const PAGE_BRIDGE_READY_EVENT = "llm-bridge-ready";
export const PAGE_BRIDGE_INIT_MESSAGE = "llm-bridge-init-v2";
export const PAGE_BRIDGE_PORT_CONTROL_MESSAGE = "llm-bridge-port-control-v1";

export type PageBridgePortControlMessage = {
  readonly _tag: typeof PAGE_BRIDGE_PORT_CONTROL_MESSAGE;
  readonly type: "disconnect";
  readonly reason?: string;
  readonly connectionId?: number;
};

export function isPageBridgePortControlMessage(
  value: unknown,
): value is PageBridgePortControlMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (
    record._tag !== PAGE_BRIDGE_PORT_CONTROL_MESSAGE ||
    record.type !== "disconnect"
  ) {
    return false;
  }

  if (
    "reason" in record &&
    record.reason !== undefined &&
    typeof record.reason !== "string"
  ) {
    return false;
  }

  if (
    "connectionId" in record &&
    record.connectionId !== undefined &&
    typeof record.connectionId !== "number"
  ) {
    return false;
  }

  return true;
}
