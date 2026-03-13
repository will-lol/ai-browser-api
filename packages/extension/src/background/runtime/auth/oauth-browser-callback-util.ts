import { browser } from "@wxt-dev/browser";
import * as Effect from "effect/Effect";

export type OAuthWebRequestOnBeforeRequest = NonNullable<
  NonNullable<typeof browser.webRequest>["onBeforeRequest"]
>;

export type OAuthCallbackRequestListener = Parameters<
  OAuthWebRequestOnBeforeRequest["addListener"]
>[0];
export type OAuthCallbackRequestDetails =
  Parameters<OAuthCallbackRequestListener>[0];

type WaitForOAuthCallbackOptions = {
  urlPattern: string;
  matchesUrl: (url: string) => boolean;
  timeoutMs: number;
  unsupportedErrorMessage: string;
  timeoutErrorMessage: string;
  registerListenerErrorPrefix: string;
  signal?: AbortSignal;
  onBeforeRequest?: OAuthWebRequestOnBeforeRequest;
};

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export function waitForOAuthCallback(options: WaitForOAuthCallbackOptions) {
  return Effect.async<string, Error>(
    (resume: (_: Effect.Effect<string, Error>) => void) => {
    const onBeforeRequest =
      options.onBeforeRequest ?? browser?.webRequest?.onBeforeRequest;
    if (!onBeforeRequest) {
      resume(Effect.fail(new Error(options.unsupportedErrorMessage)));
      return;
    }

    let settled = false;
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      clearTimeout(timeoutId);
      try {
        onBeforeRequest.removeListener(listener);
      } catch {
        // Ignore teardown errors while auth is ending.
      }
      options.signal?.removeEventListener("abort", onAbort);
    };

    const finalize = (effect: Effect.Effect<string, Error>) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resume(effect);
    };

    const listener: OAuthCallbackRequestListener = (details) => {
      if (details.type !== "main_frame") return undefined;
      if (!options.matchesUrl(details.url)) return undefined;

      finalize(Effect.succeed(details.url));
      return undefined;
    };

    const onAbort = () => {
      finalize(Effect.fail(new Error("Authentication canceled")));
    };

    const timeoutId = setTimeout(() => {
      finalize(Effect.fail(new Error(options.timeoutErrorMessage)));
    }, options.timeoutMs);

    try {
      onBeforeRequest.addListener(listener, {
        urls: [options.urlPattern],
        types: ["main_frame"],
      });
    } catch (error) {
      finalize(
        Effect.fail(
          new Error(
            `${options.registerListenerErrorPrefix}: ${toErrorMessage(error)}`,
          ),
        ),
      );
      return;
    }

    if (options.signal?.aborted) {
      onAbort();
      return Effect.sync(cleanup);
    }

    options.signal?.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(cleanup);
    },
  );
}
