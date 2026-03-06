export interface RewrittenTransportRequest<TMetadata = void> {
  request: RequestInfo | URL;
  init: RequestInit;
  metadata: TMetadata;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface TransportFetchPipelineOptions<TMetadata = void> {
  rewriteRequest: (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
  ) => Promise<RewrittenTransportRequest<TMetadata> | null>;
  normalizeResponse?: (
    response: Response,
    metadata: TMetadata,
  ) => Promise<Response> | Response;
  fetchFn?: FetchLike;
  maxAttempts?: number;
  baseRetryDelayMs?: number;
  retryStatuses?: ReadonlySet<number>;
  resolveRetryDelayMs?: (
    response: Response,
    attempt: number,
    baseRetryDelayMs: number,
  ) => Promise<number | undefined> | number | undefined;
  isRetryableNetworkError?: (error: unknown) => boolean;
}

const DEFAULT_RETRYABLE_STATUSES = new Set([429, 503, 504]);

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function parseRetryAfterMs(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
    return undefined;
  }

  const timestamp = Date.parse(trimmed);
  if (!Number.isNaN(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }

  return undefined;
}

export function backoffDelayMs(attempt: number, baseDelayMs: number) {
  const exponential = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, 8_000);
  const jitter = Math.floor(Math.random() * 250);
  return capped + jitter;
}

export function isRetryableNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  if (error instanceof TypeError) return true;
  return /network|fetch|timed out|timeout/i.test(error.message);
}

async function defaultRetryDelayResolver(
  response: Response,
  attempt: number,
  baseRetryDelayMs: number,
) {
  const headerDelay = parseRetryAfterMs(response.headers.get("Retry-After"));
  if (typeof headerDelay === "number") {
    return headerDelay;
  }

  return backoffDelayMs(attempt, baseRetryDelayMs);
}

async function fetchWithRetry(
  fetchFn: FetchLike,
  request: RequestInfo | URL,
  init: RequestInit,
  options: {
    maxAttempts: number;
    baseRetryDelayMs: number;
    retryStatuses: ReadonlySet<number>;
    resolveRetryDelayMs: (
      response: Response,
      attempt: number,
      baseRetryDelayMs: number,
    ) => Promise<number | undefined>;
    isRetryableNetworkError: (error: unknown) => boolean;
  },
): Promise<Response> {
  let attempt = 1;

  while (attempt <= options.maxAttempts) {
    try {
      const response = await fetchFn(request, init);
      if (
        !options.retryStatuses.has(response.status) ||
        attempt >= options.maxAttempts
      ) {
        return response;
      }

      const delay = await options.resolveRetryDelayMs(
        response,
        attempt,
        options.baseRetryDelayMs,
      );
      if (typeof delay === "number" && delay > 0) {
        await sleep(delay);
      }

      attempt += 1;
      continue;
    } catch (error) {
      if (
        !options.isRetryableNetworkError(error) ||
        attempt >= options.maxAttempts
      ) {
        throw error;
      }

      await sleep(backoffDelayMs(attempt, options.baseRetryDelayMs));
      attempt += 1;
    }
  }

  return fetchFn(request, init);
}

export function createTransportFetchPipeline<TMetadata = void>(
  options: TransportFetchPipelineOptions<TMetadata>,
): FetchLike {
  const fetchFn = options.fetchFn ?? fetch;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseRetryDelayMs = Math.max(100, options.baseRetryDelayMs ?? 350);
  const retryStatuses = options.retryStatuses ?? DEFAULT_RETRYABLE_STATUSES;
  const retryDelayResolver = async (
    response: Response,
    attempt: number,
    baseDelayMs: number,
  ) => {
    const custom = await options.resolveRetryDelayMs?.(
      response,
      attempt,
      baseDelayMs,
    );
    if (typeof custom === "number") {
      return custom;
    }

    return defaultRetryDelayResolver(response, attempt, baseDelayMs);
  };

  const retryableNetworkError =
    options.isRetryableNetworkError ?? isRetryableNetworkError;

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const rewritten = await options.rewriteRequest(input, init);
    if (!rewritten) {
      return fetchFn(input, init);
    }

    const response = await fetchWithRetry(
      fetchFn,
      rewritten.request,
      rewritten.init,
      {
        maxAttempts,
        baseRetryDelayMs,
        retryStatuses,
        resolveRetryDelayMs: retryDelayResolver,
        isRetryableNetworkError: retryableNetworkError,
      },
    );

    if (!options.normalizeResponse) {
      return response;
    }

    return options.normalizeResponse(response, rewritten.metadata);
  };
}
