import type * as Rpc from "@effect/rpc/Rpc";
import type * as RpcSchema from "@effect/rpc/RpcSchema";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { RuntimeRpcClientConnection } from "./runtime-rpc-client-core";

export const RUNTIME_RPC_CONNECTION_INVALIDATED_MESSAGE =
  "Runtime connection was destroyed while connecting";

type IsStreamRpc<Current extends Rpc.Any> =
  [Rpc.SuccessSchema<Current>] extends [
    RpcSchema.Stream<infer _Success, infer _StreamError>,
  ]
    ? true
    : false;

export type UnaryRpcTag<Rpcs extends Rpc.Any> = Rpcs extends infer Current
  ? Current extends Rpc.Any
    ? IsStreamRpc<Current> extends true
      ? never
      : Current["_tag"]
    : never
  : never;

export type StreamRpcTag<Rpcs extends Rpc.Any> = Rpcs extends infer Current
  ? Current extends Rpc.Any
    ? IsStreamRpc<Current> extends true
      ? Current["_tag"]
      : never
    : never
  : never;

type MiddlewareFailureType<Middleware> = Middleware extends {
  readonly failure: { readonly Type: infer Type };
}
  ? Type
  : never;

type MiddlewareFailureContext<Middleware> = Middleware extends {
  readonly failure: { readonly Context: infer Context };
}
  ? Context
  : never;

type BoundRpcMethodForCurrent<Current extends Rpc.Any, E> =
  Current extends Rpc.Rpc<
    infer _Tag,
    infer PayloadSchema,
    infer SuccessSchema,
    infer ErrorSchema,
    infer Middleware
  >
    ? [SuccessSchema] extends [RpcSchema.Stream<infer Success, infer StreamError>]
      ? (
          payload: Rpc.PayloadConstructor<Current>,
        ) => Stream.Stream<
          Success["Type"],
          StreamError["Type"] |
            ErrorSchema["Type"] |
            E |
            MiddlewareFailureType<Middleware>,
          PayloadSchema["Context"] |
            SuccessSchema["Context"] |
            ErrorSchema["Context"] |
            MiddlewareFailureContext<Middleware>
        >
      : (
          payload: Rpc.PayloadConstructor<Current>,
        ) => Effect.Effect<
          SuccessSchema["Type"],
          ErrorSchema["Type"] | E | MiddlewareFailureType<Middleware>,
          PayloadSchema["Context"] |
            SuccessSchema["Context"] |
            ErrorSchema["Context"] |
            MiddlewareFailureContext<Middleware>
        >
    : never;

type BoundRpcMethod<
  Rpcs extends Rpc.Any,
  E,
  Key extends Rpcs["_tag"],
> = BoundRpcMethodForCurrent<Rpc.ExtractTag<Rpcs, Key>, E>;

type UnaryBoundRpcMethod<
  Rpcs extends Rpc.Any,
  E,
  Key extends UnaryRpcTag<Rpcs>,
> = Extract<
  BoundRpcMethod<Rpcs, E, Key>,
  (
    payload: Rpc.PayloadConstructor<Rpc.ExtractTag<Rpcs, Key>>,
  ) => Effect.Effect<unknown, unknown, unknown>
>;

type StreamBoundRpcMethod<
  Rpcs extends Rpc.Any,
  E,
  Key extends StreamRpcTag<Rpcs>,
> = Extract<
  BoundRpcMethod<Rpcs, E, Key>,
  (
    payload: Rpc.PayloadConstructor<Rpc.ExtractTag<Rpcs, Key>>,
  ) => Stream.Stream<unknown, unknown, unknown>
>;

type UnaryClientMethod<
  Rpcs extends Rpc.Any,
  Key extends UnaryRpcTag<Rpcs>,
> = Extract<
  RuntimeRpcClientConnection<Rpcs>[Key],
  (
    payload: Rpc.PayloadConstructor<Rpc.ExtractTag<Rpcs, Key>>,
  ) => Effect.Effect<unknown, unknown, unknown>
>;

type StreamClientMethod<
  Rpcs extends Rpc.Any,
  Key extends StreamRpcTag<Rpcs>,
> = Extract<
  RuntimeRpcClientConnection<Rpcs>[Key],
  (
    payload: Rpc.PayloadConstructor<Rpc.ExtractTag<Rpcs, Key>>,
  ) => Stream.Stream<unknown, unknown, unknown>
>;

export function bindRuntimeRpcUnaryMethodByKey<
  Rpcs extends Rpc.Any,
  E,
  Key extends UnaryRpcTag<Rpcs>,
>(
  ensureClient: Effect.Effect<RuntimeRpcClientConnection<Rpcs>, E>,
  key: Key,
): UnaryBoundRpcMethod<Rpcs, E, Key> {
  return ((payload: Rpc.PayloadConstructor<Rpc.ExtractTag<Rpcs, Key>>) =>
    Effect.flatMap(ensureClient, (client) =>
      (client[key] as UnaryClientMethod<Rpcs, Key>)(payload),
    )) as UnaryBoundRpcMethod<Rpcs, E, Key>;
}

export function bindRuntimeRpcStreamMethodByKey<
  Rpcs extends Rpc.Any,
  E,
  Key extends StreamRpcTag<Rpcs>,
>(
  ensureClient: Effect.Effect<RuntimeRpcClientConnection<Rpcs>, E>,
  key: Key,
): StreamBoundRpcMethod<Rpcs, E, Key> {
  return ((payload: Rpc.PayloadConstructor<Rpc.ExtractTag<Rpcs, Key>>) =>
    Stream.unwrap(
      Effect.map(ensureClient, (client) =>
        (client[key] as StreamClientMethod<Rpcs, Key>)(payload),
      ),
    )) as StreamBoundRpcMethod<Rpcs, E, Key>;
}
