/**
 * Shared cache eviction utilities used by the location cache in AccuWeatherService
 * and by ForecastCache.
 */

/** Maximum number of entries in any cache before eviction kicks in. */
export const MAX_CACHE_SIZE = 100;

/**
 * Evict the lowest-`ageValue` entries from `map` until it holds at most
 * MAX_CACHE_SIZE items. Returns the number removed. Shared by the location and
 * forecast cache prunes so the sort-and-slice-oldest eviction lives in one place.
 */
export function evictOldestOverCap<K, V>(map: Map<K, V>, ageValue: (entry: V) => number): number {
  if (map.size <= MAX_CACHE_SIZE) return 0;
  const entries = Array.from(map.entries()).sort((a, b) => ageValue(a[1]) - ageValue(b[1]));
  const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
  for (const [key] of toRemove) {
    map.delete(key);
  }
  return toRemove.length;
}
