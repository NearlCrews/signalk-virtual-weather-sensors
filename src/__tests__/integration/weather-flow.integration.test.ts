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
 * Mocking strategy: `vi.stubGlobal('fetch', ...)` plus the shared
 * `createMockFetchResponse` helper in setup.ts. The AccuWeather client only
 * depends on the Fetch Response shape (.ok, .status, .headers, .text()), so
 * msw would be overhead for negligible additional realism here.
 */

import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NMEA2000PathMapper } from '../../mappers/NMEA2000PathMapper.js';
import { AccuWeatherService } from '../../services/AccuWeatherService.js';
import { SignalKService } from '../../services/SignalKService.js';
import { WeatherService } from '../../services/WeatherService.js';
import { toSourceRef } from '../../utils/skDelta.js';
import {
  createMockAccuWeatherResponse,
  createMockConfig,
  createMockFetchResponse,
  createMockSignalKApp,
  getValuesFromDelta,
} from '../setup.js';

const SF_LOCATION = { latitude: 37.7749, longitude: -122.4194 };

const SF_LOCATION_RESPONSE = {
  Key: '2628204',
  LocalizedName: 'San Francisco',
  Country: { ID: 'US', LocalizedName: 'United States' },
  AdministrativeArea: { ID: 'CA', LocalizedName: 'California' },
  GeoPosition: { Latitude: SF_LOCATION.latitude, Longitude: SF_LOCATION.longitude },
};

/**
 * Build a stub app pre-wired with the navigation paths WeatherService reads.
 * Speed and heading are fixed so apparent-wind has both inputs (otherwise
 * environment.wind.angleApparent gets omitted from the delta).
 */
function buildAppWithVessel(position: { latitude: number; longitude: number }) {
  return createMockSignalKApp({
    selfPaths: {
      'navigation.position': {
        value: { latitude: position.latitude, longitude: position.longitude },
      },
      // ~5 knots, under VESSEL_SPEED.MAX
      'navigation.speedOverGround': { value: 2.57 },
      // ~0 rad (north), valid 0..2π
      'navigation.courseOverGroundTrue': { value: 0 },
      'navigation.headingTrue': { value: 0 },
    },
  });
}

/**
 * Wire a real WeatherService + AccuWeatherService + SignalKService triple
 * with the stubbed app, plus a real NMEA2000PathMapper for assertion. Retry
 * delay is tightened so the 429 retry test stays sub-second.
 */
function buildPipeline(app: ReturnType<typeof createMockSignalKApp>) {
  const config = createMockConfig({ accuWeatherApiKey: 'test-integration-key-12345' });
  const accu = new AccuWeatherService(config.accuWeatherApiKey, () => {}, {
    retryAttempts: 3,
    retryDelay: 1,
  });
  const signalK = new SignalKService(app as never, () => {});
  const weather = new WeatherService(app as never, config, () => {}, {
    weatherProvider: accu,
    signalKService: signalK,
  });
  const mapper = new NMEA2000PathMapper(toSourceRef('accuweather'), () => {});
  return { weather, accu, mapper };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('integration: AccuWeather to Signal K delta pipeline', () => {
  it('produces a delta containing all canonical env.outside, env.wind, and env.weather paths', async () => {
    const app = buildAppWithVessel(SF_LOCATION);
    const { weather, accu, mapper } = buildPipeline(app);

    (global.fetch as Mock)
      .mockResolvedValueOnce(createMockFetchResponse(SF_LOCATION_RESPONSE))
      .mockResolvedValueOnce(createMockFetchResponse(createMockAccuWeatherResponse()));

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
    const values = getValuesFromDelta(delta);
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

    // The 2 canonical environment.wind.* leaves the plugin sources: both
    // emitted unconditionally. Apparent wind is producer-namespaced
    // (environment.weather.windSpeedApparent / windAngleApparent), so it is
    // no longer on environment.wind.*.
    const canonicalWind = ['environment.wind.speedOverGround', 'environment.wind.directionTrue'];
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

    // Apparent wind is producer-namespaced: present on environment.weather.*
    // and absent from the canonical environment.wind.* leaves. The buildAppWithVessel
    // stub supplies complete navigation data (SOG = 2.57, COG = 0), so the
    // synthetic apparent wind is calculated and emitted by the pipeline.
    expect(paths.has('environment.weather.windSpeedApparent')).toBe(true);
    expect(paths.has('environment.weather.windAngleApparent')).toBe(true);
    expect(paths.has('environment.wind.speedApparent')).toBe(false);
    expect(paths.has('environment.wind.angleApparent')).toBe(false);

    // Source ref is set so consumers can prefer real sensors over this feed.
    expect((delta.updates[0] as { $source?: string }).$source).toBe('accuweather');

    // Request counter saw exactly one location-search and one currentconditions
    // fetch, so the status-banner accessor will have something to surface.
    expect(accu.getRequestCount()).toBe(2);
  });

  it('retries on a 429 with Retry-After then succeeds, calling fetch twice for currentconditions', async () => {
    const app = buildAppWithVessel(SF_LOCATION);
    const { weather, accu } = buildPipeline(app);

    (global.fetch as Mock)
      .mockResolvedValueOnce(createMockFetchResponse(SF_LOCATION_RESPONSE))
      .mockResolvedValueOnce(
        createMockFetchResponse(
          { message: 'rate limited' },
          {
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            extraHeaders: { 'Retry-After': '0' },
          }
        )
      )
      .mockResolvedValueOnce(createMockFetchResponse(createMockAccuWeatherResponse()));

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
    const app = buildAppWithVessel(SF_LOCATION);
    const { weather } = buildPipeline(app);

    (global.fetch as Mock).mockResolvedValueOnce(
      createMockFetchResponse(
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
