import type { UIMessage } from "ai";
import { Bot, Loader2, Send, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  useChat,
  useBridgeModels,
} from "@llm-bridge/client-react";

const DEFAULT_MODEL_ID = "google/gemini-3.1-pro-preview";

function getMessageText(message: UIMessage) {
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

export function App() {
  const { models, status, error: modelsError } = useBridgeModels();
  const {
    messages,
    sendMessage,
    clearError,
    error,
    status: chatStatus,
    isReady: isChatReady,
    isLoading: isTransportLoading,
    transportError,
  } = useChat();
  const [input, setInput] = useState("");
  const [requestedModelId, setRequestedModelId] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedModelId =
    models.find((model) => model.id === requestedModelId)?.id ??
    models.find((model) => model.id === DEFAULT_MODEL_ID)?.id ??
    models[0]?.id ??
    "";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const isLoading = chatStatus === "submitted" || chatStatus === "streaming";
  const isModelsLoading = status === "loading";
  const hasModelsFailure = status === "error" && models.length === 0;
  const hasTransportFailure = transportError != null;

  const statusText = isModelsLoading
    ? "Loading..."
    : hasModelsFailure
      ? "Failed to load models"
      : `${models.length} models connected`;

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();

    const prompt = input.trim();
    if (!prompt || isLoading || !selectedModelId || !isChatReady) {
      return;
    }

    clearError();
    setInput("");

    await sendMessage(
      { text: prompt },
      {
        body: {
          modelId: selectedModelId,
        },
      },
    );
  }

  return (
    <div className="flex h-screen flex-col bg-[#0b1220] font-sans text-[#e5edf8]">
      <header className="flex shrink-0 items-center justify-between border-b border-[#223557] bg-[#101a2f] px-6 py-4">
        <div>
          <h1 className="m-0 text-xl font-semibold tracking-wide">
            LLM Bridge
          </h1>
          <p className="m-0 mt-1 text-sm text-[#94a7c4]">{statusText}</p>
        </div>

        <div className="flex items-center gap-4">
          <select
            className="min-w-[200px] rounded-lg border border-[#334b75] bg-[#0d1730] px-4 py-2 text-[#e5edf8] focus:border-blue-500 focus:outline-none"
            value={selectedModelId}
            onChange={(event) => setRequestedModelId(event.target.value)}
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

      <main className="flex-1 space-y-8 overflow-y-auto p-4 sm:p-6">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center space-y-4 text-[#94a7c4]">
            <Bot className="h-16 w-16 opacity-50" />
            <h2 className="text-xl font-medium">How can I help you today?</h2>
            <p className="max-w-md text-center text-sm opacity-75">
              Type a message below to start chatting. The bridge chat transport
              handles the connection to your local extension.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-8 pb-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-4 md:gap-6 ${
                  message.role === "user" ? "flex-row-reverse" : "flex-row"
                }`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm ${
                    message.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-[#223557] text-[#e5edf8]"
                  }`}
                >
                  {message.role === "user" ? (
                    <User className="h-5 w-5" />
                  ) : (
                    <Bot className="h-5 w-5" />
                  )}
                </div>

                <div
                  className={`flex max-w-[85%] flex-col ${
                    message.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`break-words whitespace-pre-wrap rounded-2xl px-5 py-3.5 leading-relaxed ${
                      message.role === "user"
                        ? "rounded-tr-sm bg-blue-600 text-white"
                        : "rounded-tl-sm border border-[#223557] bg-[#101a2f] text-[#e5edf8]"
                    }`}
                  >
                    {getMessageText(message)}
                  </div>
                </div>
              </div>
            ))}

            {chatStatus === "submitted" &&
              messages[messages.length - 1]?.role === "user" && (
                <div className="mx-auto flex max-w-4xl gap-4 md:gap-6">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#223557] text-[#e5edf8] shadow-sm">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-[#223557] bg-[#101a2f] px-5 py-4">
                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-[#94a7c4]"
                      style={{ animationDelay: "0ms" }}
                    />
                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-[#94a7c4]"
                      style={{ animationDelay: "150ms" }}
                    />
                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-[#94a7c4]"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                </div>
              )}

            {(error || hasModelsFailure || hasTransportFailure) && (
              <div className="flex justify-center">
                <div className="max-w-lg rounded-lg border border-red-500/50 bg-red-900/50 px-4 py-3 text-center text-sm text-red-200">
                  {error?.message ??
                    modelsError?.message ??
                    transportError?.message ??
                    (hasModelsFailure
                      ? "Failed to load models from the bridge."
                      : "Failed to initialize the bridge chat transport.")}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      <footer className="shrink-0 border-t border-[#223557] bg-[#0b1220] p-4 sm:p-6">
        <form
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          className="relative mx-auto flex max-w-4xl items-end rounded-2xl border border-[#334b75] bg-[#101a2f] shadow-sm transition-all focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/50"
        >
          <textarea
            className="max-h-32 min-h-[56px] w-full resize-none rounded-2xl border-none bg-transparent py-4 pl-5 pr-14 text-[#e5edf8] placeholder-[#94a7c4] focus:outline-none focus:ring-0"
            placeholder={
              models.length === 0
                ? "Connecting to models..."
                : !isChatReady || isTransportLoading
                  ? "Preparing chat transport..."
                  : "Message the AI..."
            }
            value={input}
            onChange={(event) => {
              if (error) {
                clearError();
              }
              setInput(event.target.value);
            }}
            disabled={models.length === 0 || isLoading || !isChatReady}
            rows={1}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
          />

          <button
            type="submit"
            disabled={
              !input.trim() || isLoading || models.length === 0 || !isChatReady
            }
            className="absolute right-2 bottom-2 flex items-center justify-center rounded-xl bg-blue-600 p-2 text-white transition-colors hover:bg-blue-700 disabled:bg-transparent disabled:text-[#94a7c4] disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </form>

        <p className="mt-3 text-center text-xs text-[#94a7c4]">
          Powered by Vercel AI SDK and @llm-bridge/client
        </p>
      </footer>
    </div>
  );
}
