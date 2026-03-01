import { useRef } from "react"

export function useFrozenOrder<T>(
  items: T[],
  getId: (item: T) => string,
  compareFn: (a: T, b: T) => number
) {
  const frozenOrder = useRef<string[] | null>(null)

  if (frozenOrder.current === null) {
    const snapshot = [...items].sort(compareFn)
    frozenOrder.current = snapshot.map(getId)
    return frozenOrder.current
  }

  const currentOrder = frozenOrder.current
  const sortedIds = [...items].sort(compareFn).map(getId)
  const sortedIdSet = new Set(sortedIds)

  const retainedIds = currentOrder.filter((id) => sortedIdSet.has(id))
  const retainedIdSet = new Set(retainedIds)
  const appendedIds = sortedIds.filter((id) => !retainedIdSet.has(id))

  frozenOrder.current = [...retainedIds, ...appendedIds]
  return frozenOrder.current
}
