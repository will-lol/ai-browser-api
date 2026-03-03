import { createLLMBridgeClient } from "@llm-bridge/client";

const DEFAULT_MODEL_ID = "google/gemini-3.1-pro-preview";
const LOG_LIMIT = 250;
const CALL_PENDING_WARNING_MS = 4_000;
const CALL_TIMEOUT_MS = 40_000;

type BridgeModelSummary = {
  id: string;
  name: string;
  provider: string;
  connected: boolean;
};

type TextLikePart = {
  type?: string;
  text?: string;
};

type GenerateResult = {
  text?: string;
  output?: TextLikePart[];
};

declare global {
  interface Window {
    __LLM_BRIDGE_DEBUG__?: boolean;
    llmBridge?: unknown;
    llmBridgeDebug?: {
      refreshModels: () => Promise<void>;
      generate: () => Promise<void>;
    };
  }
}

const debugLines: string[] = [];
let callSeq = 0;

window.__LLM_BRIDGE_DEBUG__ = true;

function stringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function serializeError(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: serializeError(value.cause, seen),
    };
  }

  if (value == null) return value;
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => serializeError(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, serializeError(item, seen)]),
  );
}

function summary(value: unknown) {
  if (Array.isArray(value)) {
    return { kind: "array", length: value.length };
  }
  if (value && typeof value === "object") {
    const asRecord = value as Record<string, unknown>;
    const result: Record<string, unknown> = {
      kind: "object",
      keys: Object.keys(asRecord).slice(0, 12),
    };
    if (Array.isArray(asRecord.providers)) {
      result.providersLength = asRecord.providers.length;
    }
    if (Array.isArray(asRecord.models)) {
      result.modelsLength = asRecord.models.length;
    }
    return result;
  }
  return { kind: typeof value, value };
}

const bridge = createLLMBridgeClient({
  debug: true,
  pendingWarningMs: 3_000,
});

function getRequiredNode<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing required node: #${id}`);
  }
  return node as T;
}

const refreshModelsButton = getRequiredNode<HTMLButtonElement>("refresh-models");
const generateButton = getRequiredNode<HTMLButtonElement>("generate");
const modelSelect = getRequiredNode<HTMLSelectElement>("model-select");
const modelCount = getRequiredNode<HTMLSpanElement>("model-count");
const promptInput = getRequiredNode<HTMLTextAreaElement>("prompt");
const statusNode = getRequiredNode<HTMLSpanElement>("status");
const resultNode = getRequiredNode<HTMLPreElement>("result");
const debugNode = getRequiredNode<HTMLPreElement>("debug");

function renderLogs() {
  debugNode.textContent = debugLines.join("\n");
}

function appLog(event: string, meta?: unknown) {
  const line = `[example-app] ${new Date().toISOString()} ${event} ${
    meta === undefined ? "" : stringify(meta)
  }`.trim();
  debugLines.unshift(line);
  if (debugLines.length > LOG_LIMIT) {
    debugLines.length = LOG_LIMIT;
  }
  renderLogs();
  console.info(line);
}

function appError(event: string, error: unknown) {
  const payload = serializeError(error);
  const line = `[example-app] ${new Date().toISOString()} ${event} ${stringify(payload)}`;
  debugLines.unshift(line);
  if (debugLines.length > LOG_LIMIT) {
    debugLines.length = LOG_LIMIT;
  }
  renderLogs();
  console.error(line);
}

function setStatus(text: string) {
  statusNode.textContent = text;
  appLog("status", { text });
}

function setResult(value: string) {
  resultNode.textContent = value;
}

