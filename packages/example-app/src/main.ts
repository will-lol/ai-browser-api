import { createLLMBridgeClient, type BridgeModelSummary } from "@llm-bridge/client"

const DEFAULT_MODEL_ID = "google/gemini-3.1-pro-preview"
const LOG_LIMIT = 250

declare global {
  interface Window {
    __LLM_BRIDGE_DEBUG__?: boolean
    llmBridgeDebug?: {
      refreshModels: () => Promise<void>
      generate: () => Promise<void>
    }
  }
}

const debugLines: string[] = []
window.__LLM_BRIDGE_DEBUG__ = true

const bridge = createLLMBridgeClient({
  debug: true,
})

function getRequiredNode<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) {
    throw new Error(`Missing required node: #${id}`)
  }
  return node as T
}

const refreshModelsButton = getRequiredNode<HTMLButtonElement>("refresh-models")
const generateButton = getRequiredNode<HTMLButtonElement>("generate")
const modelSelect = getRequiredNode<HTMLSelectElement>("model-select")
const modelCount = getRequiredNode<HTMLSpanElement>("model-count")
const promptInput = getRequiredNode<HTMLTextAreaElement>("prompt")
const statusNode = getRequiredNode<HTMLSpanElement>("status")
const resultNode = getRequiredNode<HTMLPreElement>("result")
const debugNode = getRequiredNode<HTMLPreElement>("debug")

function stringify(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function appLog(event: string, meta?: unknown) {
  const line = `[example-app] ${new Date().toISOString()} ${event} ${meta === undefined ? "" : stringify(meta)}`.trim()
  debugLines.unshift(line)
  if (debugLines.length > LOG_LIMIT) {
    debugLines.length = LOG_LIMIT
  }
  debugNode.textContent = debugLines.join("\n")
  console.info(line)
}

function appError(event: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const line = `[example-app] ${new Date().toISOString()} ${event} ${message}`
  debugLines.unshift(line)
  if (debugLines.length > LOG_LIMIT) {
    debugLines.length = LOG_LIMIT
  }
  debugNode.textContent = debugLines.join("\n")
  console.error(line)
}

function setStatus(text: string) {
  statusNode.textContent = text
  appLog("status", { text })
}

function setResult(value: string) {
  resultNode.textContent = value
}

function selectedModelId() {
  return modelSelect.value
}

async function refreshModels() {
  setStatus("Loading models...")

  try {
    const models = await bridge.listModels()
    const googleModels = models.filter((model: BridgeModelSummary) => model.provider === "google")

    modelSelect.innerHTML = ""
    for (const model of googleModels) {
      const option = document.createElement("option")
      option.value = model.id
      option.textContent = `${model.id} (${model.name})`
      modelSelect.append(option)
    }

    if (googleModels.length === 0) {
      modelCount.textContent = "0 models"
      setStatus("No connected Google models.")
      return
    }

    const preferred = googleModels.find((model) => model.id === DEFAULT_MODEL_ID)
    if (preferred) {
      modelSelect.value = preferred.id
    }

    modelCount.textContent = `${googleModels.length} models`
    setStatus("Ready")
  } catch (error) {
    appError("refreshModels.failed", error)
    setStatus("Failed to load models")
  }
}

async function generate() {
  const modelId = selectedModelId()
  const prompt = promptInput.value.trim()

  if (!modelId) {
    setStatus("Pick a model first")
    return
  }

  if (!prompt) {
    setStatus("Enter a prompt first")
    return
  }

  setStatus("Generating...")
  setResult("")
  generateButton.disabled = true

  try {
    const model = await bridge.getModel(modelId)
    const response = await model.doGenerate({
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    })

    setResult(response.text)
    setStatus(`Done (${response.finishReason})`)
  } catch (error) {
    appError("generate.failed", error)
    setStatus("Generation failed")
  } finally {
    generateButton.disabled = false
  }
}

refreshModelsButton.addEventListener("click", () => {
  void refreshModels()
})

generateButton.addEventListener("click", () => {
  void generate()
})

window.llmBridgeDebug = {
  refreshModels,
  generate,
}

void refreshModels()
