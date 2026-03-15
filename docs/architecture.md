# LLM Bridge Architecture

## Package Graph

- `@llm-bridge/contracts`
  - Owns all boundary contracts: Effect schemas, RPC groups, stream element schemas, tagged errors.
- `@llm-bridge/bridge-codecs`
  - Owns pure AI SDK v3 `<->` runtime wire codecs shared by the browser client and extension runtime adapters.
  - Depends on `@llm-bridge/contracts` and `@ai-sdk/provider`.
- `@llm-bridge/runtime-core`
  - Pure application logic organized around domain services (`CatalogService`, `PermissionsService`, `AuthFlowService`, `ModelExecutionService`, `MetaService`).
  - Depends on `@llm-bridge/contracts` plus shared Effect-only utilities.
- `@llm-bridge/effect-utils`
  - Effect-only shared primitives that need one canonical owner across packages.
  - Currently owns the resettable connection lifecycle used by both the client and extension transport layers.
- `@llm-bridge/extension`
  - Browser/extension infrastructure and entrypoints.
  - Implements the domain services, runs the canonical runtime RPC server, hosts the content-script page bridge, and launches background daemons such as toolbar projection.
- `@llm-bridge/client`
  - Factory API (`createBridgeClient()`) backed by Effect RPC internally.
  - Exposes AI SDK-compatible `LanguageModelV3` from `getModel`.
  - Exposes a stable AI SDK UI `ChatTransport` from `getChatTransport`, with
    `modelId` supplied per chat request rather than bound to the transport.
  - Consumes `@llm-bridge/contracts`, `@effect/rpc`, and the public `runtime-core` APIs it re-exports.
- `@llm-bridge/reactive-core`
  - Shared reactive state primitives used by the extension UI layer.
- `@llm-bridge/client-react`
  - React-facing bindings for the bridge client.
- `@llm-bridge/example-app`
  - Consumer application using `@llm-bridge/client`.

## Import Rules

- Allowed:
  - `contracts -> effect, @effect/rpc`
  - `bridge-codecs -> contracts, @ai-sdk/provider`
  - `effect-utils -> effect`
  - `runtime-core -> contracts, effect`
  - `extension -> bridge-codecs, effect-utils, runtime-core, reactive-core, contracts, browser infra`
  - `client -> bridge-codecs, runtime-core, contracts, effect, @effect/rpc`
  - `client-react -> client, reactive-core, react`
- Disallowed:
  - Cross-package imports targeting another package's `src` internals.

## Runtime Topology

1. Background worker launches a composed Effect app built from domain service layers plus scoped daemons.
2. Background exposes public and admin Effect RPC groups over Chrome runtime ports.
3. Content script exposes a page bridge over `MessagePort` and injects the trusted `window.location.origin` into internal public runtime RPC calls.
4. `@llm-bridge/client` connects to the page bridge and returns a plain client object with model/chat adapters.
5. Extension UI consumes typed RPC state streams for providers, models, permissions, pending requests, and auth flow.

## Request Option Ownership

- Runtime does not inject provider-specific `thinking`, `reasoning`, or `store` defaults.
- Caller-supplied request options are authoritative.
- If reasoning/thinking behavior is desired for a model, it must be set explicitly by the caller.
- `getModel()` is the stateless AI SDK Core path; `getChatTransport()` is the
  AI SDK UI path.
- Model identity remains runtime request data, not transport identity.
