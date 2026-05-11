/**
 * Vitest test setup and global configuration
 * Provides mocks, utilities, and test environment setup
 */

import type { Delta, PathValue } from '@signalk/server-api';
import type { MockedFunction } from 'vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';

// ===============================
// Global Test Setup
// ===============================

/** Configure global test environment before all tests */
beforeAll(() => {
  // Mock console methods to reduce test noise
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  // Setup global test timeout
  vi.setConfig({ testTimeout: 10000 });
});

/** Cleanup after each test */
afterEach(() => {
  // Clear all mocks but keep implementations
  vi.clearAllMocks();

  // Reset any modified timers
  vi.useRealTimers();
});

/** Cleanup after all tests */
afterAll(() => {
  // Restore all original implementations
  vi.restoreAllMocks();
});

// ===============================
// Mock Data Generators
// ===============================

/**
 * Generate mock weather data for testing
 */
export function createMockWeatherData(
  overrides: Partial<import('../types/index.js').WeatherData> = {}
): import('../types/index.js').WeatherData {
  return {
    temperature: 293.15, // 20°C in Kelvin
    pressure: 101325, // 1013.25 mbar in Pascals
    humidity: 0.65, // 65% as ratio (0-1) per Signal K spec
    windSpeed: 5.14, // ~10 knots in m/s
    windDirection: Math.PI / 2, // 90° (East) in radians
    dewPoint: 286.48, // ~13.3°C in Kelvin
    windChill: 293.15, // Same as temp for mild conditions
    heatIndex: 293.15, // Same as temp for mild conditions
    description: 'Partly cloudy',
    timestamp: new Date().toISOString(),
    quality: 1.0,
    ...overrides,
  };
}

/**
 * Generate mock vessel navigation data for testing
 */
export function createMockVesselData(
  overrides: Partial<import('../types/index.js').VesselNavigationData> = {}
): import('../types/index.js').VesselNavigationData {
  return {
    position: {
      latitude: 37.7749,
      longitude: -122.4194,
    },
    speedOverGround: 2.57, // ~5 knots in m/s
    courseOverGroundTrue: 0, // North in radians
    headingTrue: 0, // North in radians
    headingMagnetic: 0.087, // ~5° magnetic deviation
    isComplete: true,
    dataAge: 1000, // 1 second
    ...overrides,
  };
}

/**
 * Generate mock plugin configuration for testing
 */
export function createMockConfig(
  overrides: Partial<import('../types/index.js').PluginConfiguration> = {}
): import('../types/index.js').PluginConfiguration {
  return {
    accuWeatherApiKey: 'testapikey123456789012345',
    updateFrequency: 5,
    emissionInterval: 5,
    ...overrides,
  };
}

/**
 * Generate mock AccuWeather API response for testing
 */
