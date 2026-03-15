import assert from "node:assert/strict";
import TestRenderer, { act } from "react-test-renderer";
import type {
  ChatTransport,
  UIMessage,
  UIMessageChunk,
} from "ai";
import type { BridgeChatTransportOptions } from "@llm-bridge/client";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { useEffect } from "react";

type FakeModelSummary = {
  id: string;
  name: string;
  provider: string;
  capabilities: string[];
  connected: boolean;
};

type FakeClient = {
  listModels: () => Promise<
    ReadonlyArray<FakeModelSummary>
  >;
  streamModels: () => Stream.Stream<ReadonlyArray<FakeModelSummary>, Error>;
  getModel: (modelId: string) => Promise<{ id: string }>;
  getChatTransport: (
    options?: BridgeChatTransportOptions,
  ) => ChatTransport<UIMessage>;
  requestPermission: (input: { modelId: string }) => Promise<{ requestId: string }>;
  close: () => Promise<void>;
};

let createClientCalls = 0;
let closeCalls = 0;
let listModelsCalls = 0;
let streamModelsCalls = 0;
let getModelCalls = 0;
let requestPermissionCalls: Array<{ modelId: string }> = [];
let getChatTransportCalls: Array<BridgeChatTransportOptions | undefined> = [];
let sendMessagesCalls: Array<{
  body: unknown;
  messages: UIMessage[];
}> = [];
let responseText = "Bridge reply";
let transportSequence = 0;
let modelsPubSub!: PubSub.PubSub<ReadonlyArray<FakeModelSummary>>;
let streamModelsError: Error | null = null;

const initialModels: ReadonlyArray<FakeModelSummary> = [
  {
    id: "google/gemini-3.1-pro-preview",
    name: "Gemini",
    provider: "google",
    capabilities: ["text"],
    connected: true,
  },
];

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function createMessageStream(text: string): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({
        type: "start",
        messageId: "assistant-1",
      });
      controller.enqueue({
        type: "text-start",
        id: "text-1",
      });
      controller.enqueue({
        type: "text-delta",
        id: "text-1",
        delta: text,
      });
      controller.enqueue({
        type: "text-end",
        id: "text-1",
      });
      controller.enqueue({
        type: "finish",
        finishReason: "stop",
      });
      controller.close();
    },
  });
}

function createFakeTransport(): ChatTransport<UIMessage> & { id: string } {
  transportSequence += 1;

  return {
    id: `transport-${transportSequence}`,
    sendMessages: async (input) => {
      sendMessagesCalls.push({
        body: input.body,
        messages: input.messages,
      });
      return createMessageStream(responseText);
    },
    reconnectToStream: async () => null,
  };
}

function createFakeClient(): FakeClient {
  return {
    listModels: async () => {
      listModelsCalls += 1;
      return initialModels;
    },
    streamModels: () => {
      streamModelsCalls += 1;
      if (streamModelsError) {
        return Stream.fail(streamModelsError);
      }
      return Stream.fromPubSub(modelsPubSub);
    },
    getModel: async (modelId: string) => {
      getModelCalls += 1;
      return { id: modelId };
    },
    getChatTransport: (options?: BridgeChatTransportOptions) => {
      getChatTransportCalls.push(options);
      return createFakeTransport();
    },
    requestPermission: async (input: { modelId: string }) => {
      requestPermissionCalls.push(input);
      return { requestId: "prm_1" };
    },
    close: async () => {
      closeCalls += 1;
    },
  };
}

