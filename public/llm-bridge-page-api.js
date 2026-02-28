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

  function request(type, payload) {
    const requestId = post(type, payload);
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      root.setTimeout(() => {
        if (!pending.has(requestId)) return;
        pending.delete(requestId);
        reject(new Error(`Request timed out: ${type}`));
      }, 30000);
    });
  }

  function createStreamHandle(requestId) {
    const queue = [];
    let done = false;
    let error;
    let notify;

    const push = (event) => {
      queue.push(event);
      if (notify) {
        notify();
        notify = undefined;
      }
    };

    streamHandlers.set(requestId, {
      push,
      finish() {
        done = true;
        if (notify) {
          notify();
          notify = undefined;
        }
      },
      fail(message) {
        error = new Error(message || "Stream failed");
        done = true;
        if (notify) {
          notify();
          notify = undefined;
        }
      },
    });

    return {
      requestId,
      async *[Symbol.asyncIterator]() {
        while (true) {
          if (queue.length > 0) {
            const item = queue.shift();
            if (item.type === "chunk") {
              yield item.data;
              continue;
            }
          }

          if (error) {
            throw error;
          }

          if (done) {
            return;
          }

          await new Promise((resolve) => {
            notify = resolve;
          });
        }
      },
      cancel() {
        post("abort", { requestId }, requestId);
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
        stream.push({ type: "chunk", data: payload.data || "" });
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
      return request("list-models", {});
    },
    getState() {
      return request("get-state", {});
    },
    requestPermission(payload) {
      return request("request-permission", payload || {});
    },
    async invoke(payload) {
      if (!payload || payload.stream !== true) {
        return request("invoke", payload || {});
      }

      const requestId = post("invoke", payload || {});
      return createStreamHandle(requestId);
    },
    abort(requestId) {
      if (!requestId) return;
      post("abort", { requestId }, requestId);
    },
  };
})();
