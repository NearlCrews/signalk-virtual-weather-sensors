/**
 * AccuWeatherService Test Suite
 * Comprehensive testing of AccuWeather API integration with enhanced field extraction
 */

import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccuWeatherService } from '../../services/AccuWeatherService.js';
import type { GeoLocation } from '../../types/index.js';
import { createMockAccuWeatherResponse } from '../setup.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('AccuWeatherService', () => {
  let service: AccuWeatherService;
  let mockLogger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLogger = vi.fn();
    service = new AccuWeatherService('test-api-key', mockLogger);
    vi.clearAllMocks();
  });

  afterEach(() => {
    service.clearLocationCache();
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
      isValid: true,
    };

    beforeEach(() => {
      // Mock location search response
      const locationResponse = {
        Key: '2628204',
        LocalizedName: 'San Francisco',
        Country: { ID: 'US', LocalizedName: 'United States' },
        AdministrativeArea: { ID: 'CA', LocalizedName: 'California' },
        GeoPosition: { Latitude: 37.7749, Longitude: -122.4194 },
      };

      // Mock current conditions response with enhanced fields
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
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(locationResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(conditionsResponse),
        });
    });

    it('should fetch and transform enhanced weather data successfully', async () => {
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
      expect(weatherData.humidity).toBeCloseTo(0.65, 2); // 65% as ratio
      expect(weatherData.windSpeed).toBeCloseTo(5.14, 2); // 18.5 km/h in m/s
      expect(weatherData.windGustSpeed).toBeCloseTo(6.94, 2); // 25.0 km/h in m/s
      expect(weatherData.visibility).toBeCloseTo(16000, 1); // 16 km in meters
      expect(weatherData.cloudCover).toBeCloseTo(0.75, 2); // 75% as ratio
    });

    it('should handle API errors gracefully', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ message: 'Invalid API key' }),
      });

      await expect(service.fetchCurrentWeather(testLocation)).rejects.toThrow('Invalid API key');
    });

    it('should validate location coordinates', async () => {
      const invalidLocation: GeoLocation = {
        latitude: 91, // Invalid latitude
        longitude: -122.4194,
        isValid: false,
      };

      await expect(service.fetchCurrentWeather(invalidLocation)).rejects.toThrow(
        'Latitude must be between -90 and 90 degrees'
      );
    });

    it('should cache location keys', async () => {
      // First call
      await service.fetchCurrentWeather(testLocation);

      // Second call should use cache
      await service.fetchCurrentWeather(testLocation);

      // Should only call location API once due to caching
      expect(global.fetch).toHaveBeenCalledTimes(3); // 1 location + 2 conditions calls
    });

    it('should calculate synthetic values correctly', async () => {
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
          entries: expect.any(Number),
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle network timeouts', async () => {
      (global.fetch as Mock).mockRejectedValueOnce(new Error('AbortError'));

      await expect(
        service.fetchCurrentWeather({ latitude: 0, longitude: 0, isValid: true })
      ).rejects.toThrow();
    });

    it('should handle malformed API responses', async () => {
      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ Key: 'test' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]), // Empty array
        });

      await expect(
        service.fetchCurrentWeather({ latitude: 0, longitude: 0, isValid: true })
      ).rejects.toThrow('No current conditions data available');
    });
  });

  describe('Enhanced Field Extraction', () => {
    it('should extract all available enhanced fields', async () => {
      const weatherData = await service.fetchCurrentWeather({
        latitude: 37.7749,
        longitude: -122.4194,
        isValid: true,
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
      const weatherData = await service.fetchCurrentWeather({
        latitude: 37.7749,
        longitude: -122.4194,
        isValid: true,
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
      const weatherData = await service.fetchCurrentWeather({
        latitude: 37.7749,
        longitude: -122.4194,
        isValid: true,
      });

      expect(weatherData.quality).toBeGreaterThan(0);
      expect(weatherData.quality).toBeLessThanOrEqual(1);
    });

    it('should increase quality for rich data sets', async () => {
      // Mock response with all enhanced fields
      const richResponse = createMockAccuWeatherResponse({
        WindGust: {
          Speed: { Metric: { Value: 30, Unit: 'km/h' }, Imperial: { Value: 18.6, Unit: 'mi/h' } },
        },
        Visibility: { Metric: { Value: 20, Unit: 'km' }, Imperial: { Value: 12, Unit: 'mi' } },
      });

      (global.fetch as Mock)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ Key: 'test' }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(richResponse) });

      const weatherData = await service.fetchCurrentWeather({
        latitude: 37.7749,
        longitude: -122.4194,
        isValid: true,
      });

      // Quality should be enhanced due to rich data
      expect(weatherData.quality).toBeGreaterThan(0.9);
    });
  });
});
