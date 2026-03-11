import assert from "node:assert/strict";
import { useEffect } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, it, mock } from "bun:test";

type FakeClient = {
  listModels: () => Promise<
    ReadonlyArray<{
      id: string;
      name: string;
      provider: string;
      capabilities: string[];
      connected: boolean;
    }>
  >;
  getModel: (modelId: string) => Promise<{ id: string }>;
  getChatTransport: () => { id: string };
  requestPermission: (input: { modelId: string }) => Promise<{ requestId: string }>;
  close: () => Promise<void>;
};

let createClientCalls = 0;
let closeCalls = 0;
let listModelsCalls = 0;
let getModelCalls = 0;
let requestPermissionCalls: Array<{ modelId: string }> = [];
let transport = { id: "transport-1" };

function createFakeClient(): FakeClient {
  return {
    listModels: async () => {
      listModelsCalls += 1;
      return [
        {
          id: "google/gemini-3.1-pro-preview",
          name: "Gemini",
          provider: "google",
          capabilities: ["text"],
          connected: true,
        },
      ];
    },
    getModel: async (modelId: string) => {
      getModelCalls += 1;
      return { id: modelId };
    },
    getChatTransport: () => transport,
    requestPermission: async (input: { modelId: string }) => {
      requestPermissionCalls.push(input);
      return { requestId: "prm_1" };
    },
    close: async () => {
      closeCalls += 1;
    },
  };
}

beforeEach(() => {
  createClientCalls = 0;
  closeCalls = 0;
  listModelsCalls = 0;
  getModelCalls = 0;
  requestPermissionCalls = [];
  transport = { id: "transport-1" };
});

afterEach(() => {
  mock.restore();
});

describe("client-react hooks", () => {
  it("creates one client per provider and closes it on unmount", async () => {
    mock.module("@llm-bridge/client", () => ({
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
    });

    assert.equal(createClientCalls, 1);

    await act(async () => {
      renderer!.unmount();
    });

    assert.equal(closeCalls, 1);
  });

  it("loads models and model resources through public client methods", async () => {
    mock.module("@llm-bridge/client", () => ({
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

      useEffect(() => {
        latestModels = models;
        hasModel = model != null;
      }, [model, models]);

      return null;
    }

    await act(async () => {
      TestRenderer.create(
        <BridgeProvider>
          <Probe />
        </BridgeProvider>,
      );
    });

    assert.equal(listModelsCalls, 1);
    assert.equal(getModelCalls, 1);
    assert.equal(latestModels.length, 1);
    assert.equal(hasModel, true);
  });

  it("returns a stable chat transport across rerenders", async () => {
    mock.module("@llm-bridge/client", () => ({
      createBridgeClient: async () => {
        createClientCalls += 1;
        return createFakeClient();
      },
    }));

    const { BridgeProvider, useBridgeChatTransport } = await import("./index");

    let latestTransport: object | null = null;

    function Probe() {
      const { transport, isReady } = useBridgeChatTransport();

      useEffect(() => {
        if (!isReady || "id" in transport === false) {
          return;
        }

        latestTransport = transport;
      }, [isReady, transport]);

      return null;
    }

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <BridgeProvider>
          <Probe />
        </BridgeProvider>,
      );
    });

    const firstTransport = latestTransport;

    await act(async () => {
      renderer!.update(
        <BridgeProvider>
          <Probe />
        </BridgeProvider>,
      );
    });

    assert.notEqual(firstTransport, null);
    assert.equal(latestTransport, firstTransport);
  });

  it("requests permission through the public client API only", async () => {
    mock.module("@llm-bridge/client", () => ({
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
    });

    assert.deepEqual(requestPermissionCalls, [
      {
        modelId: "google/gemini-3.1-pro-preview",
      },
    ]);
  });
});
