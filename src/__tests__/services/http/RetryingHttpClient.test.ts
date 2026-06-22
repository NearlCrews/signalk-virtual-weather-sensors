import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetryingHttpClient } from '../../../services/http/RetryingHttpClient.js';

// Match the suite's fetch-mock idiom (AccuWeatherService.test.ts:26-34): stub the
// global fetch in beforeEach, unstub in afterEach. Do NOT use vi.spyOn here.
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

// Minimal Response stand-in covering what readBoundedJson reads: headers.get and text().
// Models the existing AccuWeatherService.test.ts mockResponse helper.
function mockResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  const status = init?.status ?? 200;
  return {
    ok: status < 400,
    status,
    statusText: init?.statusText ?? 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

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
  it('returns parsed JSON and fires onRequestCounted once per landed response', async () => {
    const onRequestCounted = vi.fn();
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse({ ok: 1 }));
    const result = await makeClient(onRequestCounted).request<{ ok: number }>(
      new URL('https://example.test/x')
    );
    expect(result).toEqual({ ok: 1 });
    expect(onRequestCounted).toHaveBeenCalledTimes(1);
  });
  it('counts a 503 error response too, then retries and succeeds', async () => {
    const onRequestCounted = vi.fn();
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(mockResponse({}, { status: 503, statusText: 'unavailable' }))
      .mockResolvedValueOnce(mockResponse({ ok: 2 }));
    const result = await makeClient(onRequestCounted).request<{ ok: number }>(
      new URL('https://example.test/x')
    );
    expect(result).toEqual({ ok: 2 });
    // Both landed responses are counted: an error response from the upstream still
    // consumed quota, so onRequestCounted fires on the 503 AND the 200.
    expect(onRequestCounted).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
