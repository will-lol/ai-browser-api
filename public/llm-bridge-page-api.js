(() => {
  const root = globalThis;
  const INSTALL_KEY = "__llmBridgeInstalled__";
  const SOURCE = "llm-bridge-page";
  const TARGET = "llm-bridge-content";

  if (root[INSTALL_KEY]) return;
  root[INSTALL_KEY] = true;

  let seq = 0;
  const pending = new Map();
  const streamHandlers = new Map();

  function nextId() {
    seq += 1;
    return `req_${Date.now()}_${seq}`;
  }

  function post(type, payload, requestId) {
    const id = requestId || nextId();
    root.postMessage(
      {
        source: SOURCE,
        requestId: id,
        type,
        payload: payload || {},
      },
      "*",
    );
    return id;
  }

  function request(type, payload, requestId) {
    const id = post(type, payload, requestId);
    return new Promise((resolve, reject) => {
      const timeout = root.setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`Request timed out: ${type}`));
      }, 30000);
      pending.set(id, { resolve, reject, timeout });
    });
  }

  function createAbortError() {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    return error;
  }

  function isAbortSignal(value) {
    return (
      !!value &&
      typeof value === "object" &&
      typeof value.aborted === "boolean" &&
      typeof value.addEventListener === "function" &&
      typeof value.removeEventListener === "function"
    );
  }

  function splitAbortSignal(options) {
    if (!options || typeof options !== "object") {
      return { options: {}, abortSignal: undefined };
    }

    const copy = { ...options };
    const signal = copy.abortSignal;
    delete copy.abortSignal;

    return {
      options: copy,
      abortSignal: isAbortSignal(signal) ? signal : undefined,
    };
  }

  function toSupportedUrls(input) {
    const supportedUrls = {};
    if (!input || typeof input !== "object") return supportedUrls;

    for (const [mediaType, patterns] of Object.entries(input)) {
      if (!Array.isArray(patterns)) continue;

      const compiled = patterns
        .map((pattern) => {
          if (pattern instanceof RegExp) return pattern;
          if (typeof pattern === "string") return new RegExp(pattern);
          if (!pattern || typeof pattern !== "object") return null;
          if (typeof pattern.source !== "string") return null;

          try {
            return new RegExp(pattern.source, typeof pattern.flags === "string" ? pattern.flags : "");
          } catch {
            return null;
          }
        })
        .filter((pattern) => pattern instanceof RegExp);

      supportedUrls[mediaType] = compiled;
    }

    return supportedUrls;
  }

  function createModelStream(requestId, onClose) {
    const queue = [];
    let controller;
    let done = false;
    let error = null;
    let finalized = false;

    const finalize = () => {
      if (finalized) return;
      finalized = true;
      streamHandlers.delete(requestId);
      if (typeof onClose === "function") {
        onClose();
      }
    };

    const flush = () => {
      if (!controller) return;

      while (queue.length > 0) {
        controller.enqueue(queue.shift());
      }

      if (error) {
        controller.error(error);
        finalize();
        return;
      }

      if (done) {
        controller.close();
        finalize();
      }
    };

    streamHandlers.set(requestId, {
      push(part) {
        if (finalized) return;
        if (controller) {
          controller.enqueue(part);
        } else {
          queue.push(part);
        }
      },
      finish() {
        if (finalized) return;
        done = true;
        flush();
      },
      fail(message) {
        if (finalized) return;
        error = message instanceof Error ? message : new Error(message || "Stream failed");
        done = true;
        flush();
      },
    });

    return new ReadableStream({
      start(nextController) {
        controller = nextController;
        flush();
      },
      cancel() {
        finalize();
        post("abort", { requestId }, requestId);
      },
    });
  }

  function createLanguageModel(modelId, descriptor) {
    const resolvedModelId =
      typeof descriptor?.modelId === "string" && descriptor.modelId.length > 0
        ? descriptor.modelId
        : modelId;
    const provider =
      typeof descriptor?.provider === "string" && descriptor.provider.length > 0
        ? descriptor.provider
        : "unknown";
    const supportedUrls = toSupportedUrls(descriptor?.supportedUrls);

    return {
      specificationVersion: "v3",
      provider,
      modelId: resolvedModelId,
      supportedUrls,
      async doGenerate(options) {
        const { options: callOptions, abortSignal } = splitAbortSignal(options);
        const requestId = nextId();

        if (abortSignal?.aborted) {
          throw createAbortError();
        }

        const onAbort = () => {
          post("abort", { requestId }, requestId);
        };

        if (abortSignal) {
          abortSignal.addEventListener("abort", onAbort, { once: true });
        }

        try {
          return await request(
            "model-do-generate",
            {
              modelId: resolvedModelId,
              options: callOptions,
            },
            requestId,
          );
        } finally {
          if (abortSignal) {
            abortSignal.removeEventListener("abort", onAbort);
          }
        }
      },
      async doStream(options) {
        const { options: callOptions, abortSignal } = splitAbortSignal(options);
        const requestId = nextId();

        if (abortSignal?.aborted) {
          throw createAbortError();
        }

        const onAbort = () => {
          post("abort", { requestId }, requestId);
        };

        if (abortSignal) {
          abortSignal.addEventListener("abort", onAbort, { once: true });
        }

        const stream = createModelStream(requestId, () => {
          if (abortSignal) {
            abortSignal.removeEventListener("abort", onAbort);
          }
        });

        try {
          await request(
            "model-do-stream",
            {
              modelId: resolvedModelId,
              options: callOptions,
            },
            requestId,
          );
        } catch (error) {
          const handler = streamHandlers.get(requestId);
          handler?.fail(error instanceof Error ? error : new Error(String(error)));
          throw error;
        }

        return {
          stream,
        };
      },
    };
  }

  function onMessage(event) {
    if (event.source !== root) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.source !== TARGET || typeof data.requestId !== "string") return;

    if (data.type === "response") {
      const match = pending.get(data.requestId);
      if (!match) return;
      pending.delete(data.requestId);
      if (match.timeout) {
        root.clearTimeout(match.timeout);
      }
      if (data.ok) {
        match.resolve(data.payload);
      } else {
        match.reject(new Error(data.error || "Bridge request failed"));
      }
      return;
    }

    if (data.type === "stream") {
      const stream = streamHandlers.get(data.requestId);
      if (!stream) return;

      if (!data.ok) {
        stream.fail(data.error || "Stream failed");
        streamHandlers.delete(data.requestId);
        return;
      }

      const payload = data.payload || {};
      if (payload.type === "chunk") {
        stream.push(payload.data);
        return;
      }
      if (payload.type === "done") {
        stream.finish();
        streamHandlers.delete(data.requestId);
      }
    }
  }

  root.addEventListener("message", onMessage);

  root.llmBridge = {
    listModels() {
      return request("list-models", {}).then((response) =>
        Array.isArray(response?.models) ? response.models : [],
      );
    },
    async getModel(modelId) {
      if (typeof modelId !== "string" || modelId.length === 0) {
        throw new Error("modelId is required");
      }

      const descriptor = await request("get-model", { modelId });
      return createLanguageModel(modelId, descriptor);
    },
    getState() {
      return request("get-state", {});
    },
    requestPermission(payload) {
      return request("request-permission", payload || {});
    },
    abort(requestId) {
      if (!requestId) return;
      post("abort", { requestId }, requestId);
    },
  };
})();
