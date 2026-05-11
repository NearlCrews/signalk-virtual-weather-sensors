/**
 * Validation Util Test Suite
 * Covers weather, navigation, configuration, AccuWeather-response, and
 * NMEA2000 sanitization code paths.
 */

import { describe, expect, it } from 'vitest';
import type { WeatherData } from '../../types/index.js';
import {
  ConfigurationValidator,
  isValidLatitude,
  isValidLongitude,
  NMEA2000Validator,
  sanitizeConfiguration,
  sanitizeForNMEA2000,
  validateAccuWeatherResponse,
  validateConfiguration,
  validateNMEA2000Ranges,
  validateWeatherData,
} from '../../utils/validation.js';

const baseValidWeather = (): Partial<WeatherData> => ({
  temperature: 293.15,
  pressure: 101325,
  humidity: 0.5,
  windSpeed: 5,
  windDirection: Math.PI / 2,
  timestamp: new Date().toISOString(),
});

describe('validateWeatherData', () => {
  it('reports valid for a well-formed payload', () => {
    const result = validateWeatherData(baseValidWeather());
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('errors when required fields are missing', () => {
    const result = validateWeatherData({});
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('Temperature'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Pressure'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Humidity'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Wind speed'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Wind direction'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Timestamp'))).toBe(true);
  });

  it('warns on out-of-range temperature/pressure/wind speed', () => {
    const result = validateWeatherData({
      ...baseValidWeather(),
      temperature: 400,
      pressure: 200000,
      windSpeed: 200,
    });
    expect(result.isValid).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('errors on humidity outside [0, 1]', () => {
    const result = validateWeatherData({
      ...baseValidWeather(),
      humidity: 1.5,
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('Humidity'))).toBe(true);
  });

  it('errors on out-of-range wind direction', () => {
    const result = validateWeatherData({
      ...baseValidWeather(),
      windDirection: 10,
    });
    expect(result.isValid).toBe(false);
  });

  it('rejects malformed timestamp', () => {
    const result = validateWeatherData({
      ...baseValidWeather(),
      timestamp: 'not-a-date',
    });
    expect(result.isValid).toBe(false);
  });

  it('rejects defined-but-non-finite numeric fields (NaN, not undefined)', () => {
    // Mutation guard: each numeric guard is `value === undefined || !Number.isFinite(value)`.
    // Mutating `||` to `&&` would still pass when the value is undefined (because both
    // branches are true). This case (defined but NaN) only fails when the `||` is intact.
    const result = validateWeatherData({
      ...baseValidWeather(),
      temperature: Number.NaN,
      pressure: Number.NaN,
      humidity: Number.NaN,
      windSpeed: Number.NaN,
      windDirection: Number.NaN,
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('Temperature'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Pressure'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Humidity'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Wind speed'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Wind direction'))).toBe(true);
  });

  it('flags enhanced-field violations', () => {
    const result = validateWeatherData({
      ...baseValidWeather(),
      uvIndex: 30,
      visibility: 100000,
      cloudCover: 1.5,
      beaufortScale: 13,
    });
    expect(result.isValid).toBe(false); // cloudCover errors
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('validateConfiguration / sanitizeConfiguration', () => {
  it('errors when API key is missing', () => {
    const result = validateConfiguration({});
    expect(result.isValid).toBe(false);
  });

  it('errors when API key is too short', () => {
    const result = validateConfiguration({ accuWeatherApiKey: 'shortkey' });
    expect(result.isValid).toBe(false);
  });

  it('passes for a sensible 32-char key', () => {
    const result = validateConfiguration({
      accuWeatherApiKey: 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6',
      updateFrequency: 5,
      emissionInterval: 5,
    });
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // Modern AccuWeather (Zuplo) keys are ~49 chars. Use a synthetic 50-char
  // fixture that does not match the Zuplo prefix to avoid secret-scanner
  // false positives.
  it('passes for keys longer than 40 characters without warnings', () => {
    const result = validateConfiguration({
      accuWeatherApiKey: 'fictional-long-fixture-key-no-real-secret-AAAAAAAA',
      updateFrequency: 5,
      emissionInterval: 5,
    });
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('rejects placeholder keys', () => {
    const result = validateConfiguration({ accuWeatherApiKey: 'your-api-key' });
    expect(result.isValid).toBe(false);
  });

  it('warns when API key contains whitespace or control characters', () => {
    const result = validateConfiguration({
      accuWeatherApiKey: 'abc123def456 ghi789jkl012mnop3456',
    });
    expect(result.warnings.some((w) => w.includes('whitespace or control characters'))).toBe(true);
  });

  it('does not warn on punctuation in API keys (some legacy keys contain them)', () => {
    const result = validateConfiguration({
      accuWeatherApiKey: 'abc123-def456_ghi789.jkl012-mnop',
    });
    expect(result.warnings.some((w) => w.includes('whitespace or control'))).toBe(false);
    expect(result.warnings.some((w) => w.includes('unexpected'))).toBe(false);
  });

  it('errors on bad updateFrequency / emissionInterval', () => {
    const r1 = validateConfiguration({
      accuWeatherApiKey: 'A1b2C3d4E5f6G7h8I9j0K1l2',
      updateFrequency: 0,
    });
    expect(r1.isValid).toBe(false);

    const r2 = validateConfiguration({
      accuWeatherApiKey: 'A1b2C3d4E5f6G7h8I9j0K1l2',
      emissionInterval: Number.NaN,
    });
    expect(r2.isValid).toBe(false);
  });

  it('warns on excessive intervals', () => {
    const r = validateConfiguration({
      accuWeatherApiKey: 'A1b2C3d4E5f6G7h8I9j0K1l2',
      updateFrequency: 120,
      emissionInterval: 120,
    });
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('sanitizeConfiguration applies defaults and clamps', () => {
    const c = sanitizeConfiguration({});
    expect(c.accuWeatherApiKey).toBe('');
    expect(c.updateFrequency).toBe(5);
    expect(c.emissionInterval).toBe(5);

    const big = sanitizeConfiguration({
      accuWeatherApiKey: '  test  ',
      updateFrequency: 999,
      emissionInterval: 999,
    });
    expect(big.accuWeatherApiKey).toBe('test');
    expect(big.updateFrequency).toBe(60);
    expect(big.emissionInterval).toBe(60);

    const small = sanitizeConfiguration({
      accuWeatherApiKey: 'k',
      updateFrequency: -10,
      emissionInterval: -10,
    });
    expect(small.updateFrequency).toBe(1);
    expect(small.emissionInterval).toBe(1);
  });

  it('exposes the grouped validator namespace', () => {
    expect(ConfigurationValidator.validateConfiguration).toBe(validateConfiguration);
    expect(ConfigurationValidator.sanitizeConfiguration).toBe(sanitizeConfiguration);
  });
});

describe('validateAccuWeatherResponse', () => {
  const validShape = [
    {
      LocalObservationDateTime: '2026-01-01T00:00:00Z',
      Temperature: { Metric: { Value: 20 } },
      RelativeHumidity: 65,
      Wind: { Speed: { Metric: { Value: 5 } }, Direction: { Degrees: 90 } },
      Pressure: { Metric: { Value: 1013 } },
      DewPoint: { Metric: { Value: 12 } },
    },
  ];

  it('passes for the happy path', () => {
    expect(validateAccuWeatherResponse(validShape).isValid).toBe(true);
  });

  it('rejects non-array responses', () => {
    expect(validateAccuWeatherResponse({}).isValid).toBe(false);
  });

  it('rejects empty arrays', () => {
    expect(validateAccuWeatherResponse([]).isValid).toBe(false);
  });

  it('reports each missing required field', () => {
    const result = validateAccuWeatherResponse([{}]);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(6);
  });

  it('checks Temperature.Metric.Value type', () => {
    const result = validateAccuWeatherResponse([{ ...validShape[0], Temperature: { Metric: {} } }]);
    expect(result.isValid).toBe(false);
  });

  it('checks Temperature.Metric presence', () => {
    const result = validateAccuWeatherResponse([{ ...validShape[0], Temperature: {} }]);
    expect(result.isValid).toBe(false);
  });

  it('requires Wind.Speed and Wind.Direction', () => {
    const result = validateAccuWeatherResponse([{ ...validShape[0], Wind: {} }]);
    expect(result.isValid).toBe(false);
  });
});

describe('NMEA2000 helpers', () => {
  describe('validateNMEA2000Ranges', () => {
    it('warns on out-of-spec temperature', () => {
      const r = validateNMEA2000Ranges({ temperature: 400 });
      expect(r.warnings.length).toBeGreaterThan(0);
    });
    it('warns on out-of-band pressure', () => {
      const r = validateNMEA2000Ranges({ pressure: 50000 });
      expect(r.warnings.length).toBeGreaterThan(0);
    });
    it('warns on excessive wind speed', () => {
      const r = validateNMEA2000Ranges({ windSpeed: 200, windGustSpeed: 200 });
      expect(r.warnings.length).toBeGreaterThanOrEqual(2);
    });
    it('errors on humidity outside [0, 1]', () => {
      expect(validateNMEA2000Ranges({ humidity: 1.5 }).isValid).toBe(false);
    });
    it('exposes the grouped validator namespace', () => {
      expect(NMEA2000Validator.validateNMEA2000Ranges).toBe(validateNMEA2000Ranges);
      expect(NMEA2000Validator.sanitizeForNMEA2000).toBe(sanitizeForNMEA2000);
    });
  });

  describe('sanitizeForNMEA2000', () => {
    const fullData = (overrides: Partial<WeatherData> = {}): WeatherData =>
      ({
        ...(baseValidWeather() as WeatherData),
        windGustSpeed: 0,
        ...overrides,
      }) as WeatherData;

    it('clamps negative wind direction into [0, 2π)', () => {
      const sanitized = sanitizeForNMEA2000(fullData({ windDirection: -Math.PI / 2 }));
      expect(sanitized.windDirection).toBeCloseTo((3 * Math.PI) / 2, 3);
    });

    it('clamps wildly out-of-range wind direction', () => {
      const sanitized = sanitizeForNMEA2000(fullData({ windDirection: 4 * Math.PI + 0.1 }));
      expect(sanitized.windDirection).toBeGreaterThanOrEqual(0);
      expect(sanitized.windDirection).toBeLessThan(2 * Math.PI);
    });

    it('clamps temperature to NMEA2000 -40°C..+85°C', () => {
      const cold = sanitizeForNMEA2000(fullData({ temperature: 100 })); // very cold
      expect(cold.temperature).toBeCloseTo(233.15, 2); // -40°C
      const hot = sanitizeForNMEA2000(fullData({ temperature: 1000 }));
      expect(hot.temperature).toBeCloseTo(358.15, 2); // +85°C
    });

    it('clamps pressure', () => {
      expect(sanitizeForNMEA2000(fullData({ pressure: 50000 })).pressure).toBe(80000);
      expect(sanitizeForNMEA2000(fullData({ pressure: 200000 })).pressure).toBe(120000);
    });

    it('clamps humidity to [0, 1]', () => {
      expect(sanitizeForNMEA2000(fullData({ humidity: -0.2 })).humidity).toBe(0);
      expect(sanitizeForNMEA2000(fullData({ humidity: 1.5 })).humidity).toBe(1);
    });

    it('clamps wind speeds to NMEA2000 maximum (102.3 m/s)', () => {
      const out = sanitizeForNMEA2000(fullData({ windSpeed: 200, windGustSpeed: 200 }));
      expect(out.windSpeed).toBe(102.3);
      expect(out.windGustSpeed).toBe(102.3);
    });
  });
});

describe('isValidLatitude / isValidLongitude', () => {
  it('boundary values', () => {
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLatitude(-90)).toBe(true);
    expect(isValidLatitude(90.0001)).toBe(false);
    expect(isValidLatitude(-90.0001)).toBe(false);
    expect(isValidLatitude(Number.NaN)).toBe(false);

    expect(isValidLongitude(180)).toBe(true);
    expect(isValidLongitude(-180)).toBe(true);
    expect(isValidLongitude(180.0001)).toBe(false);
    expect(isValidLongitude(-180.0001)).toBe(false);
    expect(isValidLongitude(Number.NaN)).toBe(false);
  });
});
