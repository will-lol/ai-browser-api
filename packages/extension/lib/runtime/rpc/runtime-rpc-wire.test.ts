import assert from "node:assert/strict"
import { describe, it } from "node:test"
import * as Headers from "@effect/platform/Headers"
import { RequestId, type FromClient, type FromServer } from "@effect/rpc/RpcMessage"
import { RuntimeValidationError, type RuntimeRpcError } from "@llm-bridge/contracts"
import { type RuntimeRpc } from "@llm-bridge/contracts"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import * as FiberId from "effect/FiberId"
import {
  fromRuntimeRpcClientWireMessage,
  fromRuntimeRpcServerWireMessage,
  toRuntimeRpcClientWireMessage,
  toRuntimeRpcServerWireMessage,
} from "@/lib/runtime/rpc/runtime-rpc-wire"

type RuntimeRequestMessage = Extract<FromClient<RuntimeRpc>, { readonly _tag: "Request" }>
type RuntimeAckMessage = Extract<FromClient<RuntimeRpc>, { readonly _tag: "Ack" }>
type RuntimeInterruptMessage = Extract<FromClient<RuntimeRpc>, { readonly _tag: "Interrupt" }>
type RuntimeChunkMessage = Extract<FromServer<RuntimeRpc>, { readonly _tag: "Chunk" }>
type RuntimeExitMessage = Extract<FromServer<RuntimeRpc>, { readonly _tag: "Exit" }>

const requestMessage: RuntimeRequestMessage = {
  _tag: "Request",
  id: RequestId("11"),
  tag: "listModels",
  payload: {
    origin: "https://example.com",
    connectedOnly: true,
    providerID: "openai",
  },
  headers: Headers.fromInput({ "x-test": "1" }),
}

const ackMessage: RuntimeAckMessage = {
  _tag: "Ack",
  requestId: RequestId("12"),
}

const interruptMessage: RuntimeInterruptMessage = {
  _tag: "Interrupt",
  requestId: RequestId("13"),
  interruptors: [FiberId.none],
}

const chunkMessage = {
  _tag: "Chunk",
  clientId: 7,
  requestId: RequestId("14"),
  values: [
    {
      type: "stream-start",
      warnings: [],
    },
  ],
} as unknown as RuntimeChunkMessage

const exitMessage: RuntimeExitMessage = {
  _tag: "Exit",
  clientId: 8,
  requestId: RequestId("15"),
  exit: Exit.succeed({
    origin: "https://example.com",
    enabled: true,
  }),
}

describe("runtime rpc wire bigint transforms", () => {
  it("encodes and decodes client message bigint fields", () => {
    const encodedRequest = toRuntimeRpcClientWireMessage(requestMessage)
    const encodedAck = toRuntimeRpcClientWireMessage(ackMessage)
    const encodedInterrupt = toRuntimeRpcClientWireMessage(interruptMessage)

    assert.equal(encodedRequest._tag, "Request")
    assert.equal(encodedAck._tag, "Ack")
    assert.equal(encodedInterrupt._tag, "Interrupt")

    assert.equal(typeof encodedRequest.id, "string")
    assert.equal(typeof encodedAck.requestId, "string")
    assert.equal(typeof encodedInterrupt.requestId, "string")

    const decodedRequest = fromRuntimeRpcClientWireMessage(encodedRequest)
    const decodedAck = fromRuntimeRpcClientWireMessage(encodedAck)
    const decodedInterrupt = fromRuntimeRpcClientWireMessage(encodedInterrupt)

    assert.equal(decodedRequest._tag, "Request")
    assert.equal(decodedAck._tag, "Ack")
    assert.equal(decodedInterrupt._tag, "Interrupt")

    assert.equal(typeof decodedRequest.id, "bigint")
    assert.equal(typeof decodedAck.requestId, "bigint")
    assert.equal(typeof decodedInterrupt.requestId, "bigint")
    assert.equal(decodedRequest.id, requestMessage.id)
    assert.equal(decodedAck.requestId, ackMessage.requestId)
    assert.equal(decodedInterrupt.requestId, interruptMessage.requestId)
  })

  it("encodes and decodes server message bigint fields", () => {
    const encodedChunk = toRuntimeRpcServerWireMessage(chunkMessage)
    const encodedExit = toRuntimeRpcServerWireMessage(exitMessage)

    assert.equal(encodedChunk._tag, "Chunk")
    assert.equal(encodedExit._tag, "Exit")

    assert.equal(typeof encodedChunk.requestId, "string")
    assert.equal(typeof encodedExit.requestId, "string")

    const decodedChunk = fromRuntimeRpcServerWireMessage(encodedChunk)
    const decodedExit = fromRuntimeRpcServerWireMessage(encodedExit)

    assert.equal(decodedChunk._tag, "Chunk")
    assert.equal(decodedExit._tag, "Exit")

    assert.equal(typeof decodedChunk.requestId, "bigint")
    assert.equal(typeof decodedExit.requestId, "bigint")
    assert.equal(decodedChunk.requestId, chunkMessage.requestId)
    assert.equal(decodedExit.requestId, exitMessage.requestId)
  })

  it("rehydrates structured-cloned exit envelopes into real Effect exits", () => {
    const successWire = structuredClone(toRuntimeRpcServerWireMessage(exitMessage))
    const successDecoded = fromRuntimeRpcServerWireMessage(successWire)

    assert.equal(successDecoded._tag, "Exit")
    assert.equal(Exit.isExit(successDecoded.exit), true)
    assert.equal(successDecoded.exit._tag, "Success")
    if (successDecoded.exit._tag === "Success") {
      assert.deepEqual(successDecoded.exit.value, {
        origin: "https://example.com",
        enabled: true,
      })
    }

    const failureWire = structuredClone(
      toRuntimeRpcServerWireMessage({
        _tag: "Exit",
        clientId: 9,
        requestId: RequestId("16"),
        exit: Exit.failCause(
          Cause.fail(
            new RuntimeValidationError({
              message: "boom",
            }) as RuntimeRpcError,
          ),
        ),
      } as unknown as RuntimeExitMessage),
    )

    const failureDecoded = fromRuntimeRpcServerWireMessage(failureWire)
    assert.equal(failureDecoded._tag, "Exit")
    assert.equal(Exit.isExit(failureDecoded.exit), true)
    assert.equal(failureDecoded.exit._tag, "Failure")
  })

  it("produces JSON-safe wire messages", () => {
    const encodedMessages = [
      toRuntimeRpcClientWireMessage(requestMessage),
      toRuntimeRpcClientWireMessage(ackMessage),
      toRuntimeRpcClientWireMessage(interruptMessage),
      toRuntimeRpcServerWireMessage(chunkMessage),
      toRuntimeRpcServerWireMessage(exitMessage),
    ]

    for (const message of encodedMessages) {
      assert.doesNotThrow(() => {
        JSON.stringify(message)
      })
    }
  })
})
