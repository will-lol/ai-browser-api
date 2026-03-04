import type { FromClient, FromServer } from "@effect/rpc/RpcMessage"
import { type RuntimeRpc } from "@llm-bridge/contracts"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"

type ReplaceField<T, K extends keyof T, V> = Omit<T, K> & { readonly [P in K]: V }

type RuntimeRpcRequestMessage = Extract<FromClient<RuntimeRpc>, { readonly _tag: "Request" }>
type RuntimeRpcAckMessage = Extract<FromClient<RuntimeRpc>, { readonly _tag: "Ack" }>
type RuntimeRpcInterruptMessage = Extract<FromClient<RuntimeRpc>, { readonly _tag: "Interrupt" }>
type RuntimeRpcChunkMessage = Extract<FromServer<RuntimeRpc>, { readonly _tag: "Chunk" }>
type RuntimeRpcExitMessage = Extract<FromServer<RuntimeRpc>, { readonly _tag: "Exit" }>
type RuntimeRpcExitWireMessage = Omit<RuntimeRpcExitMessage, "requestId" | "exit"> & {
  readonly requestId: string
  readonly exit: unknown
}

export type RuntimeRpcClientWireMessage =
  | ReplaceField<RuntimeRpcRequestMessage, "id", string>
  | ReplaceField<RuntimeRpcAckMessage, "requestId", string>
  | ReplaceField<RuntimeRpcInterruptMessage, "requestId", string>
  | Exclude<FromClient<RuntimeRpc>, RuntimeRpcRequestMessage | RuntimeRpcAckMessage | RuntimeRpcInterruptMessage>

export type RuntimeRpcServerWireMessage =
  | ReplaceField<RuntimeRpcChunkMessage, "requestId", string>
  | RuntimeRpcExitWireMessage
  | Exclude<FromServer<RuntimeRpc>, RuntimeRpcChunkMessage | RuntimeRpcExitMessage>

const encodeBigInt = Schema.encodeSync(Schema.BigInt)
const decodeBigInt = Schema.decodeUnknownSync(Schema.BigInt)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function rehydrateExit(value: unknown): RuntimeRpcExitMessage["exit"] {
  if (Exit.isExit(value)) {
    return value as RuntimeRpcExitMessage["exit"]
  }

  if (isRecord(value) && value._tag === "Success") {
    return Exit.succeed(value.effect_instruction_i0 ?? value.value) as RuntimeRpcExitMessage["exit"]
  }

  if (isRecord(value) && value._tag === "Failure") {
    const cause = value.effect_instruction_i0 ?? value.cause
    if (Cause.isCause(cause)) {
      return Exit.failCause(cause) as RuntimeRpcExitMessage["exit"]
    }
    return Exit.die(cause) as RuntimeRpcExitMessage["exit"]
  }

  return Exit.die(value) as RuntimeRpcExitMessage["exit"]
}

export function toRuntimeRpcClientWireMessage(message: FromClient<RuntimeRpc>): RuntimeRpcClientWireMessage {
  switch (message._tag) {
    case "Request":
      return {
        ...message,
        id: encodeBigInt(message.id),
      }
    case "Ack":
      return {
        ...message,
        requestId: encodeBigInt(message.requestId),
      }
    case "Interrupt":
      return {
        ...message,
        requestId: encodeBigInt(message.requestId),
      }
    default:
      return message
  }
}

export function fromRuntimeRpcClientWireMessage(message: RuntimeRpcClientWireMessage): FromClient<RuntimeRpc> {
  switch (message._tag) {
    case "Request":
      return {
        ...message,
        id: decodeBigInt(message.id),
      } as FromClient<RuntimeRpc>
    case "Ack":
      return {
        ...message,
        requestId: decodeBigInt(message.requestId),
      } as FromClient<RuntimeRpc>
    case "Interrupt":
      return {
        ...message,
        requestId: decodeBigInt(message.requestId),
      } as FromClient<RuntimeRpc>
    default:
      return message
  }
}

export function toRuntimeRpcServerWireMessage(message: FromServer<RuntimeRpc>): RuntimeRpcServerWireMessage {
  switch (message._tag) {
    case "Chunk":
      return {
        ...message,
        requestId: encodeBigInt(message.requestId),
      }
    case "Exit":
      return {
        ...message,
        requestId: encodeBigInt(message.requestId),
      }
    default:
      return message
  }
}

export function fromRuntimeRpcServerWireMessage(message: RuntimeRpcServerWireMessage): FromServer<RuntimeRpc> {
  switch (message._tag) {
    case "Chunk":
      return {
        ...message,
        requestId: decodeBigInt(message.requestId),
      } as FromServer<RuntimeRpc>
    case "Exit":
      return {
        ...message,
        requestId: decodeBigInt(message.requestId),
        exit: rehydrateExit(message.exit),
      } as FromServer<RuntimeRpc>
    default:
      return message
  }
}
