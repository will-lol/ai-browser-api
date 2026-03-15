import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { toRuntimeStreamPart } from "@llm-bridge/bridge-codecs";
import { encodeSupportedUrls } from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { createLanguageModelAdapter } from "./model-adapter";
import type { BridgeConnection } from "./connection";

const activeConnections: Array<BridgeConnection> = [];

async function makeConnection(input: {
  modelDoStream: BridgeConnection["client"]["modelDoStream"];
}) {
  const scope = await Effect.runPromise(Scope.make());
  const channel = new MessageChannel();

  const connection = {
    connectionId: 1,
    scope,
    port: channel.port1,
    client: {
      modelDoStream: input.modelDoStream,
    } as BridgeConnection["client"],
  } satisfies BridgeConnection;

  activeConnections.push(connection);
  return connection;
}

async function cleanupConnections() {
  while (activeConnections.length > 0) {
    const connection = activeConnections.pop();
    if (!connection) {
      continue;
    }

    connection.port.close();
    await Effect.runPromise(
      Scope.close(connection.scope, Exit.succeed(undefined)),
    );
  }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 250,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for condition");
}

afterEach(async () => {
  await cleanupConnections();
});

describe("createLanguageModelAdapter", () => {
  it("aborts the model request on stream cancel and explicit abort", async () => {
    const streamCalls: Array<Record<string, unknown>> = [];
    const abortCalls = [] as Array<string>;
    const connection = await makeConnection({
      modelDoStream: ((input: Record<string, unknown>) => {
        streamCalls.push(input);
        return Stream.concat(
          Stream.make(
            toRuntimeStreamPart({
              type: "stream-start",
              warnings: [],
            }),
            toRuntimeStreamPart({
              type: "text-delta",
              id: "text-1",
              delta: "hello",
            }),
          ),
          Stream.never,
        );
      }) as BridgeConnection["client"]["modelDoStream"],
    });

    const model = createLanguageModelAdapter({
      modelId: "openai/gpt-4o-mini",
      descriptor: {
        specificationVersion: "v3",
        provider: "openai",
        modelId: "openai/gpt-4o-mini",
        supportedUrls: encodeSupportedUrls({}),
      },
      ensureConnection: Effect.succeed(connection),
      abortRequest: ({ requestId, sessionID }) =>
        Effect.sync(() => {
          abortCalls.push(`${requestId}:${sessionID}`);
        }),
      nextRequestId: () => `request-${abortCalls.length + 1}`,
    });

    const canceled = await model.doStream({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
        },
      ],
    });
    const canceledReader = canceled.stream.getReader();
    await canceledReader.cancel();

    assert.deepEqual(abortCalls, ["request-1:request-1"]);
    assert.equal("origin" in streamCalls[0]!, false);

    const controller = new AbortController();
    await model.doStream({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "hello again" }],
        },
      ],
      abortSignal: controller.signal,
    });

    controller.abort();
    await waitFor(() => abortCalls.length === 2);
    assert.deepEqual(abortCalls, [
      "request-1:request-1",
      "request-2:request-2",
    ]);
  });
});
