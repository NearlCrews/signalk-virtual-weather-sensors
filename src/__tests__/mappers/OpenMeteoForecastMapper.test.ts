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
        uv_index: [3.2, 2.5],
        dew_point_2m: [10, 11],
        precipitation: [1.5, 0],
        wind_gusts_10m: [8, 9],
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
    // Gust: 8 m/s
    expect(out[0]?.wind?.gust).toBeCloseTo(8, 5);
    // UV index: 3.2
    expect(out[0]?.outside?.uvIndex).toBeCloseTo(3.2, 5);
    // Dew point: 10 C -> 283.15 K
    expect(out[0]?.outside?.dewPointTemperature).toBeCloseTo(283.15, 2);
    // absoluteHumidity is derived from temperature and relativeHumidity
    expect(typeof out[0]?.outside?.absoluteHumidity).toBe('number');
    // precipitationVolume: 1.5 mm -> 0.0015 m
    expect(out[0]?.outside?.precipitationVolume).toBeCloseTo(0.0015, 6);
    expect(out[1]?.date).toBe('2026-06-22T01:00');
  });

  it('maps the daily block to min/max temps and sun, with precipitation and wind', () => {
    const out = mapOpenMeteoDailyToForecasts({
      daily: {
        time: ['2026-06-22'],
        temperature_2m_min: [12],
        temperature_2m_max: [24],
        sunrise: ['2026-06-22T05:00'],
        sunset: ['2026-06-22T21:00'],
        precipitation_sum: [3.0],
        wind_speed_10m_max: [10],
        wind_direction_10m_dominant: [270],
        wind_gusts_10m_max: [15],
      },
    });
    expect(out[0]?.type).toBe('daily');
    expect(out[0]?.outside?.minTemperature).toBeCloseTo(285.15, 2);
    expect(out[0]?.outside?.maxTemperature).toBeCloseTo(297.15, 2);
    expect(out[0]?.sun?.sunrise).toBe('2026-06-22T05:00');
    // precipitationVolume: 3 mm -> 0.003 m
    expect(out[0]?.outside?.precipitationVolume).toBeCloseTo(0.003, 6);
    // Wind block present because wind_speed_10m_max was provided
    expect(out[0]?.wind?.speedTrue).toBeCloseTo(10, 5);
    expect(out[0]?.wind?.gust).toBeCloseTo(15, 5);
    // 270 degrees -> 3*pi/2 radians
    expect(out[0]?.wind?.directionTrue).toBeCloseTo((3 * Math.PI) / 2, 4);
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

  it('omits a missing field rather than emitting it as undefined', () => {
    // Provide a current block with no dew_point_2m or uv_index field.
    const obs = mapOpenMeteoCurrentToObservation({
      current: {
        time: '2026-06-22T00:00',
        temperature_2m: 20,
        pressure_msl: 1013,
        wind_speed_10m: 5,
        wind_direction_10m: 90,
      },
    });
    // These fields must be absent from the outside block, not present as undefined.
    expect('dewPointTemperature' in (obs.outside ?? {})).toBe(false);
    expect('uvIndex' in (obs.outside ?? {})).toBe(false);
    expect('feelsLikeTemperature' in (obs.outside ?? {})).toBe(false);
  });
});
