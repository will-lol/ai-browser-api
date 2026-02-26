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
  }

  return frozenOrder.current
}
