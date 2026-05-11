/**
 * End-to-end integration smoke test for the AccuWeather → WeatherService →
 * NMEA2000PathMapper pipeline. Drives the real services with a mocked
 * `global.fetch`, asserting:
 *   - a single successful forceUpdate produces a Signal K delta containing
 *     all 7 canonical environment.outside.* leaves, all 4 environment.wind.*
 *     leaves, and a representative spread of environment.weather.* extensions;
 *   - the 429-with-Retry-After path actually retries (fetch is invoked twice);
 *   - a 401 surfaces as the API_UNAUTHORIZED error code.
 *
 * Mocking strategy: we keep the existing `vi.fn()` global.fetch pattern from
 * AccuWeatherService.test.ts. msw would add a dependency for negligible
 * additional realism here: the AccuWeather client only depends on the Fetch
 * Response shape (.ok, .status, .headers, .text()), which the inline helper
 * already supplies.
 */

import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NMEA2000PathMapper } from '../../mappers/NMEA2000PathMapper.js';
import { AccuWeatherService } from '../../services/AccuWeatherService.js';
import { SignalKService } from '../../services/SignalKService.js';
import { WeatherService } from '../../services/WeatherService.js';
import type { PluginConfiguration } from '../../types/index.js';
import { createMockAccuWeatherResponse } from '../setup.js';

/**
 * Minimal Signal K ServerAPI stub used across this suite. Optionally returns
 * a vessel position; speed and heading are returned as fixed values so the
 * apparent-wind branch in WeatherService.enhanceWeatherData has both inputs
 * (otherwise environment.wind.angleApparent gets omitted from the delta).
 */
function buildMockApp(position?: { latitude: number; longitude: number }) {
  const positionData = position
    ? { value: { latitude: position.latitude, longitude: position.longitude } }
    : undefined;
  const handleMessage = vi.fn();
  return {
    handleMessage,
    setPluginStatus: vi.fn(),
    setPluginError: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    getSelfPath: vi.fn().mockImplementation((path: string) => {
      switch (path) {
        case 'navigation.position':
          return positionData;
        case 'navigation.speedOverGround':
          // ~5 knots, well under VESSEL_SPEED.MAX
          return { value: 2.57 };
        case 'navigation.courseOverGroundTrue':
          // ~0 rad (north), valid 0..2π
          return { value: 0 };
        case 'navigation.headingTrue':
          return { value: 0 };
        default:
          return undefined;
      }
    }),
    streambundle: { getSelfStream: vi.fn() },
  };
}

/**
 * Minimal Fetch-API-shaped Response stub: AccuWeatherService.readBoundedJson
 * needs `headers`, `text()`, and the `ok`/`status`/`statusText` triple.
 */
function fetchResponse(
  data: unknown,
  init: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    extraHeaders?: Record<string, string>;
  } = {}
) {
  const text = JSON.stringify(data);
  const headers = new Headers({ 'content-length': String(text.length), ...init.extraHeaders });
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(data),
  };
}

const SF_LOCATION = { latitude: 37.7749, longitude: -122.4194 };

const SF_LOCATION_RESPONSE = {
  Key: '2628204',
  LocalizedName: 'San Francisco',
  Country: { ID: 'US', LocalizedName: 'United States' },
  AdministrativeArea: { ID: 'CA', LocalizedName: 'California' },
  GeoPosition: { Latitude: SF_LOCATION.latitude, Longitude: SF_LOCATION.longitude },
};

function buildConfig(overrides?: Partial<PluginConfiguration>): PluginConfiguration {
  return {
    accuWeatherApiKey: 'test-integration-key-12345',
    updateFrequency: 5,
    emissionInterval: 5,
    ...overrides,
  };
}

/**
 * Wire a real WeatherService + AccuWeatherService + SignalKService triple
 * with the stubbed app, plus a real NMEA2000PathMapper for the assertion
 * step. Retries are tightened so the 429 retry path doesn't add a second of
 * test wall time.
 */
