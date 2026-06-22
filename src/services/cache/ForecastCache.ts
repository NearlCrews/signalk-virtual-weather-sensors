/**
 * Generic on-demand forecast cache. Stores raw fetch results keyed by an
 * arbitrary string with per-entry TTLs. Quota-aware: a miss under exhausted
 * quota serves a stale entry when one exists, or throws the injected rate-limit
 * error when nothing is cached. Carries no AccuWeather-specific knowledge.
 */

import type { Logger } from '../../types/index.js';
import { evictOldestOverCap } from './cacheUtils.js';

interface CacheEntry {
  readonly data: unknown;
  readonly expiresAt: number;
}

export class ForecastCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly quotaReachedError: () => Error;
  private readonly logger: Logger;

  constructor(quotaReachedError: () => Error, logger: Logger = () => {}) {
    this.quotaReachedError = quotaReachedError;
    this.logger = logger;
  }

  /**
   * Return a cached value or fetch and store a fresh one.
   *
   * - Fresh hit (now < expiresAt): return cached data, zero fetcher calls.
   * - Stale hit under exhausted quota: serve stale entry and log a warning.
   * - Cold miss under exhausted quota: throw the injected rate-limit error.
   * - Miss below quota: call fetcher, store with absolute expiry (now + ttlMs), prune.
   *
   * `now` is the last parameter so production callers can omit it (defaults to
   * Date.now()), while tests pass an explicit value for determinism.
   */
  public async fetchCached<T>(
    key: string,
    ttlMs: number,
    quotaExhausted: boolean,
    fetcher: () => Promise<T>,
    now = Date.now()
  ): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && now < cached.expiresAt) {
      this.logger('debug', 'Using cached forecast', { key });
      return cached.data as T;
    }

    if (quotaExhausted) {
      if (cached) {
        this.logger('warn', 'Quota reached, serving stale forecast', { key });
        return cached.data as T;
      }
      throw this.quotaReachedError();
    }

    const data = await fetcher();
    this.cache.set(key, { data, expiresAt: now + ttlMs });
    this.prune(now);
    return data;
  }

  /**
   * Drop expired entries, then evict the soonest-to-expire entries when still
   * over the cap. Uses the caller-supplied `now` so no wall-clock call happens
   * inside this method: the injected timestamp stays consistent with the
   * freshness check above.
   */
  private prune(now: number): void {
    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
      }
    }
    evictOldestOverCap(this.cache, (entry) => entry.expiresAt);
  }

  /** Remove all entries. */
  public clear(): void {
    this.cache.clear();
  }
}
