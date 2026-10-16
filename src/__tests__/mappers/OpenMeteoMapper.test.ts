/**
 * Unit tests for the Open-Meteo current-block to WeatherData mapper.
 * Covers unit conversions, recomputed and estimated fields, severe-condition
 * and description mapping, the AccuWeather-only fields that stay unset, and the
 * required-field guards.
 */

import { describe, expect, it } from 'vitest';
import {
  mapOpenMeteoCurrentToWeatherData,
  pastHourPrecipitationMm,
} from '../../mappers/OpenMeteoMapper.js';
import type { OpenMeteoCurrentResponse } from '../../types/index.js';

/**
 * A current block plus the 15-minutely `precipitation` companion the service
 * requests. The four buckets after 18:00 sum to 1.6 mm, the 18:00 bucket (9.9)
 * sits on the excluded edge of the hour ending at 19:00, and
 * `current.precipitation` is deliberately a DIFFERENT value: every assertion
 * about `precipitationLastHour` must show the four-bucket sum winning.
 */
function sample(
  overrides: Record<string, unknown> = {},
  minutely: OpenMeteoCurrentResponse['minutely_15'] | null = {
    time: [
      '2026-06-16T18:00',
      '2026-06-16T18:15',
      '2026-06-16T18:30',
      '2026-06-16T18:45',
      '2026-06-16T19:00',
    ],
    precipitation: [9.9, 0.2, 0.3, 0.5, 0.6],
  }
): OpenMeteoCurrentResponse {
  return {
    current: {
      time: '2026-06-16T19:00',
      interval: 900,
      temperature_2m: 20,
      relative_humidity_2m: 50,
      apparent_temperature: 19,
      precipitation: 0.4,
      weather_code: 95,
      cloud_cover: 75,
      pressure_msl: 1013,
      wind_speed_10m: 5,
      wind_direction_10m: 180,
      wind_gusts_10m: 8,
      dew_point_2m: 10,
      visibility: 24000,
      uv_index: 3.2,
      ...overrides,
    },
    ...(minutely !== null && { minutely_15: minutely }),
  };
}

describe('mapOpenMeteoCurrentToWeatherData', () => {
  it('converts the core SI fields', () => {
    const data = mapOpenMeteoCurrentToWeatherData(sample());
    expect(data.temperature).toBeCloseTo(293.15, 2);
    expect(data.pressure).toBeCloseTo(101300, 0);
    expect(data.humidity).toBeCloseTo(0.5, 3);
    expect(data.windSpeed).toBe(5);
    expect(data.windDirection).toBeCloseTo(Math.PI, 5);
    expect(data.dewPoint).toBeCloseTo(283.15, 2);
    // The GMT wall-clock string is normalized to an RFC 3339 UTC instant (Z
    // appended) so a strict consumer does not read it as local time.
    expect(data.timestamp).toBe('2026-06-16T19:00:00.000Z');
  });

  it('leaves an already-zoned timestamp untouched', () => {
    const withOffset = mapOpenMeteoCurrentToWeatherData(sample({ time: '2026-06-16T19:00+02:00' }));
    expect(withOffset.timestamp).toBe('2026-06-16T17:00:00.000Z');
    const withZulu = mapOpenMeteoCurrentToWeatherData(sample({ time: '2026-06-16T19:00Z' }));
    expect(withZulu.timestamp).toBe('2026-06-16T19:00:00.000Z');
  });

  it('derives Beaufort, gust factor, cloud cover, and apparent temperature', () => {
    const data = mapOpenMeteoCurrentToWeatherData(sample());
    expect(data.beaufortScale).toBe(3);
    expect(data.windGustSpeed).toBe(8);
    expect(data.windGustFactor).toBeCloseTo(1.6, 5);
    expect(data.cloudCover).toBeCloseTo(0.75, 3);
    expect(data.uvIndex).toBe(3.2);
    expect(data.visibility).toBe(24000);
    expect(data.apparentTemperature).toBeCloseTo(292.15, 2);
    // The four 15-minute buckets ending at the observation, NOT the 0.4 mm
    // single 15-minute sum in the current block.
    expect(data.precipitationLastHour).toBe(1.6);
  });

  it('recomputes wind chill and heat index, and estimates WBGT and heat-stress index', () => {
    const data = mapOpenMeteoCurrentToWeatherData(sample());
    expect(Number.isFinite(data.windChill)).toBe(true);
    expect(Number.isFinite(data.heatIndex)).toBe(true);
    expect(Number.isFinite(data.wetBulbGlobeTemperature as number)).toBe(true);
    expect(typeof data.heatStressIndex).toBe('number');
    expect(data.absoluteHumidity).toBeGreaterThan(0);
    expect(data.airDensityEnhanced).toBeGreaterThan(0);
  });

  it('maps the WMO code to a severe condition and a description', () => {
    const data = mapOpenMeteoCurrentToWeatherData(sample());
    expect(data.severeCondition).toEqual({ state: 'warn', label: 'Thunderstorms' });
    expect(data.description).toBe('Thunderstorm');
  });

  it('leaves AccuWeather-only fields unset', () => {
    const data = mapOpenMeteoCurrentToWeatherData(sample());
    expect(data.realFeel).toBeUndefined();
    expect(data.realFeelShade).toBeUndefined();
    expect(data.wetBulbTemperature).toBeUndefined();
    expect(data.pressureTendency).toBeUndefined();
    expect(data.precipitationType).toBeUndefined();
    expect(data.cloudCeiling).toBeUndefined();
    expect(data.temperatureDeparture24h).toBeUndefined();
    expect(data.weatherIcon).toBeUndefined();
  });

  it('omits the gust factor when the gust is below the sustained wind', () => {
    const data = mapOpenMeteoCurrentToWeatherData(sample({ wind_gusts_10m: 4, wind_speed_10m: 5 }));
    expect(data.windGustFactor).toBeUndefined();
    expect(data.windGustSpeed).toBe(4);
  });

  it('leaves severe condition and description unset for a benign code', () => {
    const data = mapOpenMeteoCurrentToWeatherData(sample({ weather_code: 1 }));
    expect(data.severeCondition).toBeUndefined();
    expect(data.description).toBe('Mainly clear');
  });

  it('throws when the current block is missing', () => {
    expect(() => mapOpenMeteoCurrentToWeatherData({})).toThrow(/missing current block/);
  });

  it('throws when a required field is missing', () => {
    expect(() => mapOpenMeteoCurrentToWeatherData(sample({ pressure_msl: undefined }))).toThrow(
      /missing pressure_msl/
    );
  });
});

