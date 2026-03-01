# Plugin Auth Contract

Auth execution is plugin-owned. Core runtime owns secure storage, popup lifecycle, cancellation, and provider refresh.

## Overview

Each auth-capable plugin defines `hooks.auth` with:

1. `provider`: provider identifier (`"gitlab"`, `"google"`, `"openai"`) or `"*"`.
2. `methods(ctx)`: returns auth methods shown in the connect UI.
3. `loader(auth, provider, ctx)`: converts stored auth into runtime request options, including refresh logic when needed.

## Method shape

Each returned method must include:

1. `id`: stable plugin-local method identifier.
2. `type`: one of `oauth`, `pat`, `apikey`.
3. `label`: UI label.
4. `fields` (optional): user input fields.
5. `authorize(context)`: executes login and returns final auth credentials.

Core runtime exposes each method as `${pluginID}:${method.id}`.

## Authorize context

`authorize(context)` receives:

1. `providerID`, `provider`, `auth`.
2. `values`: validated form values from UI.
3. `signal`: cancellation signal.
4. `oauth.getRedirectURL(path)`.
5. `oauth.launchWebAuthFlow(url)`.
6. `oauth.parseCallback(url)`.
7. `runtime.now()`.

## OAuth requirements

OAuth methods must use extension redirect URLs only:

1. Build redirect URI using `oauth.getRedirectURL(path)`.
2. Start browser flow with `oauth.launchWebAuthFlow(url)`.
3. Parse callback using `oauth.parseCallback(callbackUrl)`.
4. Validate state/PKCE inside plugin logic.
5. Exchange code for tokens and return `type: "oauth"` auth result.

No localhost callback server.
No hosted redirect relay.
No core-level manual code entry fallback.

## Storage model

Credential persistence is core-owned (`auth-store`).

1. Plugins return `AuthResult` only.
2. Core writes credentials to secure store.
3. Plugins perform refresh in `loader` and write updated tokens through core storage APIs.

## Error handling

Plugins should throw explicit user-facing errors for:

1. Redirect URI rejection by provider.
2. Missing/invalid OAuth callback parameters.
3. State/PKCE mismatch.
4. PAT/API key validation failure.
5. Refresh/token exchange failures.
