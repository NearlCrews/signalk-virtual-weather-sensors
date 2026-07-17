import { describe, expect, it } from 'vitest';
import {
  mapCurrentToObservation,
  mapDailyToForecasts,
  mapHourlyToForecasts,
} from '../../mappers/WeatherProviderMapper.js';
import type {
  AccuWeatherCurrentConditions,
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
    expect(f?.date).toBe('2026-05-28T12:00:00.000Z');
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

  it('omits temperature when the value is missing rather than emitting 0 K', () => {
    const noTemp = {
      DateTime: '2026-05-28T14:00:00+00:00',
      Temperature: { Value: null, Unit: 'C' },
      RelativeHumidity: 50,
    } as unknown as AccuWeatherHourlyForecast;
    const [f] = mapHourlyToForecasts([noTemp]);
    expect(f?.outside?.temperature).toBeUndefined();
    // absoluteHumidity needs temperature, so it drops too; relativeHumidity stays.
    expect(f?.outside?.relativeHumidity).toBeCloseTo(0.5, 5);
    expect(f?.outside?.absoluteHumidity).toBeUndefined();
  });

  it('does not set precipitationType when HasPrecipitation is false', () => {
    const [f] = mapHourlyToForecasts([
      { ...fullHour, HasPrecipitation: false, PrecipitationType: 'Rain' },
    ]);
    expect(f?.outside?.precipitationType).toBeUndefined();
  });

  it('preserves ascending input order', () => {
    const out = mapHourlyToForecasts([
      { DateTime: '2026-05-28T12:00:00Z', Temperature: { Value: 1, Unit: 'C' } },
      { DateTime: '2026-05-28T13:00:00Z', Temperature: { Value: 2, Unit: 'C' } },
    ]);
    expect(out.map((f) => f.date)).toEqual([
      '2026-05-28T12:00:00.000Z',
      '2026-05-28T13:00:00.000Z',
    ]);
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
    expect(f?.date).toBe('2026-05-28T07:00:00.000Z');
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
    expect(f?.sun?.sunrise).toBe('2026-05-28T05:00:00.000Z');
    expect(f?.sun?.sunset).toBe('2026-05-28T20:00:00.000Z');
  });

  it('handles a minimal daily entry without a Day block', () => {
    const [f] = mapDailyToForecasts({
      DailyForecasts: [
        {
          Date: '2026-05-29T07:00:00Z',
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

describe('mapCurrentToObservation', () => {
  const current = {
    LocalObservationDateTime: '2026-06-17T12:00:00+00:00',
    WeatherText: 'Mostly cloudy',
    Temperature: { Metric: { Value: 18, Unit: 'C' } },
    DewPoint: { Metric: { Value: 12, Unit: 'C' } },
    RealFeelTemperature: { Metric: { Value: 17, Unit: 'C' } },
    RelativeHumidity: 70,
    Pressure: { Metric: { Value: 1012, Unit: 'mb' } },
    PressureTendency: { Code: 'R' },
    Visibility: { Metric: { Value: 16, Unit: 'km' } },
    UVIndexFloat: 4,
    CloudCover: 80,
    Precip1hr: { Metric: { Value: 2, Unit: 'mm' } },
    PrecipitationType: 'Rain',
    Wind: { Speed: { Metric: { Value: 36, Unit: 'km/h' } }, Direction: { Degrees: 90 } },
    WindGust: { Speed: { Metric: { Value: 54, Unit: 'km/h' } } },
  } as unknown as AccuWeatherCurrentConditions;

  it('maps the observation envelope with pressure, tendency, and wind', () => {
    const obs = mapCurrentToObservation(current);
    expect(obs.type).toBe('observation');
    expect(obs.date).toBe('2026-06-17T12:00:00.000Z');
    expect(obs.description).toBe('Mostly cloudy');
    expect(obs.outside?.temperature).toBeCloseTo(291.15, 2);
    expect(obs.outside?.dewPointTemperature).toBeCloseTo(285.15, 2);
    expect(obs.outside?.feelsLikeTemperature).toBeCloseTo(290.15, 2);
    expect(obs.outside?.relativeHumidity).toBeCloseTo(0.7, 3);
    expect(obs.outside?.pressure).toBeCloseTo(101200, 0);
    expect(obs.outside?.pressureTendency).toBe('increasing');
    expect(obs.outside?.horizontalVisibility).toBeCloseTo(16000, 0);
    expect(obs.outside?.uvIndex).toBe(4);
    expect(obs.outside?.cloudCover).toBeCloseTo(0.8, 3);
    expect(obs.outside?.precipitationVolume).toBeCloseTo(0.002, 6);
    expect(obs.outside?.precipitationType).toBe('rain');
    expect(obs.wind?.speedTrue).toBeCloseTo(10, 2);
    expect(obs.wind?.directionTrue).toBeCloseTo(Math.PI / 2, 5);
    expect(obs.wind?.gust).toBeCloseTo(15, 2);
  });

  it('omits absent blocks', () => {
    const sparse = {
      LocalObservationDateTime: '2026-06-17T12:00:00Z',
      Temperature: { Metric: { Value: 10, Unit: 'C' } },
    } as unknown as AccuWeatherCurrentConditions;
    const obs = mapCurrentToObservation(sparse);
    expect(obs.outside?.pressure).toBeUndefined();
    expect(obs.outside?.pressureTendency).toBeUndefined();
    expect(obs.wind).toBeUndefined();
  });
});
