# LLM Bridge Architecture

## Package Graph

- `@llm-bridge/contracts`
  - Owns all boundary contracts: Effect schemas, RPC groups, event schemas, tagged errors.
- `@llm-bridge/bridge-codecs`
  - Owns pure AI SDK v3 `<->` runtime wire codecs shared by the browser client and extension runtime adapters.
  - Depends on `@llm-bridge/contracts` and `@ai-sdk/provider`.
- `@llm-bridge/runtime-core`
  - Pure application logic organized by behavior (`auth`, `models`, `permissions`) around one `RuntimeEnvironment`.
  - Depends on `@llm-bridge/contracts` only.
- `@llm-bridge/runtime-events`
  - Shared Effect event bus + transport interfaces for runtime event fanout.
  - Depends on `@llm-bridge/contracts` and `effect`.
- `@llm-bridge/extension`
  - Browser/extension infrastructure and entrypoints.
  - Implements `RuntimeEnvironment`, runs the canonical runtime RPC server, and provides browser transport adapters for runtime events.
- `@llm-bridge/client`
  - Factory API (`createBridgeClient()`) backed by Effect RPC internally.
  - Exposes AI SDK-compatible `LanguageModelV3` from `getModel`.
  - Exposes a stable AI SDK UI `ChatTransport` from `getChatTransport`, with
    `modelId` supplied per chat request rather than bound to the transport.
  - Consumes `@llm-bridge/contracts` and `@effect/rpc`.
- `@llm-bridge/example-app`
  - Consumer application using `@llm-bridge/client`.

## Import Rules

- Allowed:
  - `contracts -> effect, @effect/rpc`
  - `bridge-codecs -> contracts, @ai-sdk/provider`
  - `runtime-core -> contracts, effect`
  - `runtime-events -> contracts, effect`
  - `extension -> bridge-codecs, runtime-core, runtime-events, contracts, browser infra`
  - `client -> bridge-codecs, contracts, effect, @effect/rpc`
- Disallowed:
  - Cross-package imports targeting another package's `src` internals.

## Runtime Topology

1. Background worker starts `runtime-core` with a single `RuntimeEnvironment` layer from `extension`.
2. Background exposes `RuntimeRpcGroup` via Effect RPC over Chrome runtime ports.
3. Content script exposes the same canonical runtime RPC protocol over `MessagePort` to the page.
4. `@llm-bridge/client` connects to the content bridge and returns a plain client object with model/chat adapters.
5. Runtime events flow through `@llm-bridge/runtime-events` and are schema-validated with shared contracts.

## Request Option Ownership

- Runtime does not inject provider-specific `thinking`, `reasoning`, or `store` defaults.
- Caller-supplied request options are authoritative.
- If reasoning/thinking behavior is desired for a model, it must be set explicitly by the caller.
- `getModel()` is the stateless AI SDK Core path; `getChatTransport()` is the
  AI SDK UI path.
- Model identity remains runtime request data, not transport identity.
