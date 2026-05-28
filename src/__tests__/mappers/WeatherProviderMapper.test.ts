import { describe, expect, it } from 'vitest';
import { mapDailyToForecasts, mapHourlyToForecasts } from '../../mappers/WeatherProviderMapper.js';
import type {
  AccuWeatherDailyForecastResponse,
  AccuWeatherHourlyForecast,
} from '../../types/index.js';

const fullHour: AccuWeatherHourlyForecast = {
  DateTime: '2026-05-28T12:00:00+00:00',
  IconPhrase: 'Partly sunny',
  HasPrecipitation: true,
  PrecipitationType: 'Rain',
  Temperature: { Value: 20, Unit: 'C' },
  RealFeelTemperature: { Value: 22, Unit: 'C' },
  DewPoint: { Value: 10, Unit: 'C' },
  Wind: { Speed: { Value: 18, Unit: 'km/h' }, Direction: { Degrees: 90 } },
  WindGust: { Speed: { Value: 36, Unit: 'km/h' } },
  RelativeHumidity: 50,
  Visibility: { Value: 16, Unit: 'km' },
  UVIndex: 4,
  CloudCover: 40,
  TotalLiquid: { Value: 2, Unit: 'mm' },
};

describe('mapHourlyToForecasts', () => {
  it('maps a full hour to an SI point forecast', () => {
    const [f] = mapHourlyToForecasts([fullHour]);
    expect(f?.date).toBe('2026-05-28T12:00:00+00:00');
    expect(f?.type).toBe('point');
    expect(f?.description).toBe('Partly sunny');
    expect(f?.outside?.temperature).toBeCloseTo(293.15, 2);
    expect(f?.outside?.dewPointTemperature).toBeCloseTo(283.15, 2);
    expect(f?.outside?.feelsLikeTemperature).toBeCloseTo(295.15, 2);
    expect(f?.outside?.relativeHumidity).toBeCloseTo(0.5, 5);
    expect(f?.outside?.absoluteHumidity).toBeGreaterThan(0);
    expect(f?.outside?.horizontalVisibility).toBe(16000);
    expect(f?.outside?.uvIndex).toBe(4);
    expect(f?.outside?.cloudCover).toBeCloseTo(0.4, 5);
    expect(f?.outside?.precipitationVolume).toBeCloseTo(0.002, 6);
    expect(f?.outside?.precipitationType).toBe('rain');
    expect(f?.wind?.speedTrue).toBeCloseTo(5, 2);
    expect(f?.wind?.directionTrue).toBeCloseTo(Math.PI / 2, 5);
    expect(f?.wind?.gust).toBeCloseTo(10, 2);
  });

  it('omits absent blocks instead of emitting zero', () => {
    const sparse: AccuWeatherHourlyForecast = {
      DateTime: '2026-05-28T13:00:00+00:00',
      Temperature: { Value: 15, Unit: 'C' },
    };
    const [f] = mapHourlyToForecasts([sparse]);
    expect(f?.outside?.temperature).toBeCloseTo(288.15, 2);
    expect(f?.outside?.cloudCover).toBeUndefined();
    expect(f?.outside?.precipitationVolume).toBeUndefined();
    expect(f?.wind).toBeUndefined();
    expect(f?.description).toBeUndefined();
  });

  it('does not set precipitationType when HasPrecipitation is false', () => {
    const [f] = mapHourlyToForecasts([
      { ...fullHour, HasPrecipitation: false, PrecipitationType: 'Rain' },
    ]);
    expect(f?.outside?.precipitationType).toBeUndefined();
  });

  it('preserves ascending input order', () => {
    const out = mapHourlyToForecasts([
      { DateTime: 'a', Temperature: { Value: 1, Unit: 'C' } },
      { DateTime: 'b', Temperature: { Value: 2, Unit: 'C' } },
    ]);
    expect(out.map((f) => f.date)).toEqual(['a', 'b']);
  });
});

describe('mapDailyToForecasts', () => {
  const resp: AccuWeatherDailyForecastResponse = {
    DailyForecasts: [
      {
        Date: '2026-05-28T07:00:00+00:00',
        Temperature: { Minimum: { Value: 10, Unit: 'C' }, Maximum: { Value: 22, Unit: 'C' } },
        Day: {
          IconPhrase: 'Showers',
          HasPrecipitation: true,
          PrecipitationType: 'Rain',
          Wind: { Speed: { Value: 18, Unit: 'km/h' }, Direction: { Degrees: 180 } },
          WindGust: { Speed: { Value: 36, Unit: 'km/h' } },
          TotalLiquid: { Value: 5, Unit: 'mm' },
          CloudCover: 80,
        },
        Sun: { Rise: '2026-05-28T05:00:00+00:00', Set: '2026-05-28T20:00:00+00:00' },
        AirAndPollen: [{ Name: 'UVIndex', Value: 6, Category: 'High' }],
      },
    ],
  };

  it('maps a daily entry to SI daily WeatherData', () => {
    const [f] = mapDailyToForecasts(resp);
    expect(f?.date).toBe('2026-05-28T07:00:00+00:00');
    expect(f?.type).toBe('daily');
    expect(f?.description).toBe('Showers');
    expect(f?.outside?.minTemperature).toBeCloseTo(283.15, 2);
    expect(f?.outside?.maxTemperature).toBeCloseTo(295.15, 2);
    expect(f?.outside?.uvIndex).toBe(6);
    expect(f?.outside?.cloudCover).toBeCloseTo(0.8, 5);
    expect(f?.outside?.precipitationVolume).toBeCloseTo(0.005, 6);
    expect(f?.outside?.precipitationType).toBe('rain');
    expect(f?.outside?.temperature).toBeUndefined();
    expect(f?.outside?.pressure).toBeUndefined();
    expect(f?.wind?.speedTrue).toBeCloseTo(5, 2);
    expect(f?.wind?.directionTrue).toBeCloseTo(Math.PI, 5);
    expect(f?.wind?.gust).toBeCloseTo(10, 2);
    expect(f?.sun?.sunrise).toBe('2026-05-28T05:00:00+00:00');
    expect(f?.sun?.sunset).toBe('2026-05-28T20:00:00+00:00');
  });

  it('handles a minimal daily entry without a Day block', () => {
    const [f] = mapDailyToForecasts({
      DailyForecasts: [
        {
          Date: 'd',
          Temperature: { Minimum: { Value: 5, Unit: 'C' }, Maximum: { Value: 9, Unit: 'C' } },
        },
      ],
    });
    expect(f?.outside?.minTemperature).toBeCloseTo(278.15, 2);
    expect(f?.wind).toBeUndefined();
    expect(f?.sun).toBeUndefined();
    expect(f?.description).toBeUndefined();
  });
});
