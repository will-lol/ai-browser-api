import { generateText, streamText } from "ai";
import {
  BridgeClient,
  type BridgeModelSummary,
  withBridgeClient,
} from "@llm-bridge/client";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_MODEL_ID = "google/gemini-3.1-pro-preview";
const LOG_LIMIT = 250;

function stringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function App() {
  const bridgeOptions = useMemo(
    () => ({
      debug: true,
    }),
    [],
  );

  const [models, setModels] = useState<ReadonlyArray<BridgeModelSummary>>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [prompt, setPrompt] = useState(
    "Write a short haiku about OAuth debugging.",
  );
  const [status, setStatus] = useState("Idle");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState<"generate" | "stream" | null>(null);
  const [debugLines, setDebugLines] = useState<ReadonlyArray<string>>([]);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const startupRefreshTriggeredRef = useRef(false);

  const pushLog = useCallback((event: string, meta?: unknown) => {
    const line =
      `[example-app] ${new Date().toISOString()} ${event} ${meta === undefined ? "" : stringify(meta)}`.trim();

    setDebugLines((prev) => [line, ...prev].slice(0, LOG_LIMIT));
    console.info(line);
  }, []);

  const pushError = useCallback((event: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const line = `[example-app] ${new Date().toISOString()} ${event} ${message}`;

    setDebugLines((prev) => [line, ...prev].slice(0, LOG_LIMIT));
    console.error(line);
  }, []);

  const runBridge = useCallback(
    <A,>(program: Effect.Effect<A, unknown, BridgeClient>) =>
      Effect.runPromise(withBridgeClient(program, bridgeOptions)),
    [bridgeOptions],
  );

  const refreshModels = useCallback(async () => {
    if (refreshInFlightRef.current) {
      pushLog("refreshModels.coalesced");
      return refreshInFlightRef.current;
    }

    setStatus("Loading models...");

    const refreshTask = (async () => {
      try {
        const googleModels = await runBridge(
          Effect.gen(function* () {
            const client = yield* BridgeClient;
            const allModels = yield* client.listModels;
            return allModels;
          }),
        );

        setModels(googleModels);

        if (googleModels.length === 0) {
          setSelectedModelId("");
          setStatus("No connected Google models.");
          return;
        }

        const preferred = googleModels.find(
          (model) => model.id === DEFAULT_MODEL_ID,
        );
        setSelectedModelId((current) => {
          if (googleModels.some((model) => model.id === current))
            return current;
          return preferred?.id ?? googleModels[0]?.id ?? "";
        });

        setStatus("Ready");
        pushLog("refreshModels.success", { count: googleModels.length });
      } catch (error) {
        pushError("refreshModels.failed", error);
        setStatus("Failed to load models");
      }
    })();

    refreshInFlightRef.current = refreshTask.finally(() => {
      refreshInFlightRef.current = null;
    });

    return refreshInFlightRef.current;
  }, [pushError, pushLog, runBridge]);

  const loadModel = useCallback(
    (modelId: string) =>
      runBridge(
        Effect.gen(function* () {
          const client = yield* BridgeClient;
          return yield* client.getModel(modelId);
        }),
      ),
    [runBridge],
  );

  const runGenerate = useCallback(async () => {
    if (!selectedModelId) {
      setStatus("Pick a model first");
      return;
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setStatus("Enter a prompt first");
      return;
    }

    setBusy("generate");
    setResult("");
    setStatus("Generating...");

    try {
      const model = await loadModel(selectedModelId);
      const generated = await generateText({
        model,
        prompt: trimmedPrompt,
        providerOptions: {
          openai: { instructions: "You are a helpful assistant" },
        },
      });

      setResult(generated.text);
      setStatus(`Done (${generated.finishReason})`);
      pushLog("generate.success", {
        finishReason: generated.finishReason,
      });
    } catch (error) {
      pushError("generate.failed", error);
      setStatus("Generation failed");
    } finally {
      setBusy(null);
    }
  }, [loadModel, prompt, pushError, pushLog, selectedModelId]);

  const runStream = useCallback(async () => {
    if (!selectedModelId) {
      setStatus("Pick a model first");
      return;
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setStatus("Enter a prompt first");
      return;
    }

    setBusy("stream");
    setResult("");
    setStatus("Streaming...");

    try {
      const model = await loadModel(selectedModelId);
      const streamResult = streamText({
        model,
        prompt: trimmedPrompt,
        providerOptions: {
          openai: { instructions: "You are a helpful assistant" },
        },
      });

      for await (const chunk of streamResult.textStream) {
        setResult((prev) => prev + chunk);
      }

      const finishReason = await streamResult.finishReason;
      setStatus(`Done (${finishReason})`);
      pushLog("stream.success", { finishReason });
    } catch (error) {
      pushError("stream.failed", error);
      setStatus("Streaming failed");
    } finally {
      setBusy(null);
    }
  }, [loadModel, prompt, pushError, pushLog, selectedModelId]);

  useEffect(() => {
    if (startupRefreshTriggeredRef.current) {
      pushLog("refreshModels.startup.skipped");
      return;
    }

    startupRefreshTriggeredRef.current = true;
    void refreshModels();
  }, [pushLog, refreshModels]);

  return (
    <main className="container">
      <h1>LLM Bridge Example</h1>
      <p className="muted">
        Lists connected models and runs prompts through AI SDK using the bridge
        model.
      </p>

      <section className="card">
        <div className="row">
          <button
            id="refresh-models"
            type="button"
            onClick={() => void refreshModels()}
            disabled={busy !== null}
          >
            Refresh Models
          </button>
          <span id="model-count" className="muted">
            {models.length} models
          </span>
        </div>
        <label htmlFor="model-select">Model</label>
        <select
          id="model-select"
          value={selectedModelId}
          onChange={(event) => setSelectedModelId(event.target.value)}
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.id} ({model.name})
            </option>
          ))}
        </select>
      </section>

      <section className="card">
        <label htmlFor="prompt">Prompt</label>
        <textarea
          id="prompt"
          rows={8}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <div className="row">
          <button
            type="button"
            onClick={() => void runGenerate()}
            disabled={busy !== null}
          >
            Generate
          </button>
          <button
            type="button"
            onClick={() => void runStream()}
            disabled={busy !== null}
          >
            Stream
          </button>
          <span id="status" className="muted">
            {status}
          </span>
        </div>
      </section>

      <section className="card">
        <label htmlFor="result">Result</label>
        <pre id="result">{result}</pre>
      </section>

      <section className="card">
        <label htmlFor="debug">Debug</label>
        <pre id="debug">{debugLines.join("\n")}</pre>
      </section>
    </main>
  );
}
