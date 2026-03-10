import type {
  RuntimeGenerateResponse,
  RuntimeModelCallOptions,
  RuntimeModelDescriptor,
  RuntimeStreamPart,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import { RuntimeEnvironment, type AppEffect } from "./environment";
import { ensureModelAccess } from "./permissions";

function withStreamCleanup<T>(
  stream: ReadableStream<T>,
  onFinalize: () => void,
): ReadableStream<T> {
  const reader = stream.getReader();

  return new ReadableStream<T>({
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        onFinalize();
        controller.close();
        return;
      }
      controller.enqueue(chunk.value);
    },
    async cancel() {
      try {
        await reader.cancel();
      } finally {
        onFinalize();
      }
    },
  });
}

const controllers = new Map<string, AbortController>();
const pendingAbortKeys = new Set<string>();

function toControllerKey(input: {
  origin: string;
  sessionID: string;
  requestID: string;
}) {
  return `${input.origin}::${input.sessionID}::${input.requestID}`;
}

function registerController(input: {
  origin: string;
  sessionID: string;
  requestID: string;
}) {
  return Effect.sync(() => {
    const key = toControllerKey(input);
    const controller = new AbortController();
    controllers.set(key, controller);

    if (pendingAbortKeys.has(key)) {
      controller.abort();
      pendingAbortKeys.delete(key);
    }

    return {
      key,
      controller,
    } as const;
  });
}

function unregisterController(key: string) {
  return Effect.sync(() => {
    controllers.delete(key);
    pendingAbortKeys.delete(key);
  });
}

export function listProviders() {
  return Effect.flatMap(RuntimeEnvironment, (env) =>
    env.providers.listProviders(),
  );
}

export function listModels(input: {
  connectedOnly?: boolean;
  providerID?: string;
}) {
  return Effect.flatMap(RuntimeEnvironment, (env) =>
    env.models.listModels(input),
  );
}

export function listConnectedModels() {
  return listModels({
    connectedOnly: true,
  });
}

export function acquireModel(input: {
  origin: string;
  requestID: string;
  sessionID: string;
  modelID: string;
}): AppEffect<RuntimeModelDescriptor> {
  return Effect.flatMap(RuntimeEnvironment, (env) =>
    env.modelExecution.acquireModel(input),
  );
}

export function generateModel(input: {
  origin: string;
  requestID: string;
  sessionID: string;
  modelID: string;
  options: RuntimeModelCallOptions;
}): AppEffect<RuntimeGenerateResponse> {
  return Effect.gen(function* () {
    const env = yield* RuntimeEnvironment;
    const { key, controller } = yield* registerController(input);

    try {
      yield* ensureModelAccess({
        origin: input.origin,
        modelID: input.modelID,
        signal: controller.signal,
      });

      return yield* env.modelExecution.generateModel({
        ...input,
        signal: controller.signal,
      });
    } finally {
      yield* unregisterController(key);
    }
  });
}

export function streamModel(input: {
  origin: string;
  requestID: string;
  sessionID: string;
  modelID: string;
  options: RuntimeModelCallOptions;
}): AppEffect<ReadableStream<RuntimeStreamPart>> {
  return Effect.gen(function* () {
    const env = yield* RuntimeEnvironment;
    const { key, controller } = yield* registerController(input);

    yield* ensureModelAccess({
      origin: input.origin,
      modelID: input.modelID,
      signal: controller.signal,
    });

    const stream = yield* env.modelExecution.streamModel({
      ...input,
      signal: controller.signal,
    });

    return withStreamCleanup(stream, () => {
      controllers.delete(key);
      pendingAbortKeys.delete(key);
    });
  });
}

export function abortModelCall(input: {
  origin: string;
  sessionID: string;
  requestID: string;
}): AppEffect<void, never> {
  return Effect.sync(() => {
    const key = toControllerKey(input);
    const controller = controllers.get(key);
    if (controller) {
      controller.abort();
      controllers.delete(key);
      pendingAbortKeys.delete(key);
      return;
    }

    pendingAbortKeys.add(key);
  });
}
