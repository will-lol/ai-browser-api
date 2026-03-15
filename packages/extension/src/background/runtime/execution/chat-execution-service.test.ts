import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mock } from "@/test-utils/vitest-compat";
import { APICallError } from "@ai-sdk/provider";
import {
  RuntimeChatStreamNotFoundError,
  type RuntimeChatSendMessagesInput,
  type RuntimeOriginState,
  type RuntimePendingRequest,
  type RuntimePermissionEntry,
  type RuntimeRpcError,
} from "@llm-bridge/contracts";
import {
  ChatExecutionService,
  MetaService,
  PermissionsService,
  type AppRuntime,
  type MetaServiceApi,
  type PermissionsServiceApi,
} from "@llm-bridge/runtime-core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import { makeUnusedRuntimeLayer } from "@/background/test-utils/runtime-service-stubs";
import { waitForCondition } from "@/background/test-utils/wait-for";

type ControlledUIStream = {
  readonly stream: ReadableStream<object>;
  readonly enqueue: (chunk: object) => void;
  readonly close: () => void;
  readonly error: (error: unknown) => void;
};

let originEnabled = true;
let modelPermission: "allowed" | "denied" | "pending" = "allowed";
let lastAbortSignal: AbortSignal | undefined;
let queuedStreams: Array<ControlledUIStream> = [];
let createdStreams: Array<ControlledUIStream> = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
let prepareLanguageModelCallImpl: () => Effect.Effect<{
  languageModel: {
    specificationVersion: "v3";
    provider: string;
    modelId: string;
    supportedUrls: Record<string, never>;
    doGenerate: () => Promise<never>;
    doStream: () => Promise<never>;
  };
  providerID: string;
  callOptions: Record<string, never>;
}, RuntimeRpcError> = () =>
  Effect.succeed({
    languageModel: {
      specificationVersion: "v3" as const,
      provider: "openai",
      modelId: "gpt-4o-mini",
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error("unused");
      },
      doStream: async () => {
        throw new Error("unused");
      },
    },
    providerID: "openai",
    callOptions: {},
  });

function makeControlledUIStream(): ControlledUIStream {
  let controller!: ReadableStreamDefaultController<object>;

  return {
    stream: new ReadableStream<object>({
      start(nextController) {
        controller = nextController;
      },
    }),
    enqueue(chunk) {
      controller.enqueue(chunk);
    },
    close() {
      controller.close();
    },
    error(error) {
      controller.error(error);
    },
  };
}

const validateMessagesMock = mock(async ({ messages }: { messages: Array<object> }) => messages);
const convertMessagesMock = mock(async (messages: Array<object>) => messages as Array<never>);
const streamTextMock = mock((input: { abortSignal: AbortSignal }) => {
  lastAbortSignal = input.abortSignal;
  const controlled = queuedStreams.shift() ?? makeControlledUIStream();
  createdStreams.push(controlled);

  return {
    toUIMessageStream: () => controlled.stream,
  };
});

const ai = await import("ai");

mock.module("ai", () => ({
  ...ai,
  validateUIMessages: validateMessagesMock,
  convertToModelMessages: convertMessagesMock,
  streamText: streamTextMock,
}));

mock.module("@/background/runtime/execution/language-model-runtime", () => ({
  prepareRuntimeChatModelCall: () => prepareLanguageModelCallImpl(),
}));

const { ChatExecutionServiceLive } = await import("./chat-execution-service");

const defaultRequest: RuntimeChatSendMessagesInput = {
  origin: "https://example.test",
  chatId: "chat-1",
  modelId: "openai/gpt-4o-mini",
  trigger: "submit-message",
  messages: [
    {
      id: "message-1",
      role: "user",
      text: "hello",
    },
  ],
};