async function traceCall<T>(name: string, run: () => Promise<T>): Promise<T> {
  const callId = `call_${Date.now()}_${++callSeq}`;
  const started = Date.now();
  appLog("call.start", { callId, name });

  const pendingWarning = setTimeout(() => {
    appLog("call.pending", {
      callId,
      name,
      elapsedMs: Date.now() - started,
    });
  }, CALL_PENDING_WARNING_MS);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${name} timed out after ${CALL_TIMEOUT_MS}ms`));
    }, CALL_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([run(), timeoutPromise]);
    appLog("call.success", {
      callId,
      name,
      elapsedMs: Date.now() - started,
      result: summary(result),
    });
    return result;
  } catch (error) {
    appError("call.error", {
      callId,
      name,
      elapsedMs: Date.now() - started,
      error,
    });
    throw error;
  } finally {
    clearTimeout(pendingWarning);
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function textFromGenerateResult(result: unknown) {
  const typed = result as GenerateResult;

  if (typed && typeof typed.text === "string" && typed.text.trim().length > 0) {
    return typed.text;
  }

  if (Array.isArray(typed?.output)) {
    const chunks = typed.output
      .filter(
        (part): part is Required<Pick<TextLikePart, "text">> & TextLikePart =>
          part != null && part.type === "text" && typeof part.text === "string",
      )
      .map((part) => part.text);
    if (chunks.length > 0) {
      return chunks.join("");
    }
  }

  return JSON.stringify(result, null, 2);
}

function selectedModelId() {
  return modelSelect.value;
}

async function refreshModels() {
  setStatus("Loading models...");
  try {
    const state = await traceCall("bridge.getState", () => bridge.getState());
    appLog("bridge.getState.result", summary(state));

    const models = (await traceCall("bridge.listModels", () =>
      bridge.listModels())) as BridgeModelSummary[];
    appLog("bridge.listModels.result", {
      total: models.length,
      providers: Array.from(new Set(models.map((model) => model.provider))),
    });

    const googleModels = models.filter((model) => model.provider === "google");
    appLog("google.models.filtered", {
      count: googleModels.length,
      ids: googleModels.map((model) => model.id),
    });

    modelSelect.innerHTML = "";
    for (const model of googleModels) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = `${model.id} (${model.name})`;
      modelSelect.append(option);
    }

    if (googleModels.length === 0) {
      setStatus("No connected Google models.");
      modelCount.textContent = "0 models";
      appLog("google.models.empty", {
        hint: "No Google models returned. Verify extension injection + Gemini auth.",
      });
      return;
    }

    const preferred = googleModels.find((model) => model.id === DEFAULT_MODEL_ID);
    if (preferred) {
      modelSelect.value = preferred.id;
    } else {
      const fallback = googleModels.find((model) => /gemini-3\.1/i.test(model.id));
      if (fallback) modelSelect.value = fallback.id;
    }

    modelCount.textContent = `${googleModels.length} models`;
    setStatus("Ready");
  } catch (error) {
    setStatus("Failed to load models");
    appError("refreshModels.failed", error);
  }
}

async function generate() {
  const modelId = selectedModelId();
  const prompt = promptInput.value.trim();

  appLog("generate.clicked", { modelId, promptLength: prompt.length });

  if (!modelId) {
    setStatus("Pick a model first");
    return;
  }
  if (!prompt) {
    setStatus("Enter a prompt first");
    return;
  }

  setStatus("Requesting permission...");
  setResult("");
  generateButton.disabled = true;

  try {
    await traceCall("bridge.requestPermission", () =>
      bridge.requestPermission({
        provider: "google",
        modelId,
        capabilities: ["text"],
      }));

    setStatus("Resolving model...");
    const model = await traceCall("bridge.getModel", () => bridge.getModel(modelId));

    setStatus("Generating...");
    const result = await traceCall("model.doGenerate", () =>
      model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }],
          },
        ],
        maxOutputTokens: 512,
      }));

    setResult(textFromGenerateResult(result));
    appLog("model.doGenerate.result", summary(result));
    setStatus("Done");
  } catch (error) {
    setStatus("Generation failed");
    appError("generate.failed", error);
  } finally {
    generateButton.disabled = false;
  }
}

refreshModelsButton.addEventListener("click", () => {
  appLog("refresh.button.click");
  void refreshModels();
});
generateButton.addEventListener("click", () => {
  void generate();
});

window.llmBridge = bridge;
window.llmBridgeDebug = {
  refreshModels,
  generate,
};

appLog("boot", {
  href: window.location.href,
  origin: window.location.origin,
  userAgent: navigator.userAgent,
  bridgeDebugFlag: window.__LLM_BRIDGE_DEBUG__,
});

void refreshModels();
