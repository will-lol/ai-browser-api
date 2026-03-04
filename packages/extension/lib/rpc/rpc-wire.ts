import type { FromClient, FromServer } from "@effect/rpc/RpcMessage"
import type * as Rpc from "@effect/rpc/Rpc"

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null
}

function isFromClientMessage<Rpcs extends Rpc.Any>(input: unknown): input is FromClient<Rpcs> {
  if (!isRecord(input) || typeof input._tag !== "string") {
    return false
  }

  switch (input._tag) {
    case "Request":
      return typeof input.id === "bigint" && typeof input.tag === "string" && "headers" in input
    case "Ack":
      return typeof input.requestId === "bigint"
    case "Interrupt":
      return typeof input.requestId === "bigint" && Array.isArray(input.interruptors)
    case "Eof":
      return true
    default:
      return false
  }
}

function isFromServerMessage<Rpcs extends Rpc.Any>(input: unknown): input is FromServer<Rpcs> {
  if (!isRecord(input) || typeof input._tag !== "string") {
    return false
  }

  switch (input._tag) {
    case "Chunk":
      return typeof input.clientId === "number" && typeof input.requestId === "bigint" && Array.isArray(input.values)
    case "Exit":
      return typeof input.clientId === "number" && typeof input.requestId === "bigint" && "exit" in input
    case "Defect":
      return typeof input.clientId === "number" && "defect" in input
    case "ClientEnd":
      return typeof input.clientId === "number"
    default:
      return false
  }
}

export function encodeClientMessage<Rpcs extends Rpc.Any>(message: FromClient<Rpcs>): FromClient<Rpcs> {
  return message
}

export function decodeClientMessage<Rpcs extends Rpc.Any>(encoded: unknown): FromClient<Rpcs> | undefined {
  return isFromClientMessage<Rpcs>(encoded) ? encoded : undefined
}

export function encodeServerMessage<Rpcs extends Rpc.Any>(message: FromServer<Rpcs>): FromServer<Rpcs> {
  return message
}

export function decodeServerMessage<Rpcs extends Rpc.Any>(encoded: unknown): FromServer<Rpcs> | undefined {
  return isFromServerMessage<Rpcs>(encoded) ? encoded : undefined
}
