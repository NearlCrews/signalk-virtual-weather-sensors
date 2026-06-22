import { describe, expect, it } from 'vitest';
import {
  mapOpenMeteoCurrentToObservation,
  mapOpenMeteoDailyToForecasts,
  mapOpenMeteoHourlyToForecasts,
} from '../../mappers/OpenMeteoForecastMapper.js';

describe('OpenMeteoForecastMapper', () => {
  it('maps the hourly block to ascending SI point forecasts', () => {
    const out = mapOpenMeteoHourlyToForecasts({
      hourly: {
        time: ['2026-06-22T00:00', '2026-06-22T01:00'],
        temperature_2m: [20, 19],
        relative_humidity_2m: [50, 55],
        wind_speed_10m: [5, 6],
        wind_direction_10m: [90, 180],
        cloud_cover: [25, 50],
        visibility: [10000, 8000],
      },
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.type).toBe('point');
    expect(out[0]?.date).toBe('2026-06-22T00:00');
    expect(out[0]?.outside?.temperature).toBeCloseTo(293.15, 2);
    expect(out[0]?.outside?.relativeHumidity).toBeCloseTo(0.5, 5);
    expect(out[0]?.outside?.cloudCover).toBeCloseTo(0.25, 5);
    expect(out[0]?.outside?.horizontalVisibility).toBe(10000); // already meters, no conversion
    expect(out[0]?.wind?.speedTrue).toBeCloseTo(5, 5); // already m/s
    expect(out[1]?.date).toBe('2026-06-22T01:00');
  });
  it('maps the daily block to min/max temps and sun', () => {
    const out = mapOpenMeteoDailyToForecasts({
      daily: {
        time: ['2026-06-22'],
        temperature_2m_min: [12],
        temperature_2m_max: [24],
        sunrise: ['2026-06-22T05:00'],
        sunset: ['2026-06-22T21:00'],
      },
    });
    expect(out[0]?.type).toBe('daily');
    expect(out[0]?.outside?.minTemperature).toBeCloseTo(285.15, 2);
    expect(out[0]?.outside?.maxTemperature).toBeCloseTo(297.15, 2);
    expect(out[0]?.sun?.sunrise).toBe('2026-06-22T05:00');
  });
  it('maps a current block to a single observation with pressure', () => {
    const obs = mapOpenMeteoCurrentToObservation({
      current: {
        time: '2026-06-22T00:00',
        temperature_2m: 20,
        pressure_msl: 1013,
        wind_speed_10m: 5,
        wind_direction_10m: 90,
      },
    });
    expect(obs.type).toBe('observation');
    expect(obs.outside?.temperature).toBeCloseTo(293.15, 2);
    expect(obs.outside?.pressure).toBeCloseTo(101300, 0);
  });
});