export function createMockAccuWeatherResponse(
  overrides: Partial<import('../types/index.js').AccuWeatherCurrentConditions> = {}
): import('../types/index.js').AccuWeatherCurrentConditions[] {
  return [
    {
      LocalObservationDateTime: new Date().toISOString(),
      EpochTime: Date.now() / 1000,
      WeatherText: 'Partly cloudy',
      WeatherIcon: 3,
      HasPrecipitation: false,
      PrecipitationType: null,
      IsDayTime: true,
      Temperature: {
        Metric: { Value: 20, Unit: 'C' },
        Imperial: { Value: 68, Unit: 'F' },
      },
      RealFeelTemperature: {
        Metric: { Value: 20.5, Unit: 'C', Phrase: 'Pleasant' },
        Imperial: { Value: 69, Unit: 'F', Phrase: 'Pleasant' },
      },
      RealFeelTemperatureShade: {
        Metric: { Value: 19.2, Unit: 'C', Phrase: 'Pleasant' },
        Imperial: { Value: 66, Unit: 'F', Phrase: 'Pleasant' },
      },
      RelativeHumidity: 65,
      IndoorRelativeHumidity: 70,
      Wind: {
        Speed: {
          Metric: { Value: 18.5, Unit: 'km/h' },
          Imperial: { Value: 11.5, Unit: 'mi/h' },
        },
        Direction: {
          Degrees: 90,
          Localized: 'E',
          English: 'E',
        },
      },
      WindGust: {
        Speed: {
          Metric: { Value: 25.0, Unit: 'km/h' },
          Imperial: { Value: 15.5, Unit: 'mi/h' },
        },
      },
      Pressure: {
        Metric: { Value: 1013.25, Unit: 'mb' },
        Imperial: { Value: 29.92, Unit: 'inHg' },
      },
      PressureTendency: {
        LocalizedText: 'Steady',
        Code: 'S',
      },
      DewPoint: {
        Metric: { Value: 13.3, Unit: 'C' },
        Imperial: { Value: 56, Unit: 'F' },
      },
      ApparentTemperature: {
        Metric: { Value: 20, Unit: 'C' },
        Imperial: { Value: 68, Unit: 'F' },
      },
      WindChillTemperature: {
        Metric: { Value: 20, Unit: 'C' },
        Imperial: { Value: 68, Unit: 'F' },
      },
      WetBulbTemperature: {
        Metric: { Value: 16.8, Unit: 'C' },
        Imperial: { Value: 62, Unit: 'F' },
      },
      WetBulbGlobeTemperature: {
        Metric: { Value: 17.5, Unit: 'C' },
        Imperial: { Value: 63, Unit: 'F' },
      },
      UVIndex: 3,
      UVIndexFloat: 3.2,
      UVIndexText: 'Moderate',
      Visibility: {
        Metric: { Value: 16.0, Unit: 'km' },
        Imperial: { Value: 10, Unit: 'mi' },
      },
      CloudCover: 75,
      Ceiling: {
        Metric: { Value: 1200, Unit: 'm' },
        Imperial: { Value: 4000, Unit: 'ft' },
      },
      ObstructionsToVisibility: '',
      Past24HourTemperatureDeparture: {
        Metric: { Value: 1.5, Unit: 'C' },
        Imperial: { Value: 3, Unit: 'F' },
      },
      Precip1hr: {
        Metric: { Value: 0, Unit: 'mm' },
        Imperial: { Value: 0, Unit: 'in' },
      },
      PrecipitationSummary: {
        Precipitation: {
          Metric: { Value: 0, Unit: 'mm' },
          Imperial: { Value: 0, Unit: 'in' },
        },
        PastHour: {
          Metric: { Value: 0, Unit: 'mm' },
          Imperial: { Value: 0, Unit: 'in' },
        },
        Past3Hours: {
          Metric: { Value: 0, Unit: 'mm' },
          Imperial: { Value: 0, Unit: 'in' },
        },
        Past6Hours: {
          Metric: { Value: 0, Unit: 'mm' },
          Imperial: { Value: 0, Unit: 'in' },
        },
        Past12Hours: {
          Metric: { Value: 0, Unit: 'mm' },
          Imperial: { Value: 0, Unit: 'in' },
        },
        Past24Hours: {
          Metric: { Value: 0, Unit: 'mm' },
          Imperial: { Value: 0, Unit: 'in' },
        },
      },
      TemperatureSummary: {
        Past6HourRange: {
          Minimum: { Metric: { Value: 18, Unit: 'C' }, Imperial: { Value: 64, Unit: 'F' } },
          Maximum: { Metric: { Value: 22, Unit: 'C' }, Imperial: { Value: 72, Unit: 'F' } },
        },
        Past12HourRange: {
          Minimum: { Metric: { Value: 16, Unit: 'C' }, Imperial: { Value: 61, Unit: 'F' } },
          Maximum: { Metric: { Value: 24, Unit: 'C' }, Imperial: { Value: 75, Unit: 'F' } },
        },
        Past24HourRange: {
          Minimum: { Metric: { Value: 15, Unit: 'C' }, Imperial: { Value: 59, Unit: 'F' } },
          Maximum: { Metric: { Value: 25, Unit: 'C' }, Imperial: { Value: 77, Unit: 'F' } },
        },
      },
      MobileLink: 'http://www.accuweather.com/test',
      Link: 'http://www.accuweather.com/test',
      ...overrides,
    },
  ];
}

// ===============================
// Mock Implementations
// ===============================

/**
 * Build a Fetch-API-shaped Response stub. AccuWeatherService.readBoundedJson
 * needs `headers`, `text()`, and the `ok`/`status`/`statusText` triple, so we
 * supply a real `Headers` instance with `content-length` set from the body.
 */
export function createMockFetchResponse(
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

/**
 * Mock Signal K app for plugin testing. `selfPaths` maps each path the plugin
 * may read via `app.getSelfPath` to the value the stub should return; unmapped
 * paths return `undefined` (matching real signalk-server behavior).
 */
export function createMockSignalKApp(opts: { selfPaths?: Record<string, unknown> } = {}) {
  const selfPaths = opts.selfPaths ?? {};
  return {
    debug: vi.fn(),
    error: vi.fn(),
    setPluginStatus: vi.fn(),
    setPluginError: vi.fn(),
    getSelfPath: vi.fn().mockImplementation((path: string) => selfPaths[path]),
    streambundle: {
      getSelfStream: vi.fn(),
      getBus: vi.fn().mockReturnValue({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }),
    },
    handleMessage: vi.fn(),
    emit: vi.fn(),
  };
}

/**
 * Pull the values array out of the first values-bearing update in a delta.
 * Used by mapper and integration tests that need to inspect emitted PathValues.
 */
export function getValuesFromDelta(delta: Delta): PathValue[] {
  const update = delta.updates.find((u) => 'values' in u);
  return update && 'values' in update ? update.values : [];
}

/**
 * Mock timer utilities for testing time-dependent code
 */
export function createMockTimers() {
  vi.useFakeTimers();

  return {
    advanceTime: (ms: number) => vi.advanceTimersByTime(ms),
    advanceToNext: () => vi.advanceTimersToNextTimer(),
    runAllTimers: () => vi.runAllTimers(),
    clearAllTimers: () => vi.clearAllTimers(),
    useRealTimers: () => vi.useRealTimers(),
  };
}

// ===============================
// Test Utilities
// ===============================

/**
 * Utility to wait for async operations in tests
 */
export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Utility to wait for a condition to be true
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await waitFor(interval);
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

// ===============================
// Type Exports
// ===============================

export type MockedFetch = MockedFunction<typeof fetch>;
export type MockedSignalKApp = ReturnType<typeof createMockSignalKApp>;
export type MockedTimers = ReturnType<typeof createMockTimers>;
