import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  createBridgeClient,
  type BridgeClientApi,
  type BridgeClientOptions,
} from "@llm-bridge/client";
import {
  createMutationResource,
  createQueryResource,
  createReactiveRuntime,
  createStreamResource,
  type MutationResource,
  type QueryResource,
  type StreamResource,
} from "@llm-bridge/reactive-core";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import * as Stream from "effect/Stream";

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

class BridgeReactClient extends Context.Tag(
  "@llm-bridge/client-react/BridgeReactClient",
)<BridgeReactClient, BridgeClientApi>() {}

const bridgeResourceKeys = {
  models: "models",
  model: (modelId: string) => `model:${modelId}`,
} as const;

export type BridgeResources = {
  clientResource: QueryResource<BridgeClientApi, Error>;
  modelsResource: StreamResource<
    Awaited<ReturnType<BridgeClientApi["listModels"]>>,
    Error
  >;
  requestPermissionResource: MutationResource<
    Parameters<BridgeClientApi["requestPermission"]>[0],
    Awaited<ReturnType<BridgeClientApi["requestPermission"]>>,
    Error
  >;
  getModelResource: (
    modelId: string,
  ) => QueryResource<LanguageModelV3, Error>;
};

export function createBridgeResources(
  options?: BridgeClientOptions,
): BridgeResources {
  const clientLayer = Layer.scoped(
    BridgeReactClient,
    Effect.acquireRelease(
      Effect.tryPromise({
        try: () => createBridgeClient(options),
        catch: toError,
      }),
      (client) =>
        Effect.tryPromise({
          try: () => client.close(),
          catch: () => undefined,
        }).pipe(Effect.catchAll(() => Effect.void)),
    ),
  );

  const runtime = createReactiveRuntime(clientLayer);
  const clientResource = createQueryResource(runtime, {
    load: Effect.flatMap(BridgeReactClient, (client) => Effect.succeed(client)),
  });
  const modelsResource = createStreamResource(runtime, {
    load: Stream.unwrap(
      Effect.map(BridgeReactClient, (client) => client.streamModels()),
    ),
  });
  const requestPermissionResource = createMutationResource(runtime, {
    run: (
      payload: Parameters<BridgeClientApi["requestPermission"]>[0],
    ) =>
      Effect.flatMap(BridgeReactClient, (client) =>
        Effect.tryPromise({
          try: () => client.requestPermission(payload),
          catch: toError,
        }),
      ),
  });

  const modelResources = new Map<string, QueryResource<LanguageModelV3, Error>>();
  const getModelResource = (modelId: string) => {
    const cached = modelResources.get(modelId);
    if (cached) {
      return cached;
    }

    const resource = createQueryResource(runtime, {
      key: bridgeResourceKeys.model(modelId),
      load: Effect.flatMap(BridgeReactClient, (client) =>
        Effect.tryPromise({
          try: () => client.getModel(modelId),
          catch: toError,
        }),
      ),
    });
    modelResources.set(modelId, resource);
    return resource;
  };

  return {
    clientResource,
    modelsResource,
    requestPermissionResource,
    getModelResource,
  };
}