function getMessageText(message: UIMessage | undefined) {
  if (!message) {
    return "";
  }

  return message.parts
    .filter(
      (
        part,
      ): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function publishModels(models: ReadonlyArray<FakeModelSummary>) {
  await Effect.runPromise(PubSub.publish(modelsPubSub, models));
  await flushMicrotasks();
}

beforeEach(async () => {
  createClientCalls = 0;
  closeCalls = 0;
  listModelsCalls = 0;
  streamModelsCalls = 0;
  getModelCalls = 0;
  requestPermissionCalls = [];
  getChatTransportCalls = [];
  sendMessagesCalls = [];
  responseText = "Bridge reply";
  transportSequence = 0;
  streamModelsError = null;
  modelsPubSub = await Effect.runPromise(
    PubSub.unbounded<ReadonlyArray<FakeModelSummary>>({
      replay: 1,
    }),
  );
  await Effect.runPromise(PubSub.publish(modelsPubSub, initialModels));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.doUnmock("@llm-bridge/client");
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("client-react hooks", () => {
  it("creates one client per provider and closes it on unmount", async () => {
    vi.doMock("@llm-bridge/client", () => ({
      createBridgeClient: async () => {
        createClientCalls += 1;
        return createFakeClient();
      },
    }));

    const { BridgeProvider, useBridgeConnectionState } = await import("./index");

    function Probe() {
      useBridgeConnectionState();
      return null;
    }

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <BridgeProvider>
          <Probe />
        </BridgeProvider>,
      );
      await flushMicrotasks();
    });

    assert.equal(createClientCalls, 1);

    await act(async () => {
      renderer!.unmount();
    });

    assert.equal(closeCalls, 1);
  });

  it("streams models and loads model resources through public client methods", async () => {
    vi.doMock("@llm-bridge/client", () => ({
      createBridgeClient: async () => {
        createClientCalls += 1;
        return createFakeClient();
      },
    }));

    const { BridgeProvider, useBridgeModel, useBridgeModels } = await import("./index");

    let latestModels: ReadonlyArray<{ id: string }> = [];
    let hasModel = false;

    function Probe() {
      const { models } = useBridgeModels();
      const { model } = useBridgeModel("google/gemini-3.1-pro-preview");

      latestModels = models;
      hasModel = model != null;
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        <BridgeProvider>
          <Probe />
        </BridgeProvider>,
      );
      await flushMicrotasks();
    });

    assert.equal(listModelsCalls, 0);
    assert.equal(streamModelsCalls, 1);
    assert.equal(getModelCalls, 1);
    assert.equal(latestModels.length, 1);
    assert.equal(hasModel, true);
  });

  it("reactively updates the model list without manual refresh", async () => {
    vi.doMock("@llm-bridge/client", () => ({
      createBridgeClient: async () => {
        createClientCalls += 1;
        return createFakeClient();
      },
    }));

    const { BridgeProvider, useBridgeModels } = await import("./index");

    let latestModels: ReadonlyArray<FakeModelSummary> = [];

    function Probe() {
      latestModels = useBridgeModels().models;
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        <BridgeProvider>
          <Probe />
        </BridgeProvider>,
      );
      await flushMicrotasks();
    });

    assert.equal(latestModels.length, 1);

    await act(async () => {
      await publishModels([
        ...initialModels,
        {
          id: "openai/gpt-4o-mini",
          name: "GPT-4o mini",
          provider: "openai",
          capabilities: ["text"],
          connected: true,
        },
      ]);
    });

    assert.deepEqual(
      latestModels.map((model) => model.id),
      [
        "google/gemini-3.1-pro-preview",
        "openai/gpt-4o-mini",
      ],
    );
  });

  it("surfaces model stream failures through useBridgeModels", async () => {
    streamModelsError = new Error("models failed");

    vi.doMock("@llm-bridge/client", () => ({
      createBridgeClient: async () => {
        createClientCalls += 1;
        return createFakeClient();
      },
    }));

    const { BridgeProvider, useBridgeModels } = await import("./index");

    let latestStatus = "loading";
    let latestError: Error | null = null;

    function Probe() {
      const { status, error } = useBridgeModels();
      latestStatus = status;
      latestError = error;
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        <BridgeProvider>
          <Probe />
        </BridgeProvider>,
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });

    assert.equal(latestStatus, "error");
    assert.equal(latestError?.message, "models failed");
  });

  it("mounts before readiness and sends through the ready transport once available", async () => {
    const deferredClient = createDeferred<FakeClient>();

    vi.doMock("@llm-bridge/client", () => ({
      createBridgeClient: async () => {
        createClientCalls += 1;
        return deferredClient.promise;
      },
    }));

    const { BridgeProvider, useChat } = await import("./index");

    let latestChat: ReturnType<typeof useChat> | null = null;

    function Probe() {
      latestChat = useChat();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        <BridgeProvider>
          <Probe />
        </BridgeProvider>,
      );
      await flushMicrotasks();
    });

    assert.notEqual(latestChat, null);
    assert.equal(latestChat!.isLoading, true);
    assert.equal(latestChat!.isReady, false);
    assert.equal(getChatTransportCalls.length, 0);

    await act(async () => {
      deferredClient.resolve(createFakeClient());
      await flushMicrotasks();
      await flushMicrotasks();
    });

    assert.equal(latestChat!.isLoading, false);
    assert.equal(latestChat!.isReady, true);
    assert.equal(getChatTransportCalls.length, 1);

    await act(async () => {
      await latestChat!.sendMessage(
        { text: "hi" },
        {
          body: {
            modelId: "google/gemini-3.1-pro-preview",
          },
        },
      );
      await flushMicrotasks();
    });

    assert.equal(sendMessagesCalls.length, 1);
    assert.equal(latestChat!.status, "ready");
    assert.equal(latestChat!.error, undefined);
    assert.equal(latestChat!.messages.length, 2);
    assert.equal(
      getMessageText(latestChat!.messages[latestChat!.messages.length - 1]),
      responseText,
    );
  });

  it("reports bridge readiness state alongside the chat helpers", async () => {
    const deferredClient = createDeferred<FakeClient>();

    vi.doMock("@llm-bridge/client", () => ({
      createBridgeClient: async () => {
        createClientCalls += 1;
        return deferredClient.promise;
      },
    }));

    const { BridgeProvider, useChat } = await import("./index");

    let latestChat: ReturnType<typeof useChat> | null = null;

    function Probe() {
      latestChat = useChat();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        <BridgeProvider>
          <Probe />
        </BridgeProvider>,
      );
      await flushMicrotasks();
    });

    assert.notEqual(latestChat, null);
    assert.equal(latestChat!.isLoading, true);
    assert.equal(latestChat!.isReady, false);
    assert.equal(latestChat!.hasError, false);
    assert.equal(latestChat!.transportError, null);

    await act(async () => {
      deferredClient.resolve(createFakeClient());
      await flushMicrotasks();
      await flushMicrotasks();
    });

    assert.equal(latestChat!.isLoading, false);
    assert.equal(latestChat!.isReady, true);
    assert.equal(latestChat!.hasError, false);
    assert.equal(latestChat!.transportError, null);
  });

  it("returns the unavailable error when sending before the bridge is ready", async () => {
    const deferredClient = createDeferred<FakeClient>();

    vi.doMock("@llm-bridge/client", () => ({
      createBridgeClient: async () => {
        createClientCalls += 1;
        return deferredClient.promise;
      },
    }));

    const { BridgeProvider, useChat } = await import("./index");

    let latestChat: ReturnType<typeof useChat> | null = null;

    function Probe() {
      latestChat = useChat();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        <BridgeProvider>
          <Probe />
        </BridgeProvider>,
      );
      await flushMicrotasks();
    });

    await act(async () => {
      await latestChat!.sendMessage(
        { text: "hi" },
        {
          body: {
            modelId: "google/gemini-3.1-pro-preview",
          },
        },
      );
      await flushMicrotasks();
    });

    assert.equal(sendMessagesCalls.length, 0);
    assert.equal(latestChat!.status, "error");
    assert.equal(
      latestChat!.error?.message,
      "Bridge chat transport is not ready yet.",
    );
  });

  it("passes transportOptions through and preserves chat state across rerenders", async () => {
    vi.doMock("@llm-bridge/client", () => ({
      createBridgeClient: async () => {
        createClientCalls += 1;
        return createFakeClient();
      },
    }));

    const { BridgeProvider, useChat } = await import("./index");

    const transportOptions: BridgeChatTransportOptions = {
      prepareSendMessages: async () => ({}),
    };
    let latestChat: ReturnType<typeof useChat> | null = null;

    function Probe() {
      latestChat = useChat({
        transportOptions,
      });
      return null;
    }

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <BridgeProvider>
          <Probe />
        </BridgeProvider>,
      );
      await flushMicrotasks();
    });

    const firstChatId = latestChat!.id;

    await act(async () => {
      await latestChat!.sendMessage(
        { text: "hello" },
        {
          body: {
            modelId: "google/gemini-3.1-pro-preview",
          },
        },
      );
      await flushMicrotasks();
    });

    await act(async () => {
      renderer!.update(
        <BridgeProvider>
          <Probe />
        </BridgeProvider>,
      );
      await flushMicrotasks();
    });

    assert.equal(getChatTransportCalls.length, 1);
    assert.equal(getChatTransportCalls[0], transportOptions);
    assert.equal(latestChat!.id, firstChatId);
    assert.equal(latestChat!.messages.length, 2);
    assert.equal(
      getMessageText(latestChat!.messages[latestChat!.messages.length - 1]),
      responseText,
    );
  });

  it("requests permission through the public client API only", async () => {
    vi.doMock("@llm-bridge/client", () => ({
      createBridgeClient: async () => {
        createClientCalls += 1;
        return createFakeClient();
      },
    }));

    const { BridgeProvider, useBridgePermissionRequest } = await import("./index");

    function Probe() {
      const { requestPermission } = useBridgePermissionRequest();

      useEffect(() => {
        void requestPermission({
          modelId: "google/gemini-3.1-pro-preview",
        });
      }, [requestPermission]);

      return null;
    }

    await act(async () => {
      TestRenderer.create(
        <BridgeProvider>
          <Probe />
        </BridgeProvider>,
      );
      await flushMicrotasks();
    });

    assert.deepEqual(requestPermissionCalls, [
      {
        modelId: "google/gemini-3.1-pro-preview",
      },
    ]);
  });
});
