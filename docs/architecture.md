# LLM Bridge Architecture

## Package Graph

- `@llm-bridge/contracts`
  - Owns all boundary contracts: Effect schemas, RPC groups, stream element schemas, tagged errors.
- `@llm-bridge/bridge-codecs`
  - Owns pure AI SDK v3 `<->` runtime wire codecs shared by the browser client and extension runtime adapters.
  - Depends on `@llm-bridge/contracts` and `@ai-sdk/provider`.
- `@llm-bridge/runtime-core`
  - Pure application logic organized around domain services (`CatalogService`, `PermissionsService`, `AuthFlowService`, `ModelExecutionService`, `MetaService`).
  - Depends on `@llm-bridge/contracts` only.
- `@llm-bridge/extension`
  - Browser/extension infrastructure and entrypoints.
  - Implements the domain services, runs the canonical runtime RPC server, and launches background daemons such as toolbar projection.
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
  - `extension -> bridge-codecs, runtime-core, contracts, browser infra`
  - `client -> bridge-codecs, contracts, effect, @effect/rpc`
- Disallowed:
  - Cross-package imports targeting another package's `src` internals.

## Runtime Topology

1. Background worker launches a composed Effect app built from domain service layers plus scoped daemons.
2. Background exposes public and admin Effect RPC groups over Chrome runtime ports.
3. Content script exposes the public runtime RPC protocol over `MessagePort` to the page.
4. `@llm-bridge/client` connects to the content bridge and returns a plain client object with model/chat adapters.
5. Extension UI consumes typed RPC state streams for providers, models, permissions, pending requests, and auth flow.

## Request Option Ownership

- Runtime does not inject provider-specific `thinking`, `reasoning`, or `store` defaults.
- Caller-supplied request options are authoritative.
- If reasoning/thinking behavior is desired for a model, it must be set explicitly by the caller.
- `getModel()` is the stateless AI SDK Core path; `getChatTransport()` is the
  AI SDK UI path.
- Model identity remains runtime request data, not transport identity.