function makePermissionsLayer() {
  const permissions: PermissionsServiceApi = {
    getOriginState: (origin) =>
      Effect.succeed<RuntimeOriginState>({
        origin,
        enabled: originEnabled,
      }),
    streamOriginState: () => Stream.empty,
    listPermissions: () => Effect.die("unused"),
    streamPermissions: () => Stream.empty,
    getModelPermission: () => Effect.succeed(modelPermission),
    setOriginEnabled: () => Effect.die("unused"),
    setModelPermission: () => Effect.die("unused"),
    createPermissionRequest: () => Effect.die("unused"),
    resolvePermissionRequest: () => Effect.die("unused"),
    dismissPermissionRequest: () => Effect.die("unused"),
    listPending: () => Effect.succeed<ReadonlyArray<RuntimePendingRequest>>([]),
    streamPending: () => Stream.empty,
    waitForPermissionDecision: () => Effect.die("unused"),
    streamOriginStates: () => Stream.empty,
    streamPermissionsMap: () =>
      Stream.empty as Stream.Stream<
        ReadonlyMap<string, ReadonlyArray<RuntimePermissionEntry>>
      >,
    streamPendingMap: () =>
      Stream.empty as Stream.Stream<
        ReadonlyMap<string, ReadonlyArray<RuntimePendingRequest>>
      >,
  };

  return Layer.succeed(PermissionsService, permissions);
}

function makeMetaLayer() {
  const meta: MetaServiceApi = {
    parseProviderModel: (modelID) => ({
      providerID: modelID.split("/")[0] ?? "openai",
      modelID,
    }),
    resolvePermissionTarget: (modelID) =>
      Effect.succeed({
        modelId: modelID,
        modelName: modelID,
        provider: modelID.split("/")[0] ?? "openai",
        capabilities: ["text"],
      }),
  };

  return Layer.succeed(MetaService, meta);
}

function makeRuntime(): ManagedRuntime.ManagedRuntime<AppRuntime, unknown> {
  const baseLayer = Layer.mergeAll(
    makePermissionsLayer(),
    makeMetaLayer(),
  );
  const chatExecutionLayer = ChatExecutionServiceLive.pipe(
    Layer.provide(baseLayer),
  );
  const liveLayer = Layer.merge(baseLayer, chatExecutionLayer);
  const stubsLayer = makeUnusedRuntimeLayer({
    omit: ["permissions", "meta", "chatExecution"] as const,
  }).pipe(Layer.provide(liveLayer));

  return ManagedRuntime.make(Layer.merge(liveLayer, stubsLayer));
}

async function openChatReader(
  runtime: ManagedRuntime.ManagedRuntime<AppRuntime, unknown>,
  effect: Effect.Effect<
    Stream.Stream<object, RuntimeRpcError>,
    RuntimeRpcError,
    AppRuntime
  >,
) {
  const stream = await runtime.runPromise(effect);
  const readable = await runtime.runPromise(
    Effect.scoped(Stream.toReadableStreamEffect(stream)),
  );

  return readable.getReader();
}

async function readNext<A>(
  reader: ReadableStreamDefaultReader<A>,
  timeoutMs = 500,
) {
  return await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timed out reading chat stream")), timeoutMs),
    ),
  ]);
}

beforeEach(() => {
  originEnabled = true;
  modelPermission = "allowed";
  lastAbortSignal = undefined;
  queuedStreams = [];
  createdStreams = [];
  prepareLanguageModelCallImpl = () =>
    Effect.succeed({
      languageModel: {
        specificationVersion: "v3" as const,
        provider: "openai",
        modelId: "gpt-4o-mini",
        supportedUrls: {},
        doGenerate: async () => {
          throw new Error("unused");
        },
        doStream: async () => {
          throw new Error("unused");
        },
      },
      providerID: "openai",
      callOptions: {},
    });

  validateMessagesMock.mockClear();
  convertMessagesMock.mockClear();
  streamTextMock.mockClear();
  console.log = mock(() => undefined) as typeof console.log;
  console.error = mock(() => undefined) as typeof console.error;
});

afterAll(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  mock.restore();
});

