# LLM Bridge Architecture (Effect-First)

## Package Graph

- `@llm-bridge/contracts`
  - Owns all boundary contracts: Effect schemas, RPC groups, event schemas, tagged errors.
- `@llm-bridge/bridge-codecs`
  - Owns pure AI SDK v3 `<->` runtime wire codecs shared by the browser client and extension runtime adapters.
  - Depends on `@llm-bridge/contracts` and `@ai-sdk/provider`.
- `@llm-bridge/runtime-core`
  - Pure application logic using repositories for direct reads and Effect services for orchestration.
  - Depends on `@llm-bridge/contracts` only.
- `@llm-bridge/runtime-events`
  - Shared Effect event bus + transport interfaces for runtime event fanout.
  - Depends on `@llm-bridge/contracts` and `effect`.
- `@llm-bridge/extension`
  - Browser/extension infrastructure and entrypoints.
  - Provides runtime-core repositories, runs RPC servers, and provides browser transport adapters for runtime events.
- `@llm-bridge/client`
  - Effect service (`BridgeClient`) backed by Effect RPC.
  - Exposes AI SDK-compatible `LanguageModelV3` from `getModel`.
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

1. Background worker starts `runtime-core` with infrastructure layers from `extension`.
2. Background exposes `RuntimeRpcGroup` via Effect RPC over Chrome runtime ports.
3. Content script exposes `PageBridgeRpcGroup` via Effect RPC over `MessagePort` to the page.
4. `@llm-bridge/client` connects to content bridge and provides an Effect service + AI SDK model adapter.
5. Runtime events flow through `@llm-bridge/runtime-events` and are schema-validated with shared contracts.

## Request Option Ownership

- Runtime does not inject provider-specific `thinking`, `reasoning`, or `store` defaults.
- Caller-supplied request options are authoritative.
- If reasoning/thinking behavior is desired for a model, it must be set explicitly by the caller.
