/**
 * AccuWeatherService Test Suite
 * Comprehensive testing of AccuWeather API integration with enhanced field extraction
 */

import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supportsForecasts } from '../../providers/WeatherProvider.js';
import { AccuWeatherService } from '../../services/AccuWeatherService.js';
import type { GeoLocation } from '../../types/index.js';
import { createMockAccuWeatherResponse, createMockFetchResponse } from '../setup.js';

// Local alias keeps the existing call sites short. `createMockFetchResponse`
// is the shared helper in setup.ts; using it directly here avoids the
// near-duplicate `mockResponse` that previously lived in this file.
const mockResponse = createMockFetchResponse;

describe('AccuWeatherService', () => {
  let service: AccuWeatherService;
  let mockLogger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Stub fetch per test rather than mutating the module-scope global. This
    // keeps fetch isolated to this test file (no leak across the worker) and
    // ensures every afterEach restores the original implementation.
    vi.stubGlobal('fetch', vi.fn());
    mockLogger = vi.fn();
    service = new AccuWeatherService('test-api-key', mockLogger);
  });

  afterEach(() => {
    service.clearLocationCache();
    vi.unstubAllGlobals();
  });

  describe('Constructor', () => {
    it('should initialize with valid API key', () => {
      expect(() => new AccuWeatherService('valid-key')).not.toThrow();
    });

    it('should throw error for empty API key', () => {
      expect(() => new AccuWeatherService('')).toThrow('AccuWeather API key is required');
    });

    it('should throw error for invalid API key type', () => {
      expect(() => new AccuWeatherService(null as unknown as string)).toThrow(
        'AccuWeather API key is required'
      );
    });

    it('should initialize logger and config correctly', () => {
      const customLogger = vi.fn();
      const customConfig = { locationCacheTimeout: 7200 };

      const _customService = new AccuWeatherService('test-key', customLogger, customConfig);

      expect(customLogger).toHaveBeenCalledWith(
        'info',
        'AccuWeatherService initialized',
        expect.any(Object)
      );
    });
  });

  describe('request timeout', () => {
    it('aborts a stalled body read once requestTimeout elapses', async () => {
      // fetch resolves at headers-received; the timeout must stay armed across
      // the body read or a stalled body bypasses requestTimeout entirely.
      const stallingService = new AccuWeatherService('test-api-key', mockLogger, {
        requestTimeout: 20,
        retryAttempts: 1,
      });
      (global.fetch as Mock).mockImplementation((_url: string, init: { signal: AbortSignal }) => {
        const { signal } = init;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: () =>
            new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () =>
                reject(
                  Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
                )
              );
            }),
        });
      });

      await expect(
        stallingService.verifyApiKey({ latitude: 51.4778, longitude: -0.0015 })
      ).rejects.toThrow(/API_TIMEOUT/);
    });
  });

  describe('fetchCurrentWeather', () => {
    const testLocation: GeoLocation = {
      latitude: 37.7749,
      longitude: -122.4194,
    };

    it('should fetch and transform enhanced weather data successfully', async () => {
      // Setup test-specific mocks
      const locationResponse = {
        Key: '2628204',
        LocalizedName: 'San Francisco',
        Country: { ID: 'US', LocalizedName: 'United States' },
        AdministrativeArea: { ID: 'CA', LocalizedName: 'California' },
        GeoPosition: { Latitude: 37.7749, Longitude: -122.4194 },
      };

      const conditionsResponse = createMockAccuWeatherResponse({
        Temperature: { Metric: { Value: 20, Unit: 'C' }, Imperial: { Value: 68, Unit: 'F' } },
        RelativeHumidity: 65,
        Wind: {
          Speed: { Metric: { Value: 18.5, Unit: 'km/h' }, Imperial: { Value: 11.5, Unit: 'mi/h' } },
          Direction: { Degrees: 225, Localized: 'SW', English: 'SW' },
        },
        WindGust: {
          Speed: { Metric: { Value: 25.0, Unit: 'km/h' }, Imperial: { Value: 15.5, Unit: 'mi/h' } },
        },
        UVIndexFloat: 3.2,
        Visibility: { Metric: { Value: 16.0, Unit: 'km' }, Imperial: { Value: 10, Unit: 'mi' } },
        CloudCover: 75,
        RealFeelTemperatureShade: {
          Metric: { Value: 18.5, Unit: 'C', Phrase: 'Cool' },
          Imperial: { Value: 65, Unit: 'F', Phrase: 'Cool' },
        },
        WetBulbTemperature: {
          Metric: { Value: 16.8, Unit: 'C' },
          Imperial: { Value: 62, Unit: 'F' },
        },
        WetBulbGlobeTemperature: {
          Metric: { Value: 17.5, Unit: 'C' },
          Imperial: { Value: 63, Unit: 'F' },
        },
      });

      (global.fetch as Mock)
        .mockResolvedValueOnce(mockResponse(locationResponse))
        .mockResolvedValueOnce(mockResponse(conditionsResponse));

      const weatherData = await service.fetchCurrentWeather(testLocation);

      expect(weatherData).toEqual(
        expect.objectContaining({
          temperature: expect.any(Number),
          pressure: expect.any(Number),
          humidity: expect.any(Number),
          windSpeed: expect.any(Number),
          windDirection: expect.any(Number),
          dewPoint: expect.any(Number),
          windChill: expect.any(Number),
          heatIndex: expect.any(Number),
          // Enhanced fields
          realFeelShade: expect.any(Number),
          wetBulbTemperature: expect.any(Number),
          wetBulbGlobeTemperature: expect.any(Number),
          windGustSpeed: expect.any(Number),
          windGustFactor: expect.any(Number),
          uvIndex: expect.any(Number),
          visibility: expect.any(Number),
          cloudCover: expect.any(Number),
          beaufortScale: expect.any(Number),
          absoluteHumidity: expect.any(Number),
          heatStressIndex: expect.any(Number),
        })
      );

      // Verify SI unit conversions
      expect(weatherData.temperature).toBeCloseTo(293.15, 2); // 20°C in Kelvin
      expect(weatherData.humidity).toBeCloseTo(0.65, 4); // 65% converted to ratio
      expect(weatherData.windSpeed).toBeCloseTo(5.14, 2); // 18.5 km/h in m/s
      expect(weatherData.windGustSpeed).toBeCloseTo(6.94, 2); // 25.0 km/h in m/s
      expect(weatherData.visibility).toBeCloseTo(16000, 1); // 16 km in meters
      expect(weatherData.cloudCover).toBeCloseTo(0.75, 2); // 75% as ratio
    });

    it('should throw API_UNAUTHORIZED on a 401 response', async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(
          mockResponse({
            Key: '2628204',
            LocalizedName: 'San Francisco',
            Country: { ID: 'US', LocalizedName: 'United States' },
            AdministrativeArea: { ID: 'CA', LocalizedName: 'California' },
            GeoPosition: { Latitude: 37.7749, Longitude: -122.4194 },
          }) as never
        )
        .mockResolvedValueOnce(
          mockResponse(
            { message: 'Invalid API key' },
            { ok: false, status: 401, statusText: 'Unauthorized' }
          ) as never
        );

      await expect(service.fetchCurrentWeather(testLocation)).rejects.toThrow(/API_UNAUTHORIZED/);
    });

    it('should validate location coordinates', async () => {
      const invalidLocation: GeoLocation = {
        latitude: 91, // Invalid latitude
        longitude: -122.4194,
      };

      await expect(service.fetchCurrentWeather(invalidLocation)).rejects.toThrow(
        /INVALID_COORDINATES.*lat 91/
      );
    });

    it('should cache location keys', async () => {
      // Clear cache and reset mocks
      service.clearLocationCache();
      vi.mocked(global.fetch).mockClear();

      // Setup fresh mocks for first call
      (global.fetch as Mock)
        .mockResolvedValueOnce(
          mockResponse({
            Key: '2628204',
            LocalizedName: 'San Francisco',
            Country: { ID: 'US', LocalizedName: 'United States' },
            AdministrativeArea: { ID: 'CA', LocalizedName: 'California' },
            GeoPosition: { Latitude: 37.7749, Longitude: -122.4194 },
          })
        )
        .mockResolvedValueOnce(mockResponse(createMockAccuWeatherResponse()))
        .mockResolvedValueOnce(mockResponse(createMockAccuWeatherResponse()));

      // First call
      await service.fetchCurrentWeather(testLocation);

      // Second call should use cache
      await service.fetchCurrentWeather(testLocation);

      // Should only call location API once due to caching
      expect(global.fetch).toHaveBeenCalledTimes(3); // 1 location + 2 conditions calls
    });

    it('should calculate synthetic values correctly', async () => {
      // Setup fresh mocks
      service.clearLocationCache();
      vi.mocked(global.fetch).mockClear();

      (global.fetch as Mock)
        .mockResolvedValueOnce(
          mockResponse({
            Key: '2628204',
            LocalizedName: 'San Francisco',
            Country: { ID: 'US', LocalizedName: 'United States' },
            AdministrativeArea: { ID: 'CA', LocalizedName: 'California' },
            GeoPosition: { Latitude: 37.7749, Longitude: -122.4194 },
          })
        )
        .mockResolvedValueOnce(mockResponse(createMockAccuWeatherResponse()));

      const weatherData = await service.fetchCurrentWeather(testLocation);

      // Beaufort scale should be calculated from wind speed
      expect(weatherData.beaufortScale).toBeGreaterThanOrEqual(0);
      expect(weatherData.beaufortScale).toBeLessThanOrEqual(12);

      // Wind gust factor should be > 1 when gusts exceed sustained wind
      expect(weatherData.windGustFactor).toBeGreaterThanOrEqual(1);

      // Absolute humidity should be positive
      expect(weatherData.absoluteHumidity).toBeGreaterThan(0);

      // Heat stress index should be valid
      expect(weatherData.heatStressIndex).toBeGreaterThanOrEqual(0);
      expect(weatherData.heatStressIndex).toBeLessThanOrEqual(4);
    });

    it('omits windGustFactor when the gust does not exceed sustained wind', async () => {
      service.clearLocationCache();
      vi.mocked(global.fetch).mockClear();
      (global.fetch as Mock)
        .mockResolvedValueOnce(mockResponse({ Key: '2628204', LocalizedName: 'San Francisco' }))
        .mockResolvedValueOnce(
          mockResponse(
            createMockAccuWeatherResponse({
              Wind: {
                Speed: {
                  Metric: { Value: 20, Unit: 'km/h' },
                  Imperial: { Value: 12, Unit: 'mi/h' },
                },
                Direction: { Degrees: 180, Localized: 'S', English: 'S' },
              },
              WindGust: {
                Speed: {
                  Metric: { Value: 15, Unit: 'km/h' },
                  Imperial: { Value: 9, Unit: 'mi/h' },
                },
              },
            })
          )
        );

      const weatherData = await service.fetchCurrentWeather(testLocation);

      // Gust (15 km/h) below sustained (20 km/h): a factor below 1 is not a
      // gust factor, so the field is omitted entirely.
      expect(weatherData.windGustFactor).toBeUndefined();
      expect('windGustFactor' in weatherData).toBe(false);
    });
  });

  describe('Cache Management', () => {
    it('should clear cache correctly', () => {
      service.clearLocationCache();
      const stats = service.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should provide cache statistics', () => {
      const stats = service.getCacheStats();
      expect(stats).toEqual(
        expect.objectContaining({
          size: expect.any(Number),
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle network timeouts', async () => {
      service.clearLocationCache();
      vi.mocked(global.fetch).mockClear();

      (global.fetch as Mock).mockRejectedValueOnce(new Error('AbortError'));

      await expect(service.fetchCurrentWeather({ latitude: 0, longitude: 0 })).rejects.toThrow();
    });

    it('should handle malformed API responses', async () => {
      // Clear previous mocks
      service.clearLocationCache();
      vi.mocked(global.fetch).mockClear();

      (global.fetch as Mock)
        .mockResolvedValueOnce(mockResponse({ Key: 'test' }))
        .mockResolvedValueOnce(mockResponse([])); // Empty array

      await expect(service.fetchCurrentWeather({ latitude: 0, longitude: 0 })).rejects.toThrow(
        'No current conditions data available'
      );
    });
  });

  describe('Enhanced Field Extraction', () => {
    it('should extract all available enhanced fields', async () => {
      // Setup fresh mocks
      service.clearLocationCache();
      vi.mocked(global.fetch).mockClear();

      (global.fetch as Mock)
        .mockResolvedValueOnce(mockResponse({ Key: '2628204', LocalizedName: 'San Francisco' }))
        .mockResolvedValueOnce(mockResponse(createMockAccuWeatherResponse()));

      const weatherData = await service.fetchCurrentWeather({
        latitude: 37.7749,
        longitude: -122.4194,
      });

      // Verify enhanced fields are extracted
      expect(weatherData.realFeelShade).toBeDefined();
      expect(weatherData.wetBulbTemperature).toBeDefined();
      expect(weatherData.wetBulbGlobeTemperature).toBeDefined();
      expect(weatherData.windGustSpeed).toBeDefined();
      expect(weatherData.uvIndex).toBeDefined();
      expect(weatherData.visibility).toBeDefined();
      expect(weatherData.cloudCover).toBeDefined();

      // Verify calculated fields
      expect(weatherData.beaufortScale).toBeDefined();
      expect(weatherData.absoluteHumidity).toBeDefined();
      expect(weatherData.airDensityEnhanced).toBeDefined();
      expect(weatherData.heatStressIndex).toBeDefined();
    });

    it('should calculate enhanced field count correctly', async () => {
      // Setup fresh mocks
      service.clearLocationCache();
      vi.mocked(global.fetch).mockClear();

      (global.fetch as Mock)
        .mockResolvedValueOnce(mockResponse({ Key: '2628204', LocalizedName: 'San Francisco' }))
        .mockResolvedValueOnce(mockResponse(createMockAccuWeatherResponse()));

      const weatherData = await service.fetchCurrentWeather({
        latitude: 37.7749,
        longitude: -122.4194,
      });

      // Count enhanced fields beyond basic 8
      const enhancedFields = [
        weatherData.realFeelShade,
        weatherData.wetBulbTemperature,
        weatherData.wetBulbGlobeTemperature,
        weatherData.windGustSpeed,
        weatherData.uvIndex,
        weatherData.visibility,
        weatherData.cloudCover,
        weatherData.beaufortScale,
      ].filter((field) => field !== undefined);

      expect(enhancedFields.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('Condition Detail Extraction', () => {
    const testLocation: GeoLocation = {
      latitude: 37.7749,
      longitude: -122.4194,
    };

    const fetchWith = async (
      overrides: Partial<import('../../types/index.js').AccuWeatherCurrentConditions>
    ) => {
      service.clearLocationCache();
      vi.mocked(global.fetch).mockClear();
      (global.fetch as Mock)
        .mockResolvedValueOnce(mockResponse({ Key: '2628204', LocalizedName: 'San Francisco' }))
        .mockResolvedValueOnce(mockResponse(createMockAccuWeatherResponse(overrides)));
      return service.fetchCurrentWeather(testLocation);
    };

    it('populates pressure tendency, precipitation type, and visibility obstruction', async () => {
      const weatherData = await fetchWith({
        PressureTendency: { Code: 'F' },
        PrecipitationType: 'Rain',
        ObstructionsToVisibility: 'Fog',
      });

      // Code F maps to the falling trend.
      expect(weatherData.pressureTendency).toBe(-1);
      expect(weatherData.precipitationType).toBe('Rain');
      expect(weatherData.visibilityObstruction).toBe('Fog');
      // WeatherText is now emitted as the description.
      expect(weatherData.description).toBe('Partly cloudy');
    });

    it('omits uvIndex when UVIndexFloat is not a number', async () => {
      // The response type declares UVIndexFloat as number, but the wire can
      // send null on a partial response and the validator does not check it.
      // A non-number must not land on environment.weather.uvIndex.
      const nulled = await fetchWith({ UVIndexFloat: null as unknown as number });
      expect(nulled.uvIndex).toBeUndefined();
      expect('uvIndex' in nulled).toBe(false);

      const missing = await fetchWith({ UVIndexFloat: undefined as unknown as number });
      expect('uvIndex' in missing).toBe(false);
    });

    it('maps each pressure tendency code to its numeric trend', async () => {
      const steady = await fetchWith({ PressureTendency: { Code: 'S' } });
      expect(steady.pressureTendency).toBe(0);

      const rising = await fetchWith({ PressureTendency: { Code: 'R' } });
      expect(rising.pressureTendency).toBe(1);
    });

    it('omits the new fields when the response carries no detail blocks', async () => {
      const weatherData = await fetchWith({});

      expect(weatherData.pressureTendency).toBeUndefined();
      expect(weatherData.precipitationType).toBeUndefined();
      expect(weatherData.visibilityObstruction).toBeUndefined();
      // The keys must be absent, not present-and-undefined.
      expect('pressureTendency' in weatherData).toBe(false);
      expect('precipitationType' in weatherData).toBe(false);
      expect('visibilityObstruction' in weatherData).toBe(false);
    });

    it('does not emit an empty ObstructionsToVisibility string', async () => {
      // AccuWeather sends "" (not absent) when there is no obstruction.
      const weatherData = await fetchWith({ ObstructionsToVisibility: '' });

      expect(weatherData.visibilityObstruction).toBeUndefined();
      expect('visibilityObstruction' in weatherData).toBe(false);
    });
  });

  describe('Rolling 24h request window', () => {
    let windowService: AccuWeatherService;
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const successPair = () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(
          mockResponse({ Key: '2628204', LocalizedName: 'San Francisco' }) as never
        )
        .mockResolvedValueOnce(mockResponse(createMockAccuWeatherResponse()) as never);
    };

    beforeEach(() => {
      // Pin the wall clock so the rotation math is deterministic. The service
      // captures `Date.now()` in its constructor, so construct AFTER fake
      // timers are in place.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
      windowService = new AccuWeatherService('test-api-key', mockLogger);
      vi.mocked(global.fetch).mockClear();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns 0 before any request has been made', () => {
      expect(windowService.getRequestCountLast24h()).toBe(0);
    });

    it('counts a successful request in the current-hour bucket', async () => {
      successPair();
      await windowService.fetchCurrentWeather({ latitude: 37.7749, longitude: -122.4194 });
      // 1 location lookup + 1 current-conditions call
      expect(windowService.getRequestCountLast24h()).toBe(2);
    });

    it('keeps counts that fall within the trailing 24h window', async () => {
      successPair();
      await windowService.fetchCurrentWeather({ latitude: 37.7749, longitude: -122.4194 });
      // Advance 23 hours: the prior request still falls within the window.
      vi.setSystemTime(new Date(Date.now() + 23 * ONE_HOUR_MS));
      expect(windowService.getRequestCountLast24h()).toBe(2);
    });

    it('drops counts older than 24 hours', async () => {
      successPair();
      await windowService.fetchCurrentWeather({ latitude: 37.7749, longitude: -122.4194 });
      // Advance just past the window: the original bucket has rotated out.
      vi.setSystemTime(new Date(Date.now() + 24 * ONE_HOUR_MS));
      expect(windowService.getRequestCountLast24h()).toBe(0);
    });

    it('zeroes the window on a backward clock jump and counts only fresh requests', async () => {
      successPair();
      await windowService.fetchCurrentWeather({ latitude: 37.7749, longitude: -122.4194 });
      expect(windowService.getRequestCountLast24h()).toBe(2);

      // Wall clock jumps backward 6 hours (an NTP correction). The prior
      // buckets are labelled against the now-future hour index, so their
      // counts no longer correspond to the previous 24 hours of real time.
      // We zero the window: undercounting briefly is far safer than capping
      // fetches against ghost requests for up to a full day.
      vi.setSystemTime(new Date(Date.now() - 6 * ONE_HOUR_MS));
      successPair();
      await windowService.fetchCurrentWeather({ latitude: 40.7128, longitude: -74.006 });
      expect(windowService.getRequestCountLast24h()).toBe(2);

      // 24 hours past the corrected time, every bucket has aged out.
      vi.setSystemTime(new Date(Date.now() + 24 * ONE_HOUR_MS));
      expect(windowService.getRequestCountLast24h()).toBe(0);
    });

    it('zeroes the entire window after extended idleness', async () => {
      successPair();
      await windowService.fetchCurrentWeather({ latitude: 37.7749, longitude: -122.4194 });
      // Advance more than a full window: every bucket is stale.
      vi.setSystemTime(new Date(Date.now() + 48 * ONE_HOUR_MS));
      expect(windowService.getRequestCountLast24h()).toBe(0);

      // A fresh request after the long idle still lands in the current hour.
      successPair();
      await windowService.fetchCurrentWeather({ latitude: 37.7749, longitude: -122.4194 });
      expect(windowService.getRequestCountLast24h()).toBe(2);
    });
  });

  describe('HTTP Error Handling', () => {
    const fastRetryConfig = { retryAttempts: 3, retryDelay: 1 };

    beforeEach(() => {
      service = new AccuWeatherService('test-api-key', mockLogger, fastRetryConfig);
      vi.mocked(global.fetch).mockClear();
    });

    it('throws API_FORBIDDEN on a 403 response', async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(mockResponse({ Key: '2628204' }) as never)
        .mockResolvedValueOnce(
          mockResponse(
            { message: 'plan does not include this endpoint' },
            { ok: false, status: 403, statusText: 'Forbidden' }
          ) as never
        );

      await expect(
        service.fetchCurrentWeather({ latitude: 37.7749, longitude: -122.4194 })
      ).rejects.toThrow(/API_FORBIDDEN/);
    });

    it('retries 429 responses then succeeds', async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(mockResponse({ Key: '2628204' }) as never)
        .mockResolvedValueOnce(
          mockResponse(
            { message: 'rate limited' },
            { ok: false, status: 429, statusText: 'Too Many Requests' }
          ) as never
        )
        .mockResolvedValueOnce(mockResponse(createMockAccuWeatherResponse()) as never);

      const result = await service.fetchCurrentWeather({
        latitude: 37.7749,
        longitude: -122.4194,
      });

      expect(result).toBeDefined();
      // 1 location + 1 failed conditions + 1 retry succeeded
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('throws API_RATE_LIMIT after exhausting retries on 429', async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(mockResponse({ Key: '2628204' }) as never)
        .mockResolvedValue(
          mockResponse(
            { message: 'rate limited' },
            { ok: false, status: 429, statusText: 'Too Many Requests' }
          ) as never
        );

      await expect(
        service.fetchCurrentWeather({ latitude: 37.7749, longitude: -122.4194 })
      ).rejects.toThrow(/API_RATE_LIMIT/);
    });

    it('honors Retry-After header on 503 then succeeds', async () => {
      const text503 = JSON.stringify({ message: 'temporary failure' });
      const r503 = {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers({ 'content-length': String(text503.length), 'Retry-After': '0' }),
        text: () => Promise.resolve(text503),
        json: () => Promise.resolve({ message: 'temporary failure' }),
      };

      vi.mocked(global.fetch)
        .mockResolvedValueOnce(mockResponse({ Key: '2628204' }) as never)
        .mockResolvedValueOnce(r503 as never)
        .mockResolvedValueOnce(mockResponse(createMockAccuWeatherResponse()) as never);

      const result = await service.fetchCurrentWeather({
        latitude: 37.7749,
        longitude: -122.4194,
      });

      expect(result).toBeDefined();
    });

    it('rejects with RESPONSE_TOO_LARGE when content-length exceeds the cap', async () => {
      const oversized = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-length': '2000000' }),
        text: () => Promise.resolve('{}'),
        json: () => Promise.resolve({}),
      };
      vi.mocked(global.fetch).mockResolvedValueOnce(oversized as never);

      const rejection = expect(
        service.fetchCurrentWeather({ latitude: 37.7749, longitude: -122.4194 })
      ).rejects;
      await rejection.toThrow(/RESPONSE_TOO_LARGE/);
      await rejection.toThrow(/AccuWeather response/);
    });
  });

  describe('Forecasts', () => {
    const location: GeoLocation = { latitude: 51.5, longitude: -0.12 };
    const locationPayload = {
      Key: '328328',
      LocalizedName: 'London',
      Country: { ID: 'GB', LocalizedName: 'United Kingdom' },
      AdministrativeArea: { ID: 'LND', LocalizedName: 'London' },
      GeoPosition: { Latitude: 51.5, Longitude: -0.12 },
    };
    const hourlyPayload = [
      { DateTime: '2026-05-28T12:00:00+00:00', Temperature: { Value: 18, Unit: 'C' } },
      { DateTime: '2026-05-28T13:00:00+00:00', Temperature: { Value: 19, Unit: 'C' } },
    ];

    it('fetches the 12-hour hourly forecast with metric=true', async () => {
      const fetchMock = fetch as unknown as Mock;
      fetchMock
        .mockResolvedValueOnce(mockResponse(locationPayload))
        .mockResolvedValueOnce(mockResponse(hourlyPayload));

      const result = await service.fetchHourlyForecastRaw(location);

      expect(result).toHaveLength(2);
      const forecastUrl = fetchMock.mock.calls[1]?.[0] as string;
      expect(forecastUrl).toContain('/forecasts/v1/hourly/12hour/328328');
      expect(forecastUrl).toContain('metric=true');
      expect(forecastUrl).toContain('details=true');
    });

    it('serves the second hourly call from cache without a new fetch', async () => {
      const fetchMock = fetch as unknown as Mock;
      fetchMock
        .mockResolvedValueOnce(mockResponse(locationPayload))
        .mockResolvedValueOnce(mockResponse(hourlyPayload));

      await service.fetchHourlyForecastRaw(location);
      const callsAfterFirst = fetchMock.mock.calls.length;
      await service.fetchHourlyForecastRaw(location);

      expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
    });

    it('throws a rate-limit error when quota is exhausted and nothing is cached', async () => {
      const gated = new AccuWeatherService('test-api-key', mockLogger, { dailyApiQuota: 1 });
      const fetchMock = fetch as unknown as Mock;
      fetchMock
        .mockResolvedValueOnce(mockResponse(locationPayload))
        .mockResolvedValueOnce(mockResponse(hourlyPayload));
      await gated.fetchHourlyForecastRaw(location);

      await expect(gated.fetchHourlyForecastRaw({ latitude: 40, longitude: -70 })).rejects.toThrow(
        'API_RATE_LIMIT'
      );
    });

    it('fetches the 5-day daily forecast with metric=true', async () => {
      const fetchMock = fetch as unknown as Mock;
      const dailyPayload = {
        DailyForecasts: [
          {
            Date: '2026-05-28T07:00:00+00:00',
            Temperature: { Minimum: { Value: 10, Unit: 'C' }, Maximum: { Value: 20, Unit: 'C' } },
          },
        ],
      };
      fetchMock
        .mockResolvedValueOnce(mockResponse(locationPayload))
        .mockResolvedValueOnce(mockResponse(dailyPayload));

      const result = await service.fetchDailyForecastRaw(location);

      expect(result.DailyForecasts).toHaveLength(1);
      const forecastUrl = fetchMock.mock.calls[1]?.[0] as string;
      expect(forecastUrl).toContain('/forecasts/v1/daily/5day/328328');
      expect(forecastUrl).toContain('metric=true');
    });
  });
});

describe('AccuWeatherService forecast capability', () => {
  it('declares the AccuWeather 12h/5d horizon and is forecast-capable', () => {
    const svc = new AccuWeatherService('test-key-1234567890ab', () => {});
    expect(svc.forecastCapabilities).toEqual({ hourlyHours: 12, dailyDays: 5 });
    expect(supportsForecasts(svc)).toBe(true);
  });
});
