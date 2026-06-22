/**
 * Generic coalescing TTL cache. Stores values by string key with a configurable
 * time-to-live. Concurrent cold lookups for the same key share a single upstream
 * fetch (single-flight coalescing). Expired entries are pruned on a throttled
 * schedule. Carries no domain knowledge about what it stores.
 */

import type { Logger } from '../../types/index.js';
import { evictOldestOverCap } from './cacheUtils.js';

interface CacheEntry<V> {
  readonly value: V;
  readonly timestamp: number;
}

export class CoalescingTtlCache<V> {
  private readonly ttlMs: number;
  private readonly pruneIntervalMs: number;
  private readonly logger: Logger;
  private lastPrune: number;
  private readonly entries = new Map<string, CacheEntry<V>>();
  private readonly inFlight = new Map<string, Promise<V>>();

  /**
   * @param ttlMs - How long a stored value is considered fresh (milliseconds).
   * @param pruneIntervalMs - Minimum gap between prune sweeps (milliseconds).
   * @param logger - Optional structured logger; defaults to a no-op.
   * @param now - Wall-clock seed for the prune throttle; defaults to Date.now().
   */
  constructor(ttlMs: number, pruneIntervalMs: number, logger: Logger = () => {}, now = Date.now()) {
    this.ttlMs = ttlMs;
    this.pruneIntervalMs = pruneIntervalMs;
    this.logger = logger;
    this.lastPrune = now;
  }

  /**
   * Return a cached value or fetch a fresh one. Concurrent cold lookups for the
   * same key are coalesced onto a single upstream call. The fetched value is
   * stored with the supplied timestamp so tests can control freshness without
   * wall-clock coupling.
   */
  public async get(key: string, fetch: () => Promise<V>, now = Date.now()): Promise<V> {
    this.prune(now);

    const cached = this.entries.get(key);
    if (cached !== undefined && now - cached.timestamp < this.ttlMs) {
      this.logger('debug', 'cache hit', { key });
      return cached.value;
    }

    const value = await this.coalesced(key, fetch);
    this.entries.set(key, { value, timestamp: now });
    this.logger('debug', 'cache store', { key });
    return value;
  }

  /**
   * Return the stored value for a key, ignoring expiry and without triggering a
   * prune sweep. Returns undefined when no entry has ever been stored under the
   * key. The explicit name signals that a stale value may be returned, making
   * the TTL bypass visible at every call site.
   */
  public peekStale(key: string): V | undefined {
    return this.entries.get(key)?.value;
  }

  /** Number of entries currently in the cache (including expired ones). */
  public size(): number {
    return this.entries.size;
  }

  /** Remove all entries. */
  public clear(): void {
    this.entries.clear();
  }

  /**
   * Coalesce concurrent cold lookups for the same key onto a single upstream
   * call. The in-flight entry clears when the fetch settles (success or error)
   * so a subsequent call retries rather than hanging on a dead promise.
   */
  private coalesced(key: string, fetch: () => Promise<V>): Promise<V> {
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return existing;
    const promise = fetch().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  /**
   * Remove entries older than ttlMs, then evict the oldest excess entries when
   * the map is still over the cap. Throttled by pruneIntervalMs so a busy cache
   * does not run a full sweep on every get call.
   */
  private prune(now: number): void {
    if (now - this.lastPrune < this.pruneIntervalMs) return;
    this.lastPrune = now;

    let pruned = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.entries.delete(key);
        pruned++;
      }
    }

    pruned += evictOldestOverCap(this.entries, (entry) => entry.timestamp);

    if (pruned > 0) {
      this.logger('debug', 'cache pruned', { count: pruned, remaining: this.entries.size });
    }
  }
}
