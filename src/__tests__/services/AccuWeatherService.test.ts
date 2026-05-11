/**
 * AccuWeatherService Test Suite
 * Comprehensive testing of AccuWeather API integration with enhanced field extraction
 */

import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  describe('Data Quality Assessment', () => {
    it('should calculate data quality correctly', async () => {
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

      expect(weatherData.quality).toBeGreaterThan(0);
      expect(weatherData.quality).toBeLessThanOrEqual(1);
    });

    it('should increase quality for rich data sets', async () => {
      // Clear previous mocks
      service.clearLocationCache();
      vi.mocked(global.fetch).mockClear();

      // Mock response with all enhanced fields
      const richResponse = createMockAccuWeatherResponse({
        WindGust: {
          Speed: { Metric: { Value: 30, Unit: 'km/h' }, Imperial: { Value: 18.6, Unit: 'mi/h' } },
        },
        Visibility: { Metric: { Value: 20, Unit: 'km' }, Imperial: { Value: 12, Unit: 'mi' } },
      });

      (global.fetch as Mock)
        .mockResolvedValueOnce(mockResponse({ Key: 'test' }))
        .mockResolvedValueOnce(mockResponse(richResponse));

      const weatherData = await service.fetchCurrentWeather({
        latitude: 37.7749,
        longitude: -122.4194,
      });

      // Quality should be enhanced due to rich data
      expect(weatherData.quality).toBeGreaterThan(0.9);
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

      await expect(
        service.fetchCurrentWeather({ latitude: 37.7749, longitude: -122.4194 })
      ).rejects.toThrow(/RESPONSE_TOO_LARGE/);
    });
  });
});
