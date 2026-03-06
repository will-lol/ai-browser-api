# @llm-bridge/client

Effect-first browser client for talking to the LLM Bridge extension via `window.postMessage`.

## Install

```bash
bun add @llm-bridge/client ai effect
# or
npm i @llm-bridge/client ai effect
```

## Usage

```ts
import { generateText } from "ai"
import { BridgeClient, withBridgeClient } from "@llm-bridge/client"
import * as Effect from "effect/Effect"

const program = Effect.gen(function*() {
  const client = yield* BridgeClient
  const models = yield* client.listModels
  const model = yield* client.getModel(models[0]!.id)

  const response = yield* Effect.tryPromise(() =>
    generateText({
      model,
      prompt: "Hello from the bridge",
    }),
  )

  return response.text
})

const text = await Effect.runPromise(withBridgeClient(program))
console.log(text)
```

## Request Options

`@llm-bridge/client` forwards model request options as provided. The runtime does not inject provider-specific defaults for
`thinking`, `reasoning`, or `store`; set those explicitly when needed.
