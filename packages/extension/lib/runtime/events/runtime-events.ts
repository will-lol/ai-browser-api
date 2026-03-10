import type { RuntimeEvent } from "@llm-bridge/contracts";
import {
  RuntimeEventBus,
  RuntimeEventTransport,
  makeRuntimeEventBusLayer,
  parseRuntimeEventEnvelope,
  type RuntimeEventBusApi,
  type RuntimeEventEnvelope,
} from "@llm-bridge/runtime-events";
import { browser } from "@wxt-dev/browser";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { RUNTIME_EVENT_STORAGE_KEY } from "@/lib/runtime/constants";

export type RuntimeEventPayload = RuntimeEvent;

const RUNTIME_EVENT_CHANNEL_NAME = "llm-bridge-runtime-events-v1";

let runtimeChannel: BroadcastChannel | null = null;

function getRuntimeChannel() {
  if (typeof BroadcastChannel === "undefined") return null;

  if (!runtimeChannel) {
    runtimeChannel = new BroadcastChannel(RUNTIME_EVENT_CHANNEL_NAME);
  }

  return runtimeChannel;
}

const EVENT_SOURCE =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? `extension-${crypto.randomUUID()}`
    : `extension-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const StorageRuntimeEventTransportLive = Layer.succeed(RuntimeEventTransport, {
  publishEnvelope: (envelope: RuntimeEventEnvelope) =>
    Effect.tryPromise({
      try: async () => {
        const channel = getRuntimeChannel();
        channel?.postMessage(envelope);

        const storage = browser.storage?.local;
        if (!storage) return;

        await storage.set({
          [RUNTIME_EVENT_STORAGE_KEY]: envelope,
        });
      },
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined)),
  streamEnvelopes: Stream.asyncPush<RuntimeEventEnvelope>((emit) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const storageListener: Parameters<
          typeof browser.storage.onChanged.addListener
        >[0] = (changes, area) => {
          if (area !== "local") return;

          const envelope = parseRuntimeEventEnvelope(
            changes[RUNTIME_EVENT_STORAGE_KEY]?.newValue,
          );
          if (!envelope) return;

          emit.single(envelope);
        };

        browser.storage.onChanged.addListener(storageListener);

        const channel = getRuntimeChannel();
        const channelListener = (event: MessageEvent<unknown>) => {
          const envelope = parseRuntimeEventEnvelope(event.data);
          if (!envelope) return;

          emit.single(envelope);
        };

        channel?.addEventListener("message", channelListener);

        return () => {
          browser.storage.onChanged.removeListener(storageListener);
          channel?.removeEventListener("message", channelListener);
        };
      }),
      (cleanup) => Effect.sync(cleanup),
    ),
  ),
});

const RuntimeEventBusLive = makeRuntimeEventBusLayer({
  source: EVENT_SOURCE,
}).pipe(Layer.provideMerge(StorageRuntimeEventTransportLive));

type RuntimeEventRuntime = {
  readonly scope: Scope.CloseableScope;
  readonly bus: RuntimeEventBusApi;
};

let runtimeEventRuntimePromise: Promise<RuntimeEventRuntime> | null = null;
let dispatchLoopStarted = false;
const listeners = new Set<(event: RuntimeEventPayload) => void>();

function ensureRuntimeEventRuntime() {
  if (runtimeEventRuntimePromise) {
    return runtimeEventRuntimePromise;
  }

  runtimeEventRuntimePromise = Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(RuntimeEventBusLive, scope);
      const bus = Context.get(context, RuntimeEventBus);

      return {
        scope,
        bus,
      } satisfies RuntimeEventRuntime;
    }),
  );

  return runtimeEventRuntimePromise;
}

function ensureDispatchLoop() {
  if (dispatchLoopStarted) return;
  dispatchLoopStarted = true;

  void ensureRuntimeEventRuntime()
    .then((runtime) =>
      Effect.runPromise(
        runtime.bus.stream.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              for (const listener of listeners) {
                try {
                  listener(event);
                } catch (error) {
                  console.warn("runtime event listener failed", error);
                }
              }
            }),
          ),
        ),
      ),
    )
    .catch((error) => {
      dispatchLoopStarted = false;
      console.warn("runtime event dispatch loop failed", error);
    });
}

export async function publishRuntimeEvent(event: RuntimeEventPayload) {
  const runtime = await ensureRuntimeEventRuntime();
  await Effect.runPromise(runtime.bus.publish(event));
}

export function subscribeRuntimeEvents(
  handler: (event: RuntimeEventPayload) => void,
) {
  listeners.add(handler);
  ensureDispatchLoop();

  return () => {
    listeners.delete(handler);
  };
}
