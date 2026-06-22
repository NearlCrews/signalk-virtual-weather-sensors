import { describe, expect, it, vi } from 'vitest';
import { CoalescingTtlCache } from '../../../services/cache/CoalescingTtlCache.js';

describe('CoalescingTtlCache', () => {
  it('returns a fresh hit without refetching', async () => {
    const c = new CoalescingTtlCache<string>(1000, 5000, () => {}, 0);
    const fetch = vi.fn(async () => 'a');
    expect(await c.get('k', fetch, 0)).toBe('a');
    expect(await c.get('k', fetch, 500)).toBe('a');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('refetches after the ttl expires', async () => {
    const c = new CoalescingTtlCache<string>(1000, 5000, () => {}, 0);
    expect(await c.get('k', async () => 'a', 0)).toBe('a');
    expect(await c.get('k', async () => 'b', 2000)).toBe('b');
  });
  it('coalesces concurrent cold lookups onto a single fetch', async () => {
    const c = new CoalescingTtlCache<string>(1000, 5000, () => {}, 0);
    let calls = 0;
    const fetch = async () => {
      calls++;
      await Promise.resolve();
      return 'a';
    };
    const [r1, r2] = await Promise.all([c.get('k', fetch, 0), c.get('k', fetch, 0)]);
    expect(r1).toBe('a');
    expect(r2).toBe('a');
    expect(calls).toBe(1);
  });
  it('peekStale returns a stored value ignoring expiry, undefined when absent', async () => {
    const c = new CoalescingTtlCache<string>(1000, 5000, () => {}, 0);
    expect(c.peekStale('k')).toBeUndefined();
    await c.get('k', async () => 'a', 0);
    // Well past the ttl: peekStale still returns the value (the bypass it is named for).
    expect(c.peekStale('k')).toBe('a');
  });
});
