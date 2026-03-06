import type * as Rpc from "@effect/rpc/Rpc";
import type * as RpcGroup from "@effect/rpc/RpcGroup";
import * as RpcSchema from "@effect/rpc/RpcSchema";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import {
  makeRuntimeRpcClientCore,
  type RuntimeConnection,
} from "./runtime-rpc-client-core";

type EnsureConnection<Rpcs extends Rpc.Any> = () => Promise<
  RuntimeConnection<Rpcs>
>;
type RuntimeRpcTag<Rpcs extends Rpc.Any> = Rpcs["_tag"];
type RuntimeRpcMethod<
  Rpcs extends Rpc.Any,
  Tag extends RuntimeRpcTag<Rpcs>,
> = Extract<Rpcs, { readonly _tag: Tag }>;
type RuntimeRpcClientRecord = Record<string, (payload: unknown) => unknown>;

type RuntimeRpcFacadeMethod<Current extends Rpc.Any> =
  Rpc.SuccessSchema<Current> extends RpcSchema.Stream<infer _A, infer _E>
    ? (
        input: Rpc.PayloadConstructor<Current>,
      ) => AsyncIterable<Rpc.SuccessChunk<Current>>
    : (input: Rpc.PayloadConstructor<Current>) => Promise<Rpc.Success<Current>>;

export type RuntimeRpcFacade<Rpcs extends Rpc.Any> = {
  [Current in Rpcs as Current["_tag"]]: RuntimeRpcFacadeMethod<Current>;
};

type RuntimeRpcClientFactoryOptions<Rpcs extends Rpc.Any, E> = {
  readonly invalidatedError: () => E;
  readonly portName: string;
  readonly rpcGroup: RpcGroup.RpcGroup<Rpcs>;
};

async function runEffect<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
  return Effect.runPromise(effect)
    .then((value) => value)
    .catch((error) => {
      console.error("runtime rpc: request failed", error);
      throw error;
    });
}

function runStream<A, E>(stream: Stream.Stream<A, E, never>) {
  return Stream.toAsyncIterable(stream);
}

export function createRuntimeRpcFacade<Rpcs extends Rpc.Any>(input: {
  readonly ensureConnection: EnsureConnection<Rpcs>;
  readonly rpcGroup: RpcGroup.RpcGroup<Rpcs>;
}): RuntimeRpcFacade<Rpcs> {
  const facade: Partial<RuntimeRpcFacade<Rpcs>> = {};

  for (const rpcDefinition of input.rpcGroup.requests.values()) {
    const rpc = rpcDefinition as unknown as Rpc.AnyWithProps;
    const tag = rpc._tag as RuntimeRpcTag<Rpcs>;

    if (RpcSchema.isStreamSchema(rpc.successSchema)) {
      const method = ((
        requestInput: Rpc.PayloadConstructor<
          RuntimeRpcMethod<Rpcs, typeof tag>
        >,
      ) => ({
        async *[Symbol.asyncIterator]() {
          const { client } = await input.ensureConnection();
          const request = (client as RuntimeRpcClientRecord)[tag] as (
            payload: Rpc.PayloadConstructor<RuntimeRpcMethod<Rpcs, typeof tag>>,
          ) => Stream.Stream<
            Rpc.SuccessChunk<RuntimeRpcMethod<Rpcs, typeof tag>>,
            never,
            never
          >;
          const stream = runStream(request(requestInput));

          for await (const chunk of stream) {
            yield chunk;
          }
        },
      })) as unknown as RuntimeRpcFacade<Rpcs>[typeof tag];

      facade[tag] = method;
      continue;
    }

    const method = (async (
      requestInput: Rpc.PayloadConstructor<RuntimeRpcMethod<Rpcs, typeof tag>>,
    ) => {
      const { client } = await input.ensureConnection();
      const request = (client as RuntimeRpcClientRecord)[tag] as (
        payload: Rpc.PayloadConstructor<RuntimeRpcMethod<Rpcs, typeof tag>>,
      ) => Effect.Effect<
        Rpc.Success<RuntimeRpcMethod<Rpcs, typeof tag>>,
        never,
        never
      >;
      return runEffect(request(requestInput));
    }) as unknown as RuntimeRpcFacade<Rpcs>[typeof tag];

    facade[tag] = method;
  }

  return facade as unknown as RuntimeRpcFacade<Rpcs>;
}

export function makeRuntimeRpcClientFactory<Rpcs extends Rpc.Any, E>(
  options: RuntimeRpcClientFactoryOptions<Rpcs, E>,
) {
  const core = makeRuntimeRpcClientCore(options);

  return () =>
    createRuntimeRpcFacade({
      ensureConnection: core.ensureConnection,
      rpcGroup: options.rpcGroup,
    });
}