describe('pastHourPrecipitationMm', () => {
  it('sums the four buckets that end at the observation stamp', () => {
    // Each bucket is the sum of the 15 minutes ending at its stamp, so the four
    // after 18:00 tile the hour ending at 19:00 and the 18:00 bucket does not.
    expect(pastHourPrecipitationMm(sample(), '2026-06-16T19:00')).toBe(1.6);
  });

  it('matches across timezone representations of the same instant', () => {
    const zoned = sample(
      {},
      {
        time: [
          '2026-06-16T19:15+01:00',
          '2026-06-16T19:30+01:00',
          '2026-06-16T19:45+01:00',
          '2026-06-16T20:00+01:00',
        ],
        precipitation: [0.2, 0.3, 0.5, 0.6],
      }
    );
    expect(pastHourPrecipitationMm(zoned, '2026-06-16T19:00Z')).toBe(1.6);
  });

  it('rounds the sum to the 0.01 mm the API reports', () => {
    const noisy = sample(
      {},
      {
        time: ['2026-06-16T18:15', '2026-06-16T18:30', '2026-06-16T18:45', '2026-06-16T19:00'],
        precipitation: [0.1, 0.2, 0.1, 0.2],
      }
    );
    expect(pastHourPrecipitationMm(noisy, '2026-06-16T19:00')).toBe(0.6);
  });

  it('returns undefined rather than a partial or shorter sum', () => {
    // No companion block, fewer than four buckets inside the hour, and a null
    // reading all leave the path unset. Publishing a partial hour, or the
    // 15-minute current-block sum, under an hourly label is the defect this guards.
    expect(pastHourPrecipitationMm(sample({}, null), '2026-06-16T19:00')).toBeUndefined();
    expect(pastHourPrecipitationMm(sample(), '2026-06-16T19:15')).toBeUndefined();
    expect(
      pastHourPrecipitationMm(
        sample(
          {},
          {
            time: ['2026-06-16T18:15', '2026-06-16T18:30', '2026-06-16T18:45', '2026-06-16T19:00'],
            precipitation: [0.2, null, 0.5, 0.6],
          }
        ),
        '2026-06-16T19:00'
      )
    ).toBeUndefined();
    expect(pastHourPrecipitationMm(sample(), 'not-a-timestamp')).toBeUndefined();
  });

  it('leaves precipitationLastHour unset when the companion block is missing', () => {
    const data = mapOpenMeteoCurrentToWeatherData(sample({}, null));
    expect(data.precipitationLastHour).toBeUndefined();
  });
});
