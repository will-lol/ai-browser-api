# Creating Adapters

## Choose The Adapter Type

- Create a provider override adapter when auth, transport, or catalog behavior is specific to one `providerID`.
- Create a generic npm adapter when many providers share the same SDK package behavior.
- Provider overrides win over npm adapters during resolution.

## Required Shape

- `key`
- `displayName`
- `match`
- `auth.methods()`
- `auth.parseStoredAuth()`
- `auth.serializeAuth()`
- `createModel()`

Optional:

- `auth.load()` to refresh persisted auth into transport plus typed adapter state
- `patchCatalog()` to alter provider/model metadata before it is stored

## Zod Rules

- Only model serializable auth/config inputs with Zod.
- Use `defineAuthSchema()` and return that schema from each auth method.
- Do not model runtime-only values like `fetch`, browser tabs, or callback handlers in Zod schemas.
- Use Zod to parse persisted auth metadata in `auth.parseStoredAuth()` instead of hand-written `typeof` trees.
- Use Zod to validate successful `response.json()` payloads from OAuth and provider APIs instead of `as SomeResponse` casts.

## Auth Persistence

- Auth is always stored by `providerID`.
- Adapters must parse stored auth through `auth.parseStoredAuth()` instead of reading raw metadata directly anywhere else.
- Adapters must return persisted auth through `auth.serializeAuth()` so `methodID`, `methodType`, and typed metadata stay normalized.
- `auth.parseStoredAuth()` is the only place that should read legacy metadata markers or tolerate older record shapes.
- Adapters may refresh tokens and persist updated auth during `auth.load()`.
- OAuth/device/browser flows should return a normalized `AuthResult`.

## Adapter State

- Keep `RuntimeTransportConfig` transport-only: `baseURL`, auth, headers, and `fetch`.
- Do not use transport as a hidden adapter-state channel.
- If execution needs adapter-private state, return it from `auth.load()` and consume it from `createModel({ state })`.
- Persisted auth metadata should be JSON-compatible and typed per adapter.
- The shared runtime resolves adapters into an opaque session wrapper. Runtime code should call the session's `createModel()` closure and never inspect adapter-private state directly.

## Browser Constraints

- If an SDK package is not browser-safe, make that explicit in `createModel()`.
- Keep custom transport behavior local to the adapter.
- Avoid introducing generic request-mutation pipelines in the shared runtime.

## Examples

- Generic adapter: npm package plus API key auth, then call `createFactoryLanguageModel()`.
- Provider override adapter: provider-specific auth plus optional `patchCatalog()` and a wrapped `LanguageModelV3` from `createModel()`.