describe("chat-execution-service", () => {
  it("starts a generation and streams chunks to the first subscriber", async () => {
    const controlled = makeControlledUIStream();
    queuedStreams.push(controlled);

    const runtime = makeRuntime();

    try {
      const reader = await openChatReader(
        runtime,
        Effect.flatMap(ChatExecutionService, (service) =>
          service.sendMessages(defaultRequest),
        ),
      );

      controlled.enqueue({ kind: "chunk-1" });
      controlled.enqueue({ kind: "chunk-2" });
      controlled.close();

      expect(await readNext(reader)).toEqual({
        done: false,
        value: { kind: "chunk-1" },
      });
      expect(await readNext(reader)).toEqual({
        done: false,
        value: { kind: "chunk-2" },
      });
      expect(await readNext(reader)).toEqual({
        done: true,
        value: undefined,
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("reconnects live-only and only receives future chunks", async () => {
    const controlled = makeControlledUIStream();
    queuedStreams.push(controlled);

    const runtime = makeRuntime();

    try {
      const firstReader = await openChatReader(
        runtime,
        Effect.flatMap(ChatExecutionService, (service) =>
          service.sendMessages(defaultRequest),
        ),
      );

      controlled.enqueue({ kind: "chunk-1" });
      expect(await readNext(firstReader)).toEqual({
        done: false,
        value: { kind: "chunk-1" },
      });

      const reconnectReader = await openChatReader(
        runtime,
        Effect.flatMap(ChatExecutionService, (service) =>
          service.reconnectStream({
            origin: defaultRequest.origin,
            chatId: defaultRequest.chatId,
          }),
        ),
      );

      controlled.enqueue({ kind: "chunk-2" });

      expect(await readNext(firstReader)).toEqual({
        done: false,
        value: { kind: "chunk-2" },
      });
      expect(await readNext(reconnectReader)).toEqual({
        done: false,
        value: { kind: "chunk-2" },
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("logs redacted chat metadata without origin or message bodies", async () => {
    const controlled = makeControlledUIStream();
    queuedStreams.push(controlled);

    const runtime = makeRuntime();

    try {
      const reader = await openChatReader(
        runtime,
        Effect.flatMap(ChatExecutionService, (service) =>
          service.sendMessages(defaultRequest),
        ),
      );

      controlled.close();
      await readNext(reader);

      const serializedLogs = JSON.stringify(
        (console.log as ReturnType<typeof mock>).mock.calls,
      );

      expect(serializedLogs).toContain("send.started");
      expect(serializedLogs).toContain("messageCount");
      expect(serializedLogs).not.toContain(defaultRequest.origin);
      expect(serializedLogs).not.toContain("hello");
    } finally {
      await runtime.dispose();
    }
  });

  it("returns not found when reconnecting after completion", async () => {
    const controlled = makeControlledUIStream();
    queuedStreams.push(controlled);

    const runtime = makeRuntime();

    try {
      const reader = await openChatReader(
        runtime,
        Effect.flatMap(ChatExecutionService, (service) =>
          service.sendMessages(defaultRequest),
        ),
      );

      controlled.close();
      expect(await readNext(reader)).toEqual({
        done: true,
        value: undefined,
      });

      const result = await runtime.runPromise(
        Effect.either(
          Effect.flatMap(ChatExecutionService, (service) =>
            service.reconnectStream({
              origin: defaultRequest.origin,
              chatId: defaultRequest.chatId,
            }),
          ),
        ),
      );

      expect("left" in result).toBe(true);
      if ("left" in result) {
        expect(result.left).toBeInstanceOf(RuntimeChatStreamNotFoundError);
      }
    } finally {
      await runtime.dispose();
    }
  });

  it("aborts and replaces an existing generation for the same chat key", async () => {
    const firstControlled = makeControlledUIStream();
    const secondControlled = makeControlledUIStream();
    queuedStreams.push(firstControlled, secondControlled);

    const runtime = makeRuntime();

    try {
      const firstReader = await openChatReader(
        runtime,
        Effect.flatMap(ChatExecutionService, (service) =>
          service.sendMessages(defaultRequest),
        ),
      );
      const firstSignal = lastAbortSignal;

      const secondReader = await openChatReader(
        runtime,
        Effect.flatMap(ChatExecutionService, (service) =>
          service.sendMessages(defaultRequest),
        ),
      );

      await waitForCondition(() => firstSignal?.aborted === true, {
        timeoutMs: 500,
        intervalMs: 0,
      });
      expect(await readNext(firstReader)).toEqual({
        done: true,
        value: undefined,
      });

      secondControlled.enqueue({ kind: "chunk-2" });
      expect(await readNext(secondReader)).toEqual({
        done: false,
        value: { kind: "chunk-2" },
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps a generation alive until the last subscriber leaves", async () => {
    const controlled = makeControlledUIStream();
    queuedStreams.push(controlled);

    const runtime = makeRuntime();

    try {
      const firstReader = await openChatReader(
        runtime,
        Effect.flatMap(ChatExecutionService, (service) =>
          service.sendMessages(defaultRequest),
        ),
      );
      const activeSignal = lastAbortSignal;

      const secondReader = await openChatReader(
        runtime,
        Effect.flatMap(ChatExecutionService, (service) =>
          service.reconnectStream({
            origin: defaultRequest.origin,
            chatId: defaultRequest.chatId,
          }),
        ),
      );

      await firstReader.cancel();
      expect(activeSignal?.aborted).toBe(false);

      controlled.enqueue({ kind: "still-live" });
      expect(await readNext(secondReader)).toEqual({
        done: false,
        value: { kind: "still-live" },
      });

      await secondReader.cancel();
      await waitForCondition(() => activeSignal?.aborted === true, {
        timeoutMs: 500,
        intervalMs: 0,
      });

      const result = await runtime.runPromise(
        Effect.either(
          Effect.flatMap(ChatExecutionService, (service) =>
            service.reconnectStream({
              origin: defaultRequest.origin,
              chatId: defaultRequest.chatId,
            }),
          ),
        ),
      );

      expect("left" in result).toBe(true);
      if ("left" in result) {
        expect(result.left).toBeInstanceOf(RuntimeChatStreamNotFoundError);
      }
    } finally {
      await runtime.dispose();
    }
  });

  it("aborts immediately when abortStream is called", async () => {
    const controlled = makeControlledUIStream();
    queuedStreams.push(controlled);

    const runtime = makeRuntime();

    try {
      const reader = await openChatReader(
        runtime,
        Effect.flatMap(ChatExecutionService, (service) =>
          service.sendMessages(defaultRequest),
        ),
      );
      const activeSignal = lastAbortSignal;

      await runtime.runPromise(
        Effect.flatMap(ChatExecutionService, (service) =>
          service.abortStream({
            origin: defaultRequest.origin,
            chatId: defaultRequest.chatId,
          }),
        ),
      );

      await waitForCondition(() => activeSignal?.aborted === true, {
        timeoutMs: 500,
        intervalMs: 0,
      });
      expect(await readNext(reader)).toEqual({
        done: true,
        value: undefined,
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("normalizes provider stream failures and removes the generation", async () => {
    const controlled = makeControlledUIStream();
    queuedStreams.push(controlled);

    const runtime = makeRuntime();

    try {
      const reader = await openChatReader(
        runtime,
        Effect.flatMap(ChatExecutionService, (service) =>
          service.sendMessages(defaultRequest),
        ),
      );

      controlled.error(
        new APICallError({
          message: "Overloaded",
          url: "https://api.openai.com/v1/responses",
          requestBodyValues: {},
          statusCode: 503,
          responseHeaders: {
            "retry-after": "2",
          },
          isRetryable: true,
        }),
      );

      await expect(readNext(reader)).rejects.toMatchObject({
        _tag: "RuntimeUpstreamServiceError",
        providerID: "openai",
        operation: "chat.stream",
        statusCode: 503,
      });

      const reconnect = await runtime.runPromise(
        Effect.either(
          Effect.flatMap(ChatExecutionService, (service) =>
            service.reconnectStream({
              origin: defaultRequest.origin,
              chatId: defaultRequest.chatId,
            }),
          ),
        ),
      );

      expect("left" in reconnect).toBe(true);
      if ("left" in reconnect) {
        expect(reconnect.left).toBeInstanceOf(RuntimeChatStreamNotFoundError);
      }
    } finally {
      await runtime.dispose();
    }
  });
});
