import { useRef } from "react"

interface UseFrozenOrderOptions<T> {
  groupBy?: (item: T) => string | number
}

export function useFrozenOrder<T>(
  items: T[],
  getId: (item: T) => string,
  compareFn: (a: T, b: T) => number,
  options: UseFrozenOrderOptions<T> = {},
) {
  const frozenOrder = useRef<string[] | null>(null)
  const sortedItems = [...items].sort(compareFn)
  const sortedIds = sortedItems.map(getId)
  const groupBy = options.groupBy

  if (frozenOrder.current === null) {
    frozenOrder.current = sortedIds
    return frozenOrder.current
  }

  const currentOrder = frozenOrder.current
  const sortedIdSet = new Set(sortedIds)
  const retainedIds = currentOrder.filter((id) => sortedIdSet.has(id))

  if (!groupBy) {
    const retainedIdSet = new Set(retainedIds)
    const appendedIds = sortedIds.filter((id) => !retainedIdSet.has(id))

    frozenOrder.current = [...retainedIds, ...appendedIds]
    return frozenOrder.current
  }

  const itemById = new Map(sortedItems.map((item) => [getId(item), item] as const))
  const orderedGroupKeys: string[] = []
  const sortedIdsByGroup = new Map<string, string[]>()

  for (const item of sortedItems) {
    const id = getId(item)
    const key = String(groupBy(item))
    if (!sortedIdsByGroup.has(key)) {
      orderedGroupKeys.push(key)
      sortedIdsByGroup.set(key, [])
    }
    sortedIdsByGroup.get(key)?.push(id)
  }

  const retainedIdsByGroup = new Map<string, string[]>()
  for (const id of retainedIds) {
    const item = itemById.get(id)
    if (!item) continue
    const key = String(groupBy(item))
    if (!retainedIdsByGroup.has(key)) {
      retainedIdsByGroup.set(key, [])
    }
    retainedIdsByGroup.get(key)?.push(id)
  }

  const nextOrder: string[] = []
  for (const key of orderedGroupKeys) {
    const retainedGroupIds = retainedIdsByGroup.get(key) ?? []
    const retainedGroupSet = new Set(retainedGroupIds)
    const sortedGroupIds = sortedIdsByGroup.get(key) ?? []
    const appendedGroupIds = sortedGroupIds.filter((id) => !retainedGroupSet.has(id))
    nextOrder.push(...retainedGroupIds, ...appendedGroupIds)
  }

  frozenOrder.current = nextOrder
  return frozenOrder.current
}
