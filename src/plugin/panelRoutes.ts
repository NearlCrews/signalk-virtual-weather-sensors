/**
 * Panel REST routes for the federated React config panel.
 * Mounted at /plugins/signalk-virtual-weather-sensors/api/* by signalk-server.
 *
 * `/api/status` is read-only and safe to expose; `/api/test-key` accepts a
 * candidate key in a POST body and makes one AccuWeather location-search
 * call without persisting it. Neither endpoint mutates plugin state.
 */

import type { IRouter, Request, Response } from 'express';
import { TEST_KEY_LOCATION } from '../constants/index.js';
import { validateKeyLength } from '../constants/notifications-shared.js';
import { AccuWeatherService } from '../services/AccuWeatherService.js';
import type { PanelStatusResponse } from '../types/index.js';
import { msToWholeMinutes, toErrorMessage } from '../utils/conversions.js';
import type { PluginInstance } from './instance.js';

export const PANEL_OPENAPI = {
  openapi: '3.0.3',
  info: {
    title: 'Virtual Weather Sensors panel API',
    version: '1.0.0',
  },
  servers: [{ url: '/plugins/signalk-virtual-weather-sensors' }],
  paths: {
    '/api/status': {
      get: {
        summary: 'Get current plugin and provider status',
        responses: { '200': { description: 'Current panel status' } },
      },
    },
    '/api/test-key': {
      post: {
        summary: 'Verify an AccuWeather API key without saving it',
        responses: {
          '200': { description: 'Key verification result' },
          '400': { description: 'Invalid key format' },
          '429': { description: 'Request limit exceeded' },
        },
      },
    },
  },
} as const;

/**
 * Mount the panel's REST endpoints onto the express router signalk-server
 * passes in.
 */
export function registerPanelRoutes(router: IRouter, instance: PluginInstance): void {
  router.get('/api/status', (_req: Request, res: Response) => {
    const ws = instance.weatherService;
    if (!ws) {
      const payload: PanelStatusResponse = {
        running: false,
        banner: instance.lastBanner?.message ?? 'Plugin stopped',
        updates: 0,
        quotaUsedLast24h: 0,
        lastUpdateMinutesAgo: null,
        activeNotifications: 0,
        weatherProviderRegistered: false,
      };
      res.json(payload);
      return;
    }
    const snapshot = ws.getServiceStatus();
    const ageMs = ws.getDataAgeMs();
    // A rejected API key is a terminal state: the update timer is cleared
    // and no further fetches will fire until config changes. Reflect that on
    // the `running` flag so the panel does not show a green indicator on a
    // plugin that has effectively stopped.
    const running = instance.state === 'running' && !ws.isApiKeyRejected();
    const payload: PanelStatusResponse = {
      running,
      banner: ws.formatStatusBanner(),
      updates: snapshot.updateCount,
      quotaUsedLast24h: ws.getRequestCountLast24h(),
      lastUpdateMinutesAgo: ageMs === null ? null : msToWholeMinutes(ageMs),
      activeNotifications: instance.notifier?.getActiveCount() ?? 0,
      weatherProviderRegistered: instance.weatherProviderRegistered,
    };
    res.json(payload);
  });

  // Signal K protects the complete /plugins route tree with its admin
  // authentication middleware before mounting each plugin's Express router.
  const TEST_KEY_RATE_LIMIT = 3;
  const TEST_KEY_WINDOW_MS = 60_000;
  const testKeyHits: number[] = [];

  router.post('/api/test-key', async (req: Request, res: Response) => {
    const now = Date.now();
    while (testKeyHits.length > 0 && now - (testKeyHits[0] as number) > TEST_KEY_WINDOW_MS) {
      testKeyHits.shift();
    }
    if (testKeyHits.length >= TEST_KEY_RATE_LIMIT) {
      res.status(429).json({
        ok: false,
        message: 'Too many key-test requests. Try again in a minute.',
      });
      return;
    }

    // express.json() body-parser is wired by signalk-server before plugin
    // routers run; the body is therefore the parsed JSON object.
    const body = (req.body ?? {}) as { apiKey?: unknown };
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const keyLengthError = validateKeyLength(apiKey);
    if (keyLengthError) {
      res.status(400).json({ ok: false, message: keyLengthError });
      return;
    }
    testKeyHits.push(now);
    try {
      const result = await testApiKey(apiKey);
      res.json(result);
    } catch (error) {
      // testApiKey already catches and sanitizes verifyApiKey failures, so this
      // outer catch only fires on an unexpected throw (e.g. AccuWeatherService
      // construction). Server-side log carries the full error; the client gets a
      // sanitized, length-bounded single-line message so no URL fragments or
      // stack-derived text leak to a LAN-side caller.
      const fullMessage = toErrorMessage(error);
      instance.logger('error', 'Test-key endpoint failed', { error: fullMessage });
      res.status(500).json({ ok: false, message: sanitizeClientErrorMessage(fullMessage) });
    }
  });
}

/**
 * Trim and bound an error message before returning it to a panel client.
 * Strips control characters that could break JSON-encoded log viewers and
 * caps the length so any URL fragments or stack traces never reach the wire.
 * @private
 */
function sanitizeClientErrorMessage(raw: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately strip control chars
  const stripped = raw.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  const MAX_LEN = 256;
  return stripped.length > MAX_LEN ? `${stripped.slice(0, MAX_LEN)}...` : stripped;
}

/**
 * Probe a candidate AccuWeather API key with exactly one location-search call
 * (via {@link AccuWeatherService.verifyApiKey}). Returns a `{ok, message}`
 * shape consumed by the admin-UI panel; no key persistence, no plugin-state
 * mutation. Costs one AccuWeather API call per test, half what a full
 * currentconditions probe would.
 * @private
 */
async function testApiKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  const probe = new AccuWeatherService(apiKey, () => {}, {
    // Tight retry budget: the panel should surface failure fast, not chew
    // through the user's quota retrying a bad key.
    retryAttempts: 1,
    requestTimeout: 8000,
  });
  try {
    await probe.verifyApiKey(TEST_KEY_LOCATION);
    return { ok: true, message: 'API key verified against AccuWeather.' };
  } catch (error) {
    return { ok: false, message: sanitizeClientErrorMessage(toErrorMessage(error)) };
  }
}
