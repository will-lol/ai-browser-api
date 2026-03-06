import { streamText } from "ai";
import {
  BridgeClient,
  type BridgeModelSummary,
  withBridgeClient,
} from "@llm-bridge/client";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { Send, User, Bot, Loader2, RefreshCw } from "lucide-react";

const DEFAULT_MODEL_ID = "google/gemini-3.1-pro-preview";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function App() {
  const [models, setModels] = useState<ReadonlyArray<BridgeModelSummary>>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [status, setStatus] = useState("Idle");

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const startupRefreshTriggeredRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const pushError = useCallback((event: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const line = `[example-app] ${new Date().toISOString()} ${event} ${message}`;
    console.error(line);
  }, []);

  const runBridge = useCallback(
    <A,>(program: Effect.Effect<A, unknown, BridgeClient>) =>
      Effect.runPromise(withBridgeClient(program)),
    [],
  );

  const refreshModels = useCallback(async () => {
    if (refreshInFlightRef.current) {
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
      } catch (error) {
        pushError("refreshModels.failed", error);
        setStatus("Failed to load models");
      }
    })();

    refreshInFlightRef.current = refreshTask.finally(() => {
      refreshInFlightRef.current = null;
    });

    return refreshInFlightRef.current;
  }, [pushError, runBridge]);

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

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading || !selectedModelId) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setError(null);

    const assistantMessageId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      { id: assistantMessageId, role: "assistant", content: "" },
    ]);

    try {
      const model = await loadModel(selectedModelId);

      const streamResult = streamText({
        model,
        messages: newMessages,
        providerOptions: {
          openai: { instructions: "You are a helpful assistant" },
        },
      });

      for await (const chunk of streamResult.textStream) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: msg.content + chunk }
              : msg,
          ),
        );
      }
    } catch (err) {
      pushError("stream.failed", err);
      setError(err instanceof Error ? err : new Error(String(err)));
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last.id === assistantMessageId && last.content === "") {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    if (startupRefreshTriggeredRef.current) return;

    startupRefreshTriggeredRef.current = true;
    void refreshModels();
  }, [refreshModels]);

  return (
    <div className="flex flex-col h-screen bg-[#0b1220] text-[#e5edf8] font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#223557] bg-[#101a2f] shrink-0">
        <div>
          <h1 className="text-xl font-semibold m-0 tracking-wide">
            LLM Bridge
          </h1>
          <p className="text-sm text-[#94a7c4] mt-1 m-0">
            {status === "Loading models..."
              ? "Loading..."
              : `${models.length} models connected`}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => void refreshModels()}
            disabled={status === "Loading models..."}
            className="p-2 rounded-lg bg-[#0d1730] border border-[#334b75] text-[#e5edf8] hover:bg-[#223557] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Refresh Models"
          >
            <RefreshCw
              className={`w-5 h-5 ${status === "Loading models..." ? "animate-spin" : ""}`}
            />
          </button>
          <select
            className="px-4 py-2 rounded-lg bg-[#0d1730] border border-[#334b75] text-[#e5edf8] focus:outline-none focus:border-blue-500 min-w-[200px]"
            value={selectedModelId}
            onChange={(event) => setSelectedModelId(event.target.value)}
            disabled={models.length === 0}
          >
            {models.length === 0 ? (
              <option value="">No models available</option>
            ) : (
              models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id} ({model.name})
                </option>
              ))
            )}
          </select>
        </div>
      </header>

      {/* Chat Messages Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-8">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#94a7c4] space-y-4">
            <Bot className="w-16 h-16 opacity-50" />
            <h2 className="text-xl font-medium">How can I help you today?</h2>
            <p className="text-sm opacity-75 text-center max-w-md">
              Type a message below to start chatting. The AI SDK will stream the
              response directly via your local Bridge model.
            </p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-8 pb-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-4 md:gap-6 ${
                  message.role === "user" ? "flex-row-reverse" : "flex-row"
                }`}
              >
                <div
                  className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm
                    ${
                      message.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-[#223557] text-[#e5edf8]"
                    }
                  `}
                >
                  {message.role === "user" ? (
                    <User className="w-5 h-5" />
                  ) : (
                    <Bot className="w-5 h-5" />
                  )}
                </div>
                <div
                  className={`flex flex-col max-w-[85%] ${
                    message.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`px-5 py-3.5 rounded-2xl whitespace-pre-wrap break-words leading-relaxed
                      ${
                        message.role === "user"
                          ? "bg-blue-600 text-white rounded-tr-sm"
                          : "bg-[#101a2f] text-[#e5edf8] border border-[#223557] rounded-tl-sm"
                      }
                    `}
                  >
                    {message.content}
                  </div>
                </div>
              </div>
            ))}

            {/* Loading Indicator */}
            {isLoading && messages[messages.length - 1]?.role === "user" && (
              <div className="flex gap-4 md:gap-6 flex-row max-w-4xl mx-auto">
                <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm bg-[#223557] text-[#e5edf8]">
                  <Bot className="w-5 h-5" />
                </div>
                <div className="px-5 py-4 rounded-2xl bg-[#101a2f] border border-[#223557] rounded-tl-sm flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full bg-[#94a7c4] animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  ></span>
                  <span
                    className="w-2 h-2 rounded-full bg-[#94a7c4] animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  ></span>
                  <span
                    className="w-2 h-2 rounded-full bg-[#94a7c4] animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  ></span>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="flex justify-center">
                <div className="bg-red-900/50 border border-red-500/50 text-red-200 px-4 py-3 rounded-lg text-sm max-w-lg text-center">
                  An error occurred: {error.message}. Please try again.
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* Input Area */}
      <footer className="p-4 sm:p-6 bg-[#0b1220] border-t border-[#223557] shrink-0">
        <form
          onSubmit={handleSubmit}
          className="max-w-4xl mx-auto relative flex items-end bg-[#101a2f] border border-[#334b75] rounded-2xl focus-within:ring-2 focus-within:ring-blue-500/50 focus-within:border-blue-500 transition-all shadow-sm"
        >
          <textarea
            className="w-full bg-transparent text-[#e5edf8] placeholder-[#94a7c4] border-none focus:ring-0 resize-none py-4 pl-5 pr-14 max-h-32 min-h-[56px] focus:outline-none rounded-2xl"
            placeholder={
              models.length === 0
                ? "Connecting to models..."
                : "Message the AI..."
            }
            value={input}
            onChange={handleInputChange}
            disabled={models.length === 0 || isLoading}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() && !isLoading) {
                  void handleSubmit();
                }
              }
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading || models.length === 0}
            className="absolute right-2 bottom-2 p-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:bg-transparent disabled:text-[#94a7c4] flex items-center justify-center"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </form>
        <p className="text-center text-xs text-[#94a7c4] mt-3">
          Powered by Vercel AI SDK and @llm-bridge/client
        </p>
      </footer>
    </div>
  );
}
