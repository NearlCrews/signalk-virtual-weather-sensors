// src/__tests__/mappers/MetNoMapper.test.ts
import { describe, expect, it } from 'vitest';
import { mapMetNoCurrentToWeatherData } from '../../mappers/MetNoMapper.js';
import type { MetNoLocationforecastResponse } from '../../types/index.js';

const sample: MetNoLocationforecastResponse = {
  properties: {
    timeseries: [
      {
        time: '2026-06-22T12:00:00Z',
        data: {
          instant: {
            details: {
              air_temperature: 20,
              air_pressure_at_sea_level: 1013,
              relative_humidity: 50,
              dew_point_temperature: 10,
              wind_speed: 5,
              wind_from_direction: 90,
              cloud_area_fraction: 25,
              wind_speed_of_gust: 8,
              ultraviolet_index_clear_sky: 3,
            },
          },
          next_1_hours: {
            summary: { symbol_code: 'snow' },
            details: { precipitation_amount: 1.2 },
          },
        },
      },
    ],
  },
};

describe('mapMetNoCurrentToWeatherData', () => {
  it('maps the first timeseries entry to SI WeatherData', () => {
    const wd = mapMetNoCurrentToWeatherData(sample);
    expect(wd.temperature).toBeCloseTo(293.15, 2);
    expect(wd.pressure).toBeCloseTo(101300, 0);
    expect(wd.humidity).toBeCloseTo(0.5, 5);
    expect(wd.windSpeed).toBeCloseTo(5, 5);
    expect(wd.windDirection).toBeCloseTo(Math.PI / 2, 5);
    expect(wd.dewPoint).toBeCloseTo(283.15, 2);
    expect(wd.cloudCover).toBeCloseTo(0.25, 5);
    expect(wd.windGustSpeed).toBeCloseTo(8, 5);
    expect(wd.uvIndex).toBeCloseTo(3, 5);
    expect(wd.precipitationLastHour).toBeCloseTo(1.2, 5);
    expect(wd.severeCondition?.label).toBe('Snow');
    expect(typeof wd.beaufortScale).toBe('number');
    expect(wd.visibility).toBeUndefined(); // Met.no provides no visibility
  });
  it('maps a response that omits the optional fields (cloud, gust, uv, precip)', () => {
    const wd = mapMetNoCurrentToWeatherData({
      properties: {
        timeseries: [
          {
            time: '2026-06-22T12:00:00Z',
            data: {
              instant: {
                details: {
                  air_temperature: 5,
                  air_pressure_at_sea_level: 1000,
                  relative_humidity: 80,
                  dew_point_temperature: 2,
                  wind_speed: 3,
                  wind_from_direction: 270,
                },
              },
            },
          },
        ],
      },
    });
    expect(wd.temperature).toBeCloseTo(278.15, 2);
    expect(wd.cloudCover).toBeUndefined();
    expect(wd.uvIndex).toBeUndefined();
  });
  it('throws when the timeseries is empty', () => {
    expect(() => mapMetNoCurrentToWeatherData({ properties: { timeseries: [] } })).toThrow();
  });
});
