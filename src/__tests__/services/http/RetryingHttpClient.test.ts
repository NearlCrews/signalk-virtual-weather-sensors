import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetryingHttpClient } from '../../../services/http/RetryingHttpClient.js';
import { createMockFetchResponse } from '../../setup.js';

// Match the suite's fetch-mock idiom (AccuWeatherService.test.ts:26-34): stub the
// global fetch in beforeEach, unstub in afterEach. Do NOT use vi.spyOn here.
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

function makeClient(onRequestCounted?: () => void): RetryingHttpClient {
  return new RetryingHttpClient({
    requestTimeoutMs: 1000,
    retryAttempts: 3,
    retryDelayMs: 1,
    userAgent: 'test/1.0',
    onRequestCounted,
  });
}

describe('RetryingHttpClient', () => {
  it('returns parsed JSON and fires onRequestCounted once per attempt', async () => {
    const onRequestCounted = vi.fn();
    vi.mocked(globalThis.fetch).mockResolvedValue(
      createMockFetchResponse({ ok: 1 }) as unknown as Response
    );
    const result = await makeClient(onRequestCounted).request<{ ok: number }>(
      new URL('https://example.test/x')
    );
    expect(result).toEqual({ ok: 1 });
    expect(onRequestCounted).toHaveBeenCalledTimes(1);
  });

  it('counts a 503 error response too, then retries and succeeds', async () => {
    const onRequestCounted = vi.fn();
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        createMockFetchResponse(
          {},
          { ok: false, status: 503, statusText: 'unavailable' }
        ) as unknown as Response
      )
      .mockResolvedValueOnce(createMockFetchResponse({ ok: 2 }) as unknown as Response);
    const result = await makeClient(onRequestCounted).request<{ ok: number }>(
      new URL('https://example.test/x')
    );
    expect(result).toEqual({ ok: 2 });
    // Both attempts are counted because an upstream error response still
    // consumed quota.
    expect(onRequestCounted).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('counts attempts when fetch rejects before receiving a response', async () => {
    const onRequestCounted = vi.fn();
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    await expect(
      makeClient(onRequestCounted).request(new URL('https://example.test/x'))
    ).rejects.toThrow('getaddrinfo ENOTFOUND');

    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(onRequestCounted).toHaveBeenCalledTimes(3);
  });

  it('throws API_UNAUTHORIZED and calls fetch exactly once on a 401 response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      createMockFetchResponse(
        { message: 'invalid' },
        { ok: false, status: 401, statusText: 'Unauthorized' }
      ) as unknown as Response
    );
    await expect(makeClient().request(new URL('https://example.test/x'))).rejects.toThrow(
      'API_UNAUTHORIZED'
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws API_FORBIDDEN and calls fetch exactly once on a 403 response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      createMockFetchResponse(
        { message: 'forbidden' },
        { ok: false, status: 403, statusText: 'Forbidden' }
      ) as unknown as Response
    );
    await expect(makeClient().request(new URL('https://example.test/x'))).rejects.toThrow(
      'API_FORBIDDEN'
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
