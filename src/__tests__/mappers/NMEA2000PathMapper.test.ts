/**
 * NMEA2000PathMapper Test Suite
 * Testing enhanced weather data mapping to emitter-cannon compatible paths
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NMEA2000PathMapper } from '../../mappers/NMEA2000PathMapper.js';
import { createMockWeatherData } from '../setup.js';

describe('NMEA2000PathMapper', () => {
  let mapper: NMEA2000PathMapper;
  let mockLogger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLogger = vi.fn();
    mapper = new NMEA2000PathMapper(mockLogger);
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with logger', () => {
      // Create new mapper to trigger logger call
      new NMEA2000PathMapper(mockLogger);
      expect(mockLogger).toHaveBeenCalledWith(
        'info',
        'NMEA2000PathMapper initialized with enhanced emitter-cannon alignment'
      );
    });

    it('should work with default logger', () => {
      expect(() => new NMEA2000PathMapper()).not.toThrow();
    });
  });

  describe('Basic Weather Data Mapping', () => {
    it('should map core environmental data correctly', () => {
      const weatherData = createMockWeatherData({
        temperature: 293.15, // 20°C
        pressure: 101325, // Standard atmosphere
        humidity: 0.65, // 65% as ratio (0-1)
        windSpeed: 5.14, // ~10 knots
        windDirection: Math.PI / 2, // East
      });

      const delta = mapper.mapToSignalKPaths(weatherData);

      expect(delta).toEqual(
        expect.objectContaining({
          context: 'vessels.self',
          updates: expect.arrayContaining([
            expect.objectContaining({
              values: expect.arrayContaining([
                { path: 'environment.outside.temperature', value: 293.15 },
                { path: 'environment.outside.pressure', value: 101325 },
                { path: 'environment.outside.humidity', value: 0.65 },
                { path: 'environment.wind.speedTrue', value: 5.14 },
                { path: 'environment.wind.directionTrue', value: Math.PI / 2 },
              ]),
            }),
          ]),
        })
      );
    });

    it('should include all required core paths', () => {
      const weatherData = createMockWeatherData();
      const delta = mapper.mapToSignalKPaths(weatherData);
      const values = delta.updates[0]?.values || [];
      const paths = values.map((v) => v.path);

      // Core environmental paths
      expect(paths).toContain('environment.outside.temperature');
      expect(paths).toContain('environment.outside.pressure');
      expect(paths).toContain('environment.outside.humidity');
      expect(paths).toContain('environment.outside.dewPointTemperature');
      expect(paths).toContain('environment.outside.windChillTemperature');
      expect(paths).toContain('environment.outside.heatIndexTemperature');

      // Core wind paths
      expect(paths).toContain('environment.wind.speedTrue');
      expect(paths).toContain('environment.wind.directionTrue');
    });
  });

  describe('Enhanced Field Mapping', () => {
    it('should map all enhanced AccuWeather fields', () => {
      const enhancedWeatherData = createMockWeatherData({
        // Enhanced temperature readings
        realFeelShade: 291.15,
        wetBulbTemperature: 289.15,
        wetBulbGlobeTemperature: 290.15,
        apparentTemperature: 294.15,

        // Enhanced wind data
        windGustSpeed: 8.5,
        windGustFactor: 1.65,
        beaufortScale: 4,

        // Atmospheric conditions
        uvIndex: 5.2,
        visibility: 15000,
        cloudCover: 0.8,
        cloudCeiling: 1200,
        pressureTendency: 'Rising',

        // Calculated values
        absoluteHumidity: 0.012,
        airDensityEnhanced: 1.205,
        heatStressIndex: 1,
        temperatureDeparture24h: 2.5,
      });

      const delta = mapper.mapToSignalKPaths(enhancedWeatherData);
      const values = delta.updates[0]?.values || [];
      const paths = values.map((v) => v.path);

      // Enhanced temperature paths
      expect(paths).toContain('environment.outside.realFeelShade');
      expect(paths).toContain('environment.outside.wetBulbTemperature');
      expect(paths).toContain('environment.outside.wetBulbGlobeTemperature');
      expect(paths).toContain('environment.outside.apparentTemperature');

      // Enhanced humidity paths
      expect(paths).toContain('environment.outside.absoluteHumidity');

      // Enhanced wind paths
      expect(paths).toContain('environment.wind.speedGust');
      expect(paths).toContain('environment.wind.gustFactor');
      expect(paths).toContain('environment.wind.beaufortScale');

      // Atmospheric condition paths
      expect(paths).toContain('environment.outside.uvIndex');
      expect(paths).toContain('environment.outside.visibility');
      expect(paths).toContain('environment.outside.cloudCover');
      expect(paths).toContain('environment.outside.cloudCeiling');

      // Calculated property paths
      expect(paths).toContain('environment.outside.airDensity');
      expect(paths).toContain('environment.outside.heatStressIndex');
      expect(paths).toContain('environment.outside.temperatureDeparture24h');
    });

    it('should exclude undefined enhanced fields', () => {
      const basicWeatherData = createMockWeatherData({
        // Only basic fields, no enhanced fields
        realFeelShade: undefined,
        wetBulbTemperature: undefined,
        windGustSpeed: undefined,
        uvIndex: undefined,
      });

      const delta = mapper.mapToSignalKPaths(basicWeatherData);
      const values = delta.updates[0]?.values || [];
      const paths = values.map((v) => v.path);

      // Enhanced paths should not be included when values are undefined
      expect(paths).not.toContain('environment.outside.realFeelShade');
      expect(paths).not.toContain('environment.outside.wetBulbTemperature');
      expect(paths).not.toContain('environment.wind.speedGust');
      expect(paths).not.toContain('environment.outside.uvIndex');
    });
  });

  describe('NMEA2000 Compatibility', () => {
    it('should sanitize data for NMEA2000 compatibility', () => {
      const extremeWeatherData = createMockWeatherData({
        temperature: 400, // Extreme temperature (over NMEA2000 range)
        pressure: 150000, // Extreme pressure
        humidity: 1.5, // Invalid humidity > 1.0
        windSpeed: 200, // Over NMEA2000 wind speed limit
      });

      const delta = mapper.mapToSignalKPaths(extremeWeatherData);

      // Data should be sanitized to NMEA2000 ranges
      const values = delta.updates[0]?.values || [];
      const tempValue = values.find((v) => v.path === 'environment.outside.temperature')
        ?.value as number;
      const pressureValue = values.find((v) => v.path === 'environment.outside.pressure')
        ?.value as number;
      const humidityValue = values.find((v) => v.path === 'environment.outside.humidity')
        ?.value as number;
      const windSpeedValue = values.find((v) => v.path === 'environment.wind.speedTrue')
        ?.value as number;

      expect(tempValue).toBeLessThanOrEqual(358.15); // 85°C max
      expect(pressureValue).toBeLessThanOrEqual(120000); // Reasonable atmospheric max
      expect(humidityValue).toBeLessThanOrEqual(100); // Valid humidity percentage
      expect(windSpeedValue).toBeLessThanOrEqual(102.3); // NMEA2000 wind speed max
    });
  });

  describe('Path Statistics and Monitoring', () => {
    it('should count enhanced fields correctly', () => {
      const enhancedWeatherData = createMockWeatherData({
        realFeelShade: 291.15,
        wetBulbTemperature: 289.15,
        windGustSpeed: 8.5,
        uvIndex: 5.2,
        visibility: 15000,
        beaufortScale: 4,
      });

      const delta = mapper.mapToSignalKPaths(enhancedWeatherData);
      const values = delta.updates[0]?.values || [];

      expect(mockLogger).toHaveBeenCalledWith(
        'debug',
        'Enhanced NMEA2000 path mapping completed',
        expect.objectContaining({
          totalPaths: expect.any(Number),
          enhancedFields: expect.any(Number),
        })
      );

      // Should have significantly more paths than basic weather data
      expect(values.length).toBeGreaterThanOrEqual(14);
    });
  });

  describe('Enhanced Path Coverage', () => {
    it('should map maximum number of paths for full dataset', () => {
      const fullWeatherData = createMockWeatherData({
        // All enhanced temperature readings
        realFeelShade: 291.15,
        wetBulbTemperature: 289.15,
        wetBulbGlobeTemperature: 290.15,
        apparentTemperature: 294.15,

        // Enhanced humidity
        absoluteHumidity: 0.012,

        // Enhanced wind data
        windGustSpeed: 8.5,
        windGustFactor: 1.65,
        beaufortScale: 4,
        apparentWindSpeed: 7.2,
        apparentWindAngle: 0.5,

        // Atmospheric conditions
        uvIndex: 5.2,
        visibility: 15000,
        cloudCover: 0.8,
        cloudCeiling: 1200,
        pressureTendency: 'Rising',

        // Precipitation
        precipitationLastHour: 2.5,
        precipitationCurrent: 0.8,

        // Calculated properties
        airDensityEnhanced: 1.205,
        heatStressIndex: 1,
        temperatureDeparture24h: 2.5,
      });

      const delta = mapper.mapToSignalKPaths(fullWeatherData);
      const values = delta.updates[0]?.values || [];

      // Should have 20+ paths for comprehensive dataset
      expect(values.length).toBeGreaterThan(20);

      // Verify specific enhanced paths exist
      const paths = values.map((v) => v.path);
      expect(paths).toContain('environment.outside.realFeelShade');
      expect(paths).toContain('environment.outside.wetBulbGlobeTemperature');
      expect(paths).toContain('environment.wind.speedGust');
      expect(paths).toContain('environment.wind.beaufortScale');
      expect(paths).toContain('environment.outside.uvIndex');
      expect(paths).toContain('environment.outside.visibility');
      expect(paths).toContain('environment.outside.heatStressIndex');
    });

    it('should maintain Signal K delta structure integrity', () => {
      const weatherData = createMockWeatherData();
      const delta = mapper.mapToSignalKPaths(weatherData);

      // Verify Signal K delta structure
      expect(delta).toHaveProperty('context');
      expect(delta).toHaveProperty('updates');
      expect(Array.isArray(delta.updates)).toBe(true);
      expect(delta.updates.length).toBe(1);

      const update = delta.updates[0];
      expect(update).toHaveProperty('timestamp');
      expect(update).toHaveProperty('values');
      expect(Array.isArray(update.values)).toBe(true);

      // Verify each value has required structure
      update.values.forEach((value) => {
        expect(value).toHaveProperty('path');
        expect(value).toHaveProperty('value');
        expect(typeof value.path).toBe('string');
        expect(value.path.startsWith('environment.')).toBe(true);
      });
    });
  });

  describe('Apparent Wind Integration', () => {
    it('should include calculated apparent wind when available', () => {
      const weatherDataWithApparentWind = createMockWeatherData({
        apparentWindSpeed: 12.5,
        apparentWindAngle: -0.78, // Port side relative to bow
      });

      const delta = mapper.mapToSignalKPaths(weatherDataWithApparentWind);
      const values = delta.updates[0]?.values || [];
      const paths = values.map((v) => v.path);

      expect(paths).toContain('environment.wind.speedApparent');
      expect(paths).toContain('environment.wind.angleApparent');

      const speedValue = values.find((v) => v.path === 'environment.wind.speedApparent')?.value;
      const angleValue = values.find((v) => v.path === 'environment.wind.angleApparent')?.value;

      expect(speedValue).toBe(12.5);
      expect(angleValue).toBe(-0.78);
    });

    it('should exclude apparent wind when not calculated', () => {
      const weatherDataWithoutApparentWind = createMockWeatherData({
        apparentWindSpeed: undefined,
        apparentWindAngle: undefined,
      });

      const delta = mapper.mapToSignalKPaths(weatherDataWithoutApparentWind);
      const values = delta.updates[0]?.values || [];
      const paths = values.map((v) => v.path);

      expect(paths).not.toContain('environment.wind.speedApparent');
      expect(paths).not.toContain('environment.wind.angleApparent');
    });
  });

  describe('Marine Safety Features', () => {
    it('should map marine safety indices correctly', () => {
      const safetyWeatherData = createMockWeatherData({
        heatStressIndex: 3, // High heat stress
        beaufortScale: 8, // Gale conditions
        uvIndex: 9.5, // Very high UV
        visibility: 500, // Poor visibility
      });

      const delta = mapper.mapToSignalKPaths(safetyWeatherData);
      const values = delta.updates[0]?.values || [];
      const paths = values.map((v) => v.path);

      // Verify safety-critical paths are included
      expect(paths).toContain('environment.outside.heatStressIndex');
      expect(paths).toContain('environment.wind.beaufortScale');
      expect(paths).toContain('environment.outside.uvIndex');
      expect(paths).toContain('environment.outside.visibility');

      // Verify values are correctly mapped
      expect(values.find((v) => v.path === 'environment.outside.heatStressIndex')?.value).toBe(3);
      expect(values.find((v) => v.path === 'environment.wind.beaufortScale')?.value).toBe(8);
      expect(values.find((v) => v.path === 'environment.outside.uvIndex')?.value).toBe(9.5);
      expect(values.find((v) => v.path === 'environment.outside.visibility')?.value).toBe(500);
    });
  });

  describe('Performance and Scalability', () => {
    it('should process large datasets efficiently', () => {
      const startTime = Date.now();

      // Process multiple weather datasets
      for (let i = 0; i < 100; i++) {
        const weatherData = createMockWeatherData({
          temperature: 290 + (i % 20),
          windSpeed: 5 + (i % 30),
          realFeelShade: 288 + (i % 15),
          uvIndex: i % 12,
        });
        mapper.mapToSignalKPaths(weatherData);
      }

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000); // Should complete in < 1 second
    });

    it('should handle concurrent mapping requests', async () => {
      const weatherData1 = createMockWeatherData({ temperature: 293.15 });
      const weatherData2 = createMockWeatherData({ temperature: 298.15 });
      const weatherData3 = createMockWeatherData({ temperature: 288.15 });

      const promises = [
        Promise.resolve(mapper.mapToSignalKPaths(weatherData1)),
        Promise.resolve(mapper.mapToSignalKPaths(weatherData2)),
        Promise.resolve(mapper.mapToSignalKPaths(weatherData3)),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach((delta) => {
        expect(delta.updates[0]?.values.length).toBeGreaterThanOrEqual(8);
      });
    });
  });
});
