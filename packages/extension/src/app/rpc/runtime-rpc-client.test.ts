import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "bun:test";
import type {
  RuntimeAdminRpc,
  RuntimeValidationError,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { RuntimeRpcClientConnection } from "@/shared/rpc/runtime-rpc-client-core";

let ensureClient: Effect.Effect<
  RuntimeRpcClientConnection<RuntimeAdminRpc>,
  RuntimeValidationError
>;

mock.module("@/shared/rpc/runtime-rpc-client-core", () => ({
  makeRuntimeRpcClientCore: () => ({
    get ensureClient() {
      return ensureClient;
    },
  }),
}));

const { getRuntimeAdminRPC } = await import("./runtime-rpc-client");

function createAdminClient(overrides?: {
  readonly listProviders?: (
    payload: Record<string, unknown>,
  ) => Effect.Effect<
    ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly connected: boolean;
      readonly env: ReadonlyArray<string>;
      readonly modelCount: number;
    }>
  >;
  readonly streamProviders?: (
    payload: Record<string, unknown>,
  ) => Stream.Stream<
    ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly connected: boolean;
      readonly env: ReadonlyArray<string>;
      readonly modelCount: number;
    }>
  >;
}) {
  return {
    listModels: () => Effect.succeed([]),
    getOriginState: () => Effect.die("unused"),
    listPending: () => Effect.die("unused"),
    acquireModel: () => Effect.die("unused"),
    modelDoGenerate: () => Effect.die("unused"),
    modelDoStream: () => Stream.empty,
    abortModelCall: () => Effect.void,
    chatSendMessages: () => Stream.empty,
    chatReconnectStream: () => Stream.empty,
    abortChatStream: () => Effect.void,
    listProviders:
      overrides?.listProviders ??
      (() =>
        Effect.succeed([
          {
            id: "provider-default",
            name: "Provider Default",
            connected: true,
            env: [],
            modelCount: 1,
          },
        ])),
    listConnectedModels: () => Effect.die("unused"),
    listPermissions: () => Effect.die("unused"),
    openProviderAuthWindow: () => Effect.die("unused"),
    getProviderAuthFlow: () => Effect.die("unused"),
    startProviderAuthFlow: () => Effect.die("unused"),
    cancelProviderAuthFlow: () => Effect.die("unused"),
    disconnectProvider: () => Effect.die("unused"),
    createPermissionRequest: () => Effect.die("unused"),
    setOriginEnabled: () => Effect.die("unused"),
    setModelPermission: () => Effect.die("unused"),
    resolvePermissionRequest: () => Effect.die("unused"),
    dismissPermissionRequest: () => Effect.die("unused"),
    streamProviders:
      overrides?.streamProviders ??
      (() =>
        Stream.make([
          {
            id: "provider-default",
            name: "Provider Default",
            connected: true,
            env: [],
            modelCount: 1,
          },
        ])),
    streamModels: () => Stream.empty,
    streamOriginState: () => Stream.empty,
    streamPermissions: () => Stream.empty,
    streamPending: () => Stream.empty,
    streamProviderAuthFlow: () => Stream.empty,
  } as unknown as RuntimeRpcClientConnection<RuntimeAdminRpc>;
}

beforeEach(() => {
  ensureClient = Effect.succeed(createAdminClient());
});

describe("getRuntimeAdminRPC", () => {
  it("exposes admin-only methods", () => {
    const runtime = getRuntimeAdminRPC();

    assert.equal(typeof runtime.streamProviders, "function");
    assert.equal(typeof runtime.openProviderAuthWindow, "function");
  });

  it("forwards unary and stream methods through the shared facade binder", async () => {
    const listProvidersCalls: Array<Record<string, unknown>> = [];
    const streamProvidersCalls: Array<Record<string, unknown>> = [];

    ensureClient = Effect.succeed(
      createAdminClient({
        listProviders: (payload) =>
          Effect.sync(() => {
            listProvidersCalls.push(payload);
            return [
              {
                id: "provider-a",
                name: "Provider A",
                connected: true,
                env: [],
                modelCount: 1,
              },
            ];
          }),
        streamProviders: (payload) =>
          Stream.sync(() => {
            streamProvidersCalls.push(payload);
            return [
              {
                id: "provider-b",
                name: "Provider B",
                connected: true,
                env: [],
                modelCount: 2,
              },
            ];
          }),
      }),
    );

    const runtime = getRuntimeAdminRPC();
    const providers = await Effect.runPromise(runtime.listProviders({}));
    const streamed = await Effect.runPromise(
      Stream.runCollect(runtime.streamProviders({})),
    );

    assert.deepEqual(providers, [
      {
        id: "provider-a",
        name: "Provider A",
        connected: true,
        env: [],
        modelCount: 1,
      },
    ]);
    assert.deepEqual(Array.from(streamed), [
      [
        {
          id: "provider-b",
          name: "Provider B",
          connected: true,
          env: [],
          modelCount: 2,
        },
      ],
    ]);
    assert.deepEqual(listProvidersCalls, [{}]);
    assert.deepEqual(streamProvidersCalls, [{}]);
  });
});
