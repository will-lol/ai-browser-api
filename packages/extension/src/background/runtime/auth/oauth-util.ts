import * as Effect from "effect/Effect";

export function sleep(ms: number) {
  return Effect.sleep(ms);
}

function base64UrlEncodeBytes(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateRandomString(length: number) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((value) => chars[value % chars.length])
    .join("");
}

export function generatePKCE() {
  return Effect.gen(function* () {
    const verifier = generateRandomString(64);
    const digest = yield* Effect.tryPromise({
      try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
      catch: (error) => error,
    });
    const challenge = base64UrlEncodeBytes(new Uint8Array(digest));
    return {
      verifier,
      challenge,
    };
  });
}

export function generateState() {
  return base64UrlEncodeBytes(crypto.getRandomValues(new Uint8Array(32)));
}

export function normalizeDomain(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function normalizeInstanceUrl(value: string) {
  const parsed = new URL(value.includes("://") ? value : `https://${value}`);
  return `${parsed.protocol}//${parsed.host}`;
}

export function buildExtensionRedirectPath(
  providerID: string,
  methodID: string,
) {
  const sanitize = (input: string) =>
    input.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return `${sanitize(providerID)}-${sanitize(methodID)}`;
}

export function parseOAuthCallbackUrl(url: string) {
  const parsed = new URL(url);

  const code = parsed.searchParams.get("code") ?? undefined;
  const state = parsed.searchParams.get("state") ?? undefined;
  const error = parsed.searchParams.get("error") ?? undefined;
  const errorDescription =
    parsed.searchParams.get("error_description") ?? undefined;

  if (code || state || error || errorDescription) {
    return {
      code,
      state,
      error,
      errorDescription,
    };
  }

  const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  if (hash) {
    const params = new URLSearchParams(hash);
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
      error: params.get("error") ?? undefined,
      errorDescription: params.get("error_description") ?? undefined,
    };
  }

  return {
    code: undefined,
    state: undefined,
    error: undefined,
    errorDescription: undefined,
  };
}
