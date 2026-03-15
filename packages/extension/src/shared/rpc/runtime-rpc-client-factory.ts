import type * as Rpc from "@effect/rpc/Rpc";
import type * as RpcSchema from "@effect/rpc/RpcSchema";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { RuntimeRpcClientConnection } from "./runtime-rpc-client-core";

export const RUNTIME_RPC_CONNECTION_INVALIDATED_MESSAGE =
  "Runtime connection was destroyed while connecting";

export type UnaryRpcTag<Rpcs extends Rpc.Any> = Rpcs extends infer Current
  ? Current extends Rpc.Any
    ? Rpc.SuccessSchema<Current> extends RpcSchema.Stream<any, any>
      ? never
      : Current["_tag"]
    : never
  : never;

export type StreamRpcTag<Rpcs extends Rpc.Any> = Rpcs extends infer Current
  ? Current extends Rpc.Any
    ? Rpc.SuccessSchema<Current> extends RpcSchema.Stream<any, any>
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

export function bindRuntimeRpcUnaryMethodByKey<
  Rpcs extends Rpc.Any,
  E,
  Key extends UnaryRpcTag<Rpcs>,
>(
  ensureClient: Effect.Effect<RuntimeRpcClientConnection<Rpcs>, E>,
  key: Key,
): BoundRpcMethod<Rpcs, E, Key> {
  return ((payload: Rpc.PayloadConstructor<Rpc.ExtractTag<Rpcs, Key>>) =>
    Effect.flatMap(ensureClient, (client) =>
      (
        client[key] as (
          input: Rpc.PayloadConstructor<Rpc.ExtractTag<Rpcs, Key>>,
        ) => Effect.Effect<any, any, any>
      )(payload),
    )) as BoundRpcMethod<Rpcs, E, Key>;
}

export function bindRuntimeRpcStreamMethodByKey<
  Rpcs extends Rpc.Any,
  E,
  Key extends StreamRpcTag<Rpcs>,
>(
  ensureClient: Effect.Effect<RuntimeRpcClientConnection<Rpcs>, E>,
  key: Key,
): BoundRpcMethod<Rpcs, E, Key> {
  return ((payload: Rpc.PayloadConstructor<Rpc.ExtractTag<Rpcs, Key>>) =>
    Stream.unwrap(
      Effect.map(ensureClient, (client) =>
        (
          client[key] as (
            input: Rpc.PayloadConstructor<Rpc.ExtractTag<Rpcs, Key>>,
          ) => Stream.Stream<any, any, any>
        )(payload),
      ),
    )) as BoundRpcMethod<Rpcs, E, Key>;
}
