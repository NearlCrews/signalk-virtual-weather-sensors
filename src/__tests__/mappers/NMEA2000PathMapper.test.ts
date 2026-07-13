/**
 * NMEA2000PathMapper Test Suite
 * Testing enhanced weather data mapping to paths consumed by
 * signalk-nmea2000-emitter-cannon for NMEA2000 bus emission.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NMEA2000PathMapper } from '../../mappers/NMEA2000PathMapper.js';
import { toSourceRef } from '../../utils/skDelta.js';
import { createMockWeatherData, getValuesFromDelta as getValues } from '../setup.js';

describe('NMEA2000PathMapper', () => {
  let mapper: NMEA2000PathMapper;
  let mockLogger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLogger = vi.fn();
    mapper = new NMEA2000PathMapper(toSourceRef('accuweather'), mockLogger);
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with logger', () => {
      // Create new mapper to trigger logger call
      new NMEA2000PathMapper(toSourceRef('accuweather'), mockLogger);
      expect(mockLogger).toHaveBeenCalledWith('debug', expect.stringContaining('initialized'));
    });

    it('should work with default logger', () => {
      expect(() => new NMEA2000PathMapper(toSourceRef('accuweather'))).not.toThrow();
    });

    it('stamps the constructor sourceRef on the delta $source', () => {
      const update = mapper.mapToSignalKPaths(createMockWeatherData()).updates[0];
      expect(update).toHaveProperty('$source', 'accuweather');
    });

    it('stamps a provided provider sourceRef on values and meta deltas', () => {
      const om = new NMEA2000PathMapper(toSourceRef('open-meteo'), mockLogger);
      expect(om.mapToSignalKPaths(createMockWeatherData()).updates[0]).toHaveProperty(
        '$source',
        'open-meteo'
      );
      expect(om.buildMetaDelta().updates[0]).toHaveProperty('$source', 'open-meteo');
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
              $source: 'accuweather',
              values: expect.arrayContaining([
                { path: 'environment.outside.temperature', value: 293.15 },
                { path: 'environment.outside.pressure', value: 101325 },
                { path: 'environment.outside.relativeHumidity', value: 0.65 },
                { path: 'environment.wind.speedOverGround', value: 5.14 },
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
      const values = getValues(delta);
      const paths = values.map((v) => v.path);

      // Core environmental paths (Signal K 1.8.2 vocabulary)
      expect(paths).toContain('environment.outside.temperature');
      expect(paths).toContain('environment.outside.pressure');
      expect(paths).toContain('environment.outside.relativeHumidity');
      expect(paths).toContain('environment.outside.dewPointTemperature');
      expect(paths).not.toContain('environment.outside.apparentWindChillTemperature');
      expect(paths).toContain('environment.outside.theoreticalWindChillTemperature');
      expect(paths).toContain('environment.outside.heatIndexTemperature');

      // Wind: ground-referenced only (AccuWeather is not water-referenced)
      expect(paths).toContain('environment.wind.speedOverGround');
      expect(paths).toContain('environment.wind.directionTrue');
      expect(paths).not.toContain('environment.wind.speedTrue');
    });

    it('splits theoretical and apparent wind chill', () => {
      const valueAt = (delta: ReturnType<typeof mapper.mapToSignalKPaths>, path: string) =>
        getValues(delta).find((v) => v.path === path)?.value;

      // Vessel underway: apparent wind chill (vessel-motion-corrected) differs
      // from the theoretical (true-wind) value.
      const moving = mapper.mapToSignalKPaths(
        createMockWeatherData({ windChill: 270.15, apparentWindChill: 266.15 })
      );
      expect(valueAt(moving, 'environment.outside.theoreticalWindChillTemperature')).toBe(270.15);
      expect(valueAt(moving, 'environment.outside.apparentWindChillTemperature')).toBe(266.15);

      // No apparent wind chill derived: omit the apparent leaf rather than
      // relabeling the theoretical value.
      const still = mapper.mapToSignalKPaths(
        createMockWeatherData({ windChill: 270.15, apparentWindChill: undefined })
      );
      expect(valueAt(still, 'environment.outside.theoreticalWindChillTemperature')).toBe(270.15);
      expect(valueAt(still, 'environment.outside.apparentWindChillTemperature')).toBeUndefined();
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

        // Calculated values
        absoluteHumidity: 0.012,
        airDensityEnhanced: 1.205,
        heatStressIndex: 1,
        temperatureDeparture24h: 2.5,
      });

      const delta = mapper.mapToSignalKPaths(enhancedWeatherData);
      const values = getValues(delta);
      const paths = values.map((v) => v.path);

      // Non-spec paths live under environment.weather.* (producer namespace,
      // never on canonical environment.outside / environment.wind containers).
      expect(paths).toContain('environment.weather.realFeelShade');
      expect(paths).toContain('environment.weather.wetBulbTemperature');
      expect(paths).toContain('environment.weather.wetBulbGlobeTemperature');
      expect(paths).toContain('environment.weather.apparentTemperature');
      expect(paths).toContain('environment.weather.absoluteHumidity');
      expect(paths).toContain('environment.weather.speedGust');
      expect(paths).toContain('environment.weather.gustFactor');
      expect(paths).toContain('environment.weather.beaufortScale');
      expect(paths).toContain('environment.weather.uvIndex');
      expect(paths).toContain('environment.weather.visibility');
      expect(paths).toContain('environment.weather.cloudCover');
      expect(paths).toContain('environment.weather.cloudCeiling');
      expect(paths).toContain('environment.outside.airDensity');
      expect(paths).toContain('environment.weather.heatStressIndex');
      expect(paths).toContain('environment.weather.temperatureDeparture24h');
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
      const values = getValues(delta);
      const paths = values.map((v) => v.path);

      // Enhanced paths should not be included when values are undefined
      expect(paths).not.toContain('environment.weather.realFeelShade');
      expect(paths).not.toContain('environment.weather.wetBulbTemperature');
      expect(paths).not.toContain('environment.weather.speedGust');
      expect(paths).not.toContain('environment.weather.uvIndex');
    });
  });

  describe('Condition Detail Mapping', () => {
    it('maps the new condition-detail fields', () => {
      const weatherData = createMockWeatherData({
        pressureTendency: -1,
        description: 'Thunderstorms',
        precipitationType: 'Rain',
        visibilityObstruction: 'Fog',
      });

      const delta = mapper.mapToSignalKPaths(weatherData);
      const values = getValues(delta);
      const valueAt = (path: string) => values.find((v) => v.path === path)?.value;

      expect(valueAt('environment.weather.pressureTendency')).toBe(-1);
      expect(valueAt('environment.weather.description')).toBe('Thunderstorms');
      expect(valueAt('environment.weather.precipitationType')).toBe('Rain');
      expect(valueAt('environment.weather.visibilityObstruction')).toBe('Fog');
    });

    it('excludes the new fields when they are undefined', () => {
      // createMockWeatherData defaults description, so clear it explicitly.
      const weatherData = createMockWeatherData({ description: undefined });
      const delta = mapper.mapToSignalKPaths(weatherData);
      const paths = getValues(delta).map((v) => v.path);

      expect(paths).not.toContain('environment.weather.pressureTendency');
      expect(paths).not.toContain('environment.weather.description');
      expect(paths).not.toContain('environment.weather.precipitationType');
      expect(paths).not.toContain('environment.weather.visibilityObstruction');
    });

    it('includes meta entries for every new path', () => {
      const metaDelta = mapper.buildMetaDelta();
      const update = metaDelta.updates[0];
      const meta = update && 'meta' in update ? update.meta : [];
      const metaPaths = meta.map((m) => m.path);

      const newPaths = [
        'environment.weather.pressureTendency',
        'environment.weather.description',
        'environment.weather.precipitationType',
        'environment.weather.visibilityObstruction',
      ];
      for (const path of newPaths) {
        expect(metaPaths).toContain(path);
      }
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
      const values = getValues(delta);
      const tempValue = values.find((v) => v.path === 'environment.outside.temperature')
        ?.value as number;
      const pressureValue = values.find((v) => v.path === 'environment.outside.pressure')
        ?.value as number;
      const humidityValue = values.find((v) => v.path === 'environment.outside.relativeHumidity')
        ?.value as number;
      const windSpeedValue = values.find((v) => v.path === 'environment.wind.speedOverGround')
        ?.value as number;

      expect(tempValue).toBeLessThanOrEqual(358.15); // 85°C max
      expect(pressureValue).toBeLessThanOrEqual(120000); // Reasonable atmospheric max
      expect(humidityValue).toBeLessThanOrEqual(1); // Signal K spec: humidity is a 0-1 ratio
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
      const values = getValues(delta);

      expect(mockLogger).toHaveBeenCalledWith(
        'debug',
        'Enhanced NMEA2000 path mapping completed',
        expect.objectContaining({
          totalPaths: expect.any(Number),
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

        // Precipitation
        precipitationLastHour: 2.5,

        // Calculated properties
        airDensityEnhanced: 1.205,
        heatStressIndex: 1,
        temperatureDeparture24h: 2.5,
      });

      const delta = mapper.mapToSignalKPaths(fullWeatherData);
      const values = getValues(delta);

      // Should have 20+ paths for comprehensive dataset
      expect(values.length).toBeGreaterThan(20);

      // Verify specific enhanced paths exist (all under environment.weather.*)
      const paths = values.map((v) => v.path);
      expect(paths).toContain('environment.weather.realFeelShade');
      expect(paths).toContain('environment.weather.wetBulbGlobeTemperature');
      expect(paths).toContain('environment.weather.speedGust');
      expect(paths).toContain('environment.weather.beaufortScale');
      expect(paths).toContain('environment.weather.uvIndex');
      expect(paths).toContain('environment.weather.visibility');
      expect(paths).toContain('environment.weather.heatStressIndex');
    });

    it('should maintain Signal K delta structure integrity', () => {
      const weatherData = createMockWeatherData();
      const delta = mapper.mapToSignalKPaths(weatherData);

      expect(delta).toHaveProperty('context');
      expect(delta).toHaveProperty('updates');
      expect(Array.isArray(delta.updates)).toBe(true);
      expect(delta.updates.length).toBe(1);

      const update = delta.updates[0];
      expect(update).toHaveProperty('timestamp');
      expect(update).toHaveProperty('$source', 'accuweather');
      const values = getValues(delta);
      expect(Array.isArray(values)).toBe(true);

      // Every value entry has the canonical {path, value} shape under environment.*
      values.forEach((value) => {
        expect(value).toHaveProperty('path');
        expect(value).toHaveProperty('value');
        expect(typeof value.path).toBe('string');
        expect(value.path.startsWith('environment.')).toBe(true);
      });
    });

    it('should expose a one-shot meta delta describing non-canonical paths', () => {
      const metaDelta = mapper.buildMetaDelta();
      expect(metaDelta.updates).toHaveLength(1);
      const update = metaDelta.updates[0];
      expect(update).toHaveProperty('$source', 'accuweather');
      expect(update && 'meta' in update).toBe(true);
      const meta = update && 'meta' in update ? update.meta : [];
      expect(meta.length).toBeGreaterThan(0);
      // Meta entries describe non-canonical paths under environment.weather.*
      const metaPaths = meta.map((m) => m.path);
      expect(metaPaths).toContain('environment.weather.beaufortScale');
      expect(metaPaths).toContain('environment.weather.heatStressIndex');
    });
  });

  describe('Apparent Wind Integration', () => {
    it('should include calculated apparent wind when available', () => {
      const weatherDataWithApparentWind = createMockWeatherData({
        apparentWindSpeed: 12.5,
        apparentWindAngle: -0.78, // Port side relative to bow
      });

      const delta = mapper.mapToSignalKPaths(weatherDataWithApparentWind);
      const values = getValues(delta);
      const paths = values.map((v) => v.path);

      expect(paths).toContain('environment.weather.windSpeedApparent');
      expect(paths).toContain('environment.weather.windAngleApparent');

      const speedValue = values.find(
        (v) => v.path === 'environment.weather.windSpeedApparent'
      )?.value;
      const angleValue = values.find(
        (v) => v.path === 'environment.weather.windAngleApparent'
      )?.value;

      expect(speedValue).toBe(12.5);
      expect(angleValue).toBe(-0.78);
      // Synthetic apparent wind must never squat the canonical environment.wind.*
      // anemometer leaves: the cannon NMEA2000 bridge subscribes there for the
      // real anemometer feed.
      expect(paths).not.toContain('environment.wind.speedApparent');
      expect(paths).not.toContain('environment.wind.angleApparent');
    });

    it('should exclude apparent wind when not calculated', () => {
      const weatherDataWithoutApparentWind = createMockWeatherData({
        apparentWindSpeed: undefined,
        apparentWindAngle: undefined,
      });

      const delta = mapper.mapToSignalKPaths(weatherDataWithoutApparentWind);
      const values = getValues(delta);
      const paths = values.map((v) => v.path);

      expect(paths).not.toContain('environment.wind.speedApparent');
      expect(paths).not.toContain('environment.wind.angleApparent');
    });

    it('emits both wind-chill leaves even when their values are numerically equal', () => {
      const valueAt = (delta: ReturnType<typeof mapper.mapToSignalKPaths>, path: string) =>
        getValues(delta).find((v) => v.path === path)?.value;

      // Apparent and theoretical produce the same chill: stationary vessel.
      const stationary = mapper.mapToSignalKPaths(
        createMockWeatherData({ windChill: 270.15, apparentWindChill: 270.15 })
      );
      expect(valueAt(stationary, 'environment.outside.theoreticalWindChillTemperature')).toBe(
        270.15
      );
      expect(valueAt(stationary, 'environment.outside.apparentWindChillTemperature')).toBe(270.15);
      // Both leaves are emitted as independent paths (no dedupe).
      const paths = getValues(stationary).map((v) => v.path);
      const count = (p: string) => paths.filter((x) => x === p).length;
      expect(count('environment.outside.theoreticalWindChillTemperature')).toBe(1);
      expect(count('environment.outside.apparentWindChillTemperature')).toBe(1);
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
      const values = getValues(delta);
      const paths = values.map((v) => v.path);

      // Safety-critical paths under environment.weather.*
      expect(paths).toContain('environment.weather.heatStressIndex');
      expect(paths).toContain('environment.weather.beaufortScale');
      expect(paths).toContain('environment.weather.uvIndex');
      expect(paths).toContain('environment.weather.visibility');

      // Verify values are correctly mapped
      expect(values.find((v) => v.path === 'environment.weather.heatStressIndex')?.value).toBe(3);
      expect(values.find((v) => v.path === 'environment.weather.beaufortScale')?.value).toBe(8);
      expect(values.find((v) => v.path === 'environment.weather.uvIndex')?.value).toBe(9.5);
      expect(values.find((v) => v.path === 'environment.weather.visibility')?.value).toBe(500);
    });
  });

  describe('Mapping is stateless', () => {
    // The wall-clock "process 100 datasets under 1s" check was dropped: it
    // produced false negatives on slow CI without proving anything the
    // state-leakage assertion below does not already cover.
    it('should handle repeated mapping calls without state leakage', () => {
      const weatherData1 = createMockWeatherData({ temperature: 293.15 });
      const weatherData2 = createMockWeatherData({ temperature: 298.15 });
      const weatherData3 = createMockWeatherData({ temperature: 288.15 });

      const results = [
        mapper.mapToSignalKPaths(weatherData1),
        mapper.mapToSignalKPaths(weatherData2),
        mapper.mapToSignalKPaths(weatherData3),
      ];

      expect(results).toHaveLength(3);
      const tempPaths = results.map(
        (d) => d.updates[0]?.values.find((v) => v.path === 'environment.outside.temperature')?.value
      );
      expect(tempPaths).toEqual([293.15, 298.15, 288.15]);
    });
  });
});
