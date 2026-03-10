import * as Cause from "effect/Cause";

export function isInterruptedOnlyCause(cause: unknown): boolean {
  return Cause.isCause(cause) && Cause.isInterruptedOnly(cause);
}
