import { describe, expect, it } from 'vitest';
import { mapHourlyToForecasts } from '../../mappers/WeatherProviderMapper.js';
import type { AccuWeatherHourlyForecast } from '../../types/index.js';

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
