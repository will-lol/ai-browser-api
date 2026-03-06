import type { RuntimeEventPayload } from "@/lib/runtime/events/runtime-events"

export type PermissionDecisionWaitResult = "resolved" | "timeout" | "aborted"

export interface PermissionDecisionWaitInput {
  requestId: string
  timeoutMs: number
  signal?: AbortSignal
  isPending: (requestId: string) => Promise<boolean>
  subscribe: (handler: (event: RuntimeEventPayload) => void) => () => void
}

export function mergePendingChangedRequestIds(
  requestId: string,
  staleRequestIds: ReadonlyArray<string>,
) {
  return Array.from(new Set([requestId, ...staleRequestIds]))
}

export async function waitForPermissionDecisionEventDriven(
  input: PermissionDecisionWaitInput,
): Promise<PermissionDecisionWaitResult> {
  if (!(await input.isPending(input.requestId))) {
    return "resolved"
  }

  return await new Promise<PermissionDecisionWaitResult>((resolve) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let unsubscribe: (() => void) | undefined

    const finalize = (result: PermissionDecisionWaitResult) => {
      if (settled) return
      settled = true

      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
      unsubscribe?.()
      unsubscribe = undefined
      input.signal?.removeEventListener("abort", onAbort)
      resolve(result)
    }

    const checkPendingAndFinalize = () => {
      void input
        .isPending(input.requestId)
        .then((pending) => {
          if (!pending) {
            finalize("resolved")
          }
        })
        .catch(() => {
          // Ignore transient read failures and keep waiting until timeout/abort.
        })
    }

    const onAbort = () => {
      finalize("aborted")
    }

    timeoutId = setTimeout(() => {
      void input
        .isPending(input.requestId)
        .then((pending) => {
          finalize(pending ? "timeout" : "resolved")
        })
        .catch(() => {
          finalize("timeout")
        })
    }, input.timeoutMs)

    input.signal?.addEventListener("abort", onAbort, { once: true })
    if (input.signal?.aborted) {
      finalize("aborted")
      return
    }

    unsubscribe = input.subscribe((event) => {
      if (event.type !== "runtime.pending.changed") return
      if (!event.payload.requestIds.includes(input.requestId)) return
      checkPendingAndFinalize()
    })

    // Re-check after listener registration to avoid missing a fast resolution race.
    checkPendingAndFinalize()
  })
}
