export function sameArray<A>(
  left: ReadonlyArray<A>,
  right: ReadonlyArray<A>,
  sameValue: (left: A, right: A) => boolean,
) {
  return (
    left.length === right.length &&
    left.every((value, index) => sameValue(value, right[index]!))
  );
}

export function sameMap<K, V>(
  left: ReadonlyMap<K, V>,
  right: ReadonlyMap<K, V>,
  sameValue: (left: V, right: V) => boolean,
) {
  if (left.size !== right.size) {
    return false;
  }

  for (const [key, leftValue] of left.entries()) {
    if (!right.has(key)) {
      return false;
    }

    if (!sameValue(leftValue, right.get(key)!)) {
      return false;
    }
  }

  return true;
}

export function replaceIfChanged<A>(
  current: A,
  next: A,
  sameValue: (left: A, right: A) => boolean,
) {
  return sameValue(current, next) ? current : next;
}

export function replaceMapEntryIfChanged<K, V>(
  current: ReadonlyMap<K, V>,
  key: K,
  nextValue: V,
  sameValue: (left: V, right: V) => boolean,
) {
  if (current.has(key) && sameValue(current.get(key)!, nextValue)) {
    return current;
  }

  const next = new Map(current);
  next.set(key, nextValue);
  return next;
}