function buildPipeline(app: ReturnType<typeof buildMockApp>) {
  const config = buildConfig();
  const accu = new AccuWeatherService(config.accuWeatherApiKey, () => {}, {
    retryAttempts: 3,
    retryDelay: 1,
  });
  const signalK = new SignalKService(app as never, () => {});
  const weather = new WeatherService(app as never, config, () => {}, undefined, accu, signalK);
  const mapper = new NMEA2000PathMapper(() => {});
  return { weather, accu, mapper };
}

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('integration: AccuWeather to Signal K delta pipeline', () => {
  it('produces a delta containing all canonical env.outside, env.wind, and env.weather paths', async () => {
    const app = buildMockApp(SF_LOCATION);
    const { weather, accu, mapper } = buildPipeline(app);

    (global.fetch as Mock)
      .mockResolvedValueOnce(fetchResponse(SF_LOCATION_RESPONSE))
      .mockResolvedValueOnce(fetchResponse(createMockAccuWeatherResponse()));

    // start() must run before forceUpdate(): WeatherService.updateWeatherData
    // discards results when the service isn't in a running/starting state, so
    // a forceUpdate against a freshly-constructed (stopped) service never
    // populates currentWeatherData.
    await weather.start();
    await weather.forceUpdate();

    const data = weather.getCurrentWeatherData();
    expect(data).not.toBeNull();
    if (!data) throw new Error('weather data should be populated after forceUpdate');

    // Tear down before assertions: stop() clears currentWeatherData but we've
    // already captured the snapshot, and clearing the update timer here keeps
    // a stray setInterval out of subsequent tests.
    await weather.stop();

    const delta = mapper.mapToSignalKPaths(data);
    const update = delta.updates[0];
    if (!update) throw new Error('expected at least one update');
    const values = (update as { values?: ReadonlyArray<{ path: string }> }).values ?? [];
    const paths = new Set(values.map((v) => v.path));

    // All 7 canonical environment.outside.* leaves the mapper emits unconditionally
    // (AIR_DENSITY is conditional on calculation success but always populated for
    // the mock payload, which has temperature, pressure, and humidity).
    const canonicalOutside = [
      'environment.outside.temperature',
      'environment.outside.pressure',
      'environment.outside.relativeHumidity',
      'environment.outside.dewPointTemperature',
      'environment.outside.apparentWindChillTemperature',
      'environment.outside.heatIndexTemperature',
      'environment.outside.airDensity',
    ];
    for (const p of canonicalOutside) {
      expect(paths.has(p), `missing canonical outside path ${p}`).toBe(true);
    }

    // All 4 canonical environment.wind.* leaves: speedOverGround/directionTrue
    // are emitted unconditionally; speedApparent falls back to true wind speed
    // and angleApparent is computed from the cached headingTrue we wired into
    // the mock app's getSelfPath, so both are present in this snapshot.
    const canonicalWind = [
      'environment.wind.speedOverGround',
      'environment.wind.directionTrue',
      'environment.wind.speedApparent',
      'environment.wind.angleApparent',
    ];
    for (const p of canonicalWind) {
      expect(paths.has(p), `missing canonical wind path ${p}`).toBe(true);
    }

    // Spread of environment.weather.* extensions populated by the canned mock
    // response (gust, beaufort, UV, visibility, cloud cover, absolute humidity,
    // wet bulb temperatures).
    const weatherExtensions = [
      'environment.weather.speedGust',
      'environment.weather.gustFactor',
      'environment.weather.beaufortScale',
      'environment.weather.uvIndex',
      'environment.weather.visibility',
      'environment.weather.cloudCover',
      'environment.weather.absoluteHumidity',
      'environment.weather.wetBulbTemperature',
      'environment.weather.wetBulbGlobeTemperature',
    ];
    for (const p of weatherExtensions) {
      expect(paths.has(p), `missing weather extension path ${p}`).toBe(true);
    }

    // Source ref is set so consumers can prefer real sensors over this feed.
    expect((update as { $source?: string }).$source).toBe('accuweather');

    // Request counter saw exactly one location-search and one currentconditions
    // fetch, so the status-banner accessor will have something to surface.
    expect(accu.getRequestCount()).toBe(2);
  });

  it('retries on a 429 with Retry-After then succeeds, calling fetch twice for currentconditions', async () => {
    const app = buildMockApp(SF_LOCATION);
    const { weather, accu } = buildPipeline(app);

    (global.fetch as Mock)
      .mockResolvedValueOnce(fetchResponse(SF_LOCATION_RESPONSE))
      .mockResolvedValueOnce(
        fetchResponse(
          { message: 'rate limited' },
          {
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            extraHeaders: { 'Retry-After': '0' },
          }
        )
      )
      .mockResolvedValueOnce(fetchResponse(createMockAccuWeatherResponse()));

    await weather.start();
    await weather.forceUpdate();
    const data = weather.getCurrentWeatherData();
    await weather.stop();

    // 1 location + 1 failed currentconditions + 1 successful retry = 3 fetch
    // calls. Asserts the retry path actually ran end-to-end (more than two
    // calls means the retry happened).
    expect((global.fetch as Mock).mock.calls.length).toBe(3);
    expect(accu.getRequestCount()).toBe(3);
    expect(data).not.toBeNull();
  });

  it('surfaces API_UNAUTHORIZED on a 401 from the location search', async () => {
    const app = buildMockApp(SF_LOCATION);
    const { weather } = buildPipeline(app);

    (global.fetch as Mock).mockResolvedValueOnce(
      fetchResponse(
        { message: 'invalid api key' },
        { ok: false, status: 401, statusText: 'Unauthorized' }
      )
    );

    await weather.start();
    try {
      await expect(weather.forceUpdate()).rejects.toThrow(/API_UNAUTHORIZED/);
      expect(weather.getCurrentWeatherData()).toBeNull();
    } finally {
      await weather.stop();
    }
  });
});
