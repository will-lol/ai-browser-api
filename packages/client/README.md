# @llm-bridge/client

Minimal browser client for talking to the LLM Bridge extension via `window.postMessage`.

## Install

```bash
bun add @llm-bridge/client
# or
npm i @llm-bridge/client
```

## Usage

```ts
import { createLLMBridgeClient } from "@llm-bridge/client"

const bridge = createLLMBridgeClient()
const models = await bridge.listModels()

if (models.length > 0) {
  const model = await bridge.getModel(models[0].id)
  const response = await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
  })
  console.log(response)
}
```
