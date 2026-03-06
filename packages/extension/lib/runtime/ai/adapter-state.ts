import { isObject, mergeRecord } from "@/lib/runtime/util";

const functionCacheKeys = new WeakMap<
  (...args: unknown[]) => unknown,
  string
>();
let functionCacheCounter = 0;

function nextFunctionCacheKey() {
  functionCacheCounter += 1;
  return `fn:${functionCacheCounter}`;
}

function cacheKeyForFunction(fn: (...args: unknown[]) => unknown) {
  const existing = functionCacheKeys.get(fn);
  if (existing) return existing;

  const generated = nextFunctionCacheKey();
  functionCacheKeys.set(fn, generated);
  return generated;
}

export function mergeAdapterCacheKeyParts(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  return mergeRecord(base, patch);
}

export function normalizeValueForCache(value: unknown): unknown {
  if (typeof value === "function") {
    return {
      __function: cacheKeyForFunction(value as (...args: unknown[]) => unknown),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValueForCache(item));
  }

  if (!isObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, normalizeValueForCache(nested)]),
  );
}
