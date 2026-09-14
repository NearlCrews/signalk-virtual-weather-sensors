/**
 * Shared cache eviction utilities used by CoalescingTtlCache and ForecastCache.
 */

/** Maximum number of entries in any cache before eviction kicks in. */
export const MAX_CACHE_SIZE = 100;

/**
 * Evict the lowest-`ageValue` entries from `map` until it holds at most
 * `maxSize` items. Returns the number removed. Shared by every cache prune so
 * the sort-and-slice-oldest eviction, and the rule that oldest means lowest
 * `ageValue`, live in one place. `maxSize` defaults to MAX_CACHE_SIZE; a cache
 * whose entries are large (a whole forecast document) passes a smaller cap.
 */
export function evictOldestOverCap<K, V>(
  map: Map<K, V>,
  ageValue: (entry: V) => number,
  maxSize: number = MAX_CACHE_SIZE
): number {
  if (map.size <= maxSize) return 0;
  const entries = Array.from(map.entries()).sort((a, b) => ageValue(a[1]) - ageValue(b[1]));
  const toRemove = entries.slice(0, entries.length - maxSize);
  for (const [key] of toRemove) {
    map.delete(key);
  }
  return toRemove.length;
}
