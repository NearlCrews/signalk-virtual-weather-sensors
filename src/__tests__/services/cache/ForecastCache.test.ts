import { describe, expect, it, vi } from 'vitest';
import { ForecastCache } from '../../../services/cache/ForecastCache.js';

const rateLimit = () => new Error('rate-limited');

describe('ForecastCache', () => {
  it('serves a fresh hit without calling the fetcher', async () => {
    const c = new ForecastCache(rateLimit);
    const fetcher = vi.fn(async () => 'a');
    expect(await c.fetchCached('k', 1000, false, fetcher, 0)).toBe('a');
    expect(await c.fetchCached('k', 1000, false, fetcher, 500)).toBe('a');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refetches and stores with an absolute expiry once the entry has expired', async () => {
    const c = new ForecastCache(rateLimit);
    expect(await c.fetchCached('k', 1000, false, async () => 'a', 0)).toBe('a');
    // Past the 1000 ms ttl, below quota: the stored entry has expired, so it refetches.
    expect(await c.fetchCached('k', 1000, false, async () => 'b', 2000)).toBe('b');
  });
  it('serves a stale entry when quota is exhausted', async () => {
    const c = new ForecastCache(rateLimit);
    await c.fetchCached('k', 1000, false, async () => 'a', 0);
    expect(await c.fetchCached('k', 1000, true, async () => 'b', 5000)).toBe('a');
  });
  it('throws the rate-limit error on a cold miss under exhausted quota', async () => {
    const c = new ForecastCache(rateLimit);
    await expect(c.fetchCached('k', 1000, true, async () => 'a', 0)).rejects.toThrow(
      'rate-limited'
    );
  });
  it('coalesces concurrent misses, including a caller that observes exhausted quota', async () => {
    const c = new ForecastCache(rateLimit);
    let resolveFetch: ((value: string) => void) | undefined;
    const fetcher = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const first = c.fetchCached('k', 1000, false, fetcher, 0);
    const second = c.fetchCached('k', 1000, true, fetcher, 0);
    resolveFetch?.('shared');
    await expect(Promise.all([first, second])).resolves.toEqual(['shared', 'shared']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
