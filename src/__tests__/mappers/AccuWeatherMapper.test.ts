import { describe, expect, it } from 'vitest';
import { mapAccuWeatherCurrentToWeatherData } from '../../mappers/AccuWeatherMapper.js';
import type { AccuWeatherCurrentConditions } from '../../types/index.js';

// A minimal conditions fixture with the required blocks; copy the shape the
// existing AccuWeatherService transform tests already use for current conditions.
const conditions = {
  Temperature: { Metric: { Value: 20 } },
  Pressure: { Metric: { Value: 1013 } },
  RelativeHumidity: 50,
  Wind: { Speed: { Metric: { Value: 18 } }, Direction: { Degrees: 90 } },
  DewPoint: { Metric: { Value: 10 } },
  WeatherText: 'Clear',
  WeatherIcon: 1,
  LocalObservationDateTime: '2026-06-22T12:00:00Z',
} as unknown as AccuWeatherCurrentConditions;

describe('mapAccuWeatherCurrentToWeatherData', () => {
  it('produces SI WeatherData with required canonical fields', () => {
    const wd = mapAccuWeatherCurrentToWeatherData(conditions);
    expect(wd.temperature).toBeCloseTo(293.15, 2); // 20 C in Kelvin
    expect(wd.humidity).toBeCloseTo(0.5, 5); // 50% as ratio
    expect(wd.windSpeed).toBeCloseTo(5, 1); // 18 km/h in m/s
    expect(wd.windDirection).toBeGreaterThanOrEqual(0);
    expect(wd.windDirection).toBeLessThan(Math.PI * 2);
    expect(typeof wd.beaufortScale).toBe('number');
  });
});
