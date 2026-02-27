(() => {
  const root = globalThis;
  const installKey = "__llmBridgeDebugInstalled__";
  if (root[installKey]) return;
  root[installKey] = true;

  const api = root.llmBridgeDebug || {};
  api.triggerPermissionPopup = (payload = {}) => {
    root.postMessage(
      {
        source: "llm-bridge-debug",
        type: "trigger-permission-popup",
        payload,
      },
      "*"
    );
  };

  root.llmBridgeDebug = api;
})();
