import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

export function bindRuntimeRpcUnaryMethod<
  Client,
  E,
  Payload,
  Success,
  Failure,
  Requirements,
>(
  ensureClient: Effect.Effect<Client, E>,
  select: (
    client: Client,
  ) => (payload: Payload) => Effect.Effect<Success, Failure, Requirements>,
): (payload: Payload) => Effect.Effect<Success, Failure | E, Requirements> {
  return (payload) =>
    Effect.flatMap(ensureClient, (client) => select(client)(payload));
}

export function bindRuntimeRpcStreamMethod<
  Client,
  E,
  Payload,
  Success,
  Failure,
  Requirements,
>(
  ensureClient: Effect.Effect<Client, E>,
  select: (
    client: Client,
  ) => (payload: Payload) => Stream.Stream<Success, Failure, Requirements>,
): (payload: Payload) => Stream.Stream<Success, Failure | E, Requirements> {
  return (payload) =>
    Stream.unwrap(
      Effect.map(ensureClient, (client) => select(client)(payload)),
    );
}
