# @llm-bridge/client

Factory-based browser client for talking to the LLM Bridge extension via `window.postMessage`.

## Install

```bash
bun add @llm-bridge/client ai effect
# or
npm i @llm-bridge/client ai effect
```

## Usage

```ts
import { generateText } from "ai";
import { createBridgeClient } from "@llm-bridge/client";

const client = await createBridgeClient();
const models = await client.listModels();
const model = await client.getModel(models[0]!.id);

const response = await generateText({
  model,
  prompt: "Hello from the bridge",
});

const text = response.text;
console.log(text);
await client.close();
```

## Chat Usage

`getModel()` is the stateless AI SDK Core path. `getChatTransport()` is the
stable AI SDK UI path.

```ts
import { Chat } from "@ai-sdk/react";
import { createBridgeClient } from "@llm-bridge/client";

const client = await createBridgeClient();
const chat = new Chat({
  transport: client.getChatTransport(),
});

await chat.sendMessage(
  { text: "Hello from the bridge" },
  {
    body: {
      modelId: "google/gemini-3.1-pro-preview",
    },
  },
);
```

## Request Options

`@llm-bridge/client` forwards model request options as provided. The runtime does not inject provider-specific defaults for
`thinking`, `reasoning`, or `store`; set those explicitly when needed.
