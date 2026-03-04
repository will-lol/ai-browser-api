# LLM Bridge Architecture (Effect-First)

## Package Graph

- `@llm-bridge/contracts`
  - Owns all boundary contracts: Effect schemas, RPC groups, event schemas, tagged errors.
- `@llm-bridge/runtime-core`
  - Pure application logic using Effect services and layers.
  - Depends on `@llm-bridge/contracts` only.
- `@llm-bridge/extension`
  - Browser/extension infrastructure and entrypoints.
  - Provides runtime-core repositories, runs RPC servers, and manages UI-facing runtime state.
- `@llm-bridge/client`
  - Promise-first browser SDK backed by Effect RPC.
  - Consumes `@llm-bridge/contracts` and `@effect/rpc`.
- `@llm-bridge/example-app`
  - Consumer application using `@llm-bridge/client`.

## Import Rules

- Allowed:
  - `contracts -> effect, @effect/rpc`
  - `runtime-core -> contracts, effect`
  - `extension -> runtime-core, contracts, browser infra`
  - `client -> contracts, effect, @effect/rpc`
- Disallowed:
  - Cross-package imports targeting another package's `src` internals.

## Runtime Topology

1. Background worker starts `runtime-core` with infrastructure layers from `extension`.
2. Background exposes `RuntimeRpcGroup` via Effect RPC over Chrome runtime ports.
3. Content script exposes `PageBridgeRpcGroup` via Effect RPC over `MessagePort` to the page.
4. `@llm-bridge/client` connects to content bridge and exposes a Promise-first SDK.
5. Runtime events are schema-validated with the shared event contract from `contracts`.
