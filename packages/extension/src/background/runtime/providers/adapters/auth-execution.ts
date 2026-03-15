export function shouldRefreshAccessToken(
  now: number,
  expiresAt?: number,
  access?: string,
  skewMs = 60_000,
) {
  if (!access) return true;
  if (!expiresAt) return true;
  return expiresAt <= now + skewMs;
}
