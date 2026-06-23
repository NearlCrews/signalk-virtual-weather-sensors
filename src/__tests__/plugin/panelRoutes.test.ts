/**
 * Tests for the panelRoutes rate limiter.
 *
 * Focuses on the /api/test-key 429 path that is untested in index.test.ts:
 * once TEST_KEY_RATE_LIMIT requests arrive in the same minute-window, the
 * next call must receive 429 with the limiter message.
 *
 * The route function is imported directly so we can construct a minimal
 * PluginInstance stub without spinning up the full plugin lifecycle.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginInstance } from '../../plugin/instance.js';
import { registerPanelRoutes } from '../../plugin/panelRoutes.js';

// Build a minimal PluginInstance stub with only the fields panelRoutes reads.
function makeInstance(): PluginInstance {
  return {
    weatherService: null,
    pathMapper: null,
    marinePathMapper: null,
    cachedMarineDelta: null,
    cachedMarineDataRef: null,
    marineMetaEmitted: false,
    notifier: null,
    emissionTimer: null,
    state: 'stopped',
    startTime: null,
    logger: vi.fn(),
    cachedDelta: null,
    cachedWeatherDataRef: null,
    metaEmitted: false,
    weatherProviderRegistered: false,
    sourceRef: 'open-meteo' as import('@signalk/server-api').SourceRef,
    lastBanner: null,
  };
}

// Minimal express-shaped response builder.
function makeRes() {
  let capturedStatus: number | undefined;
  let capturedJson: unknown;
  const res = {
    status: vi.fn((code: number) => {
      capturedStatus = code;
      return res;
    }),
    json: vi.fn((payload: unknown) => {
      capturedJson = payload;
      return res;
    }),
    get capturedStatus() {
      return capturedStatus;
    },
    get capturedJson() {
      return capturedJson;
    },
  };
  return res;
}

// Minimal express-shaped router that captures handlers so tests can call them.
function makeRouter() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    get: vi.fn((path: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(`GET ${path}`, handler);
    }),
    post: vi.fn((path: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(`POST ${path}`, handler);
    }),
    getHandler(method: string, path: string) {
      return handlers.get(`${method} ${path}`);
    },
  };
}

describe('panelRoutes: /api/test-key rate limiter', () => {
  beforeEach(() => {
    // The route handler uses global fetch only when a valid key is submitted
    // and AccuWeatherService.verifyApiKey fires. We want all calls to get past
    // the length guard and hit the rate-limiter check, so the key must be at
    // least 20 chars. Stub fetch to avoid real network calls; it should never
    // be reached for over-limit requests, but if it is, we return a clean 401
    // so the test does not hang.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-length': '36' }),
        text: () => Promise.resolve('{"message":"invalid"}'),
      })
    );
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns 429 after TEST_KEY_RATE_LIMIT (10) calls in the same minute window', async () => {
    // TEST_KEY_RATE_LIMIT is 10 (module-private constant in panelRoutes.ts).
    // registering once constructs fresh testKeyHits state because each
    // registerPanelRoutes call closes over a new local array.
    const router = makeRouter();
    registerPanelRoutes(router as unknown as import('express').IRouter, makeInstance());

    const handler = router.getHandler('POST', '/api/test-key');
    if (!handler) throw new Error('POST /api/test-key handler not registered');

    // A key that clears the length guard (>= 20 chars) so the limiter is tested.
    const longKey = 'A'.repeat(20);
    const req = { body: { apiKey: longKey } };

    // Fire TEST_KEY_RATE_LIMIT (10) requests that should all succeed (or fail
    // with an AccuWeather error, never 429).
    for (let i = 0; i < 10; i++) {
      const res = makeRes();
      await handler(req, res);
      expect(res.capturedStatus).not.toBe(429);
    }

    // The 11th request (index 10) must be rate-limited.
    const res = makeRes();
    await handler(req, res);
    expect(res.capturedStatus).toBe(429);
    const payload = res.capturedJson as { ok: boolean; message: string };
    expect(payload.ok).toBe(false);
    expect(payload.message).toContain('Too many');
  });

  it('allows calls again after the window resets (1 minute elapses)', async () => {
    const router = makeRouter();
    registerPanelRoutes(router as unknown as import('express').IRouter, makeInstance());

    const handler = router.getHandler('POST', '/api/test-key');
    if (!handler) throw new Error('POST /api/test-key handler not registered');

    const longKey = 'A'.repeat(20);
    const req = { body: { apiKey: longKey } };

    // Exhaust the window (10 calls).
    for (let i = 0; i < 10; i++) {
      const res = makeRes();
      await handler(req, res);
    }

    // Advance past the 60-second window.
    vi.advanceTimersByTime(61_000);

    // After the window clears, the next call must not be rate-limited.
    const res = makeRes();
    await handler(req, res);
    expect(res.capturedStatus).not.toBe(429);
  });
});
