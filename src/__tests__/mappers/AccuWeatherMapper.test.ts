import { describe, expect, it } from 'vitest';
import { mapAccuWeatherCurrentToWeatherData } from '../../mappers/AccuWeatherMapper.js';
import type { AccuWeatherCurrentConditions } from '../../types/index.js';
import { createMockAccuWeatherResponse } from '../setup.js';

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

  it('extracts RealFeel, RealFeel shade, wet bulb, apparent temperature in Kelvin', () => {
    const [raw] = createMockAccuWeatherResponse();
    const wd = mapAccuWeatherCurrentToWeatherData(raw as AccuWeatherCurrentConditions);
    // RealFeel 20.5 C -> 293.65 K
    expect(wd.realFeel).toBeCloseTo(293.65, 1);
    // RealFeel shade 19.2 C -> 292.35 K
    expect(wd.realFeelShade).toBeCloseTo(292.35, 1);
    // WetBulb 16.8 C -> 289.95 K
    expect(wd.wetBulbTemperature).toBeCloseTo(289.95, 1);
    // Apparent 20 C -> 293.15 K
    expect(wd.apparentTemperature).toBeCloseTo(293.15, 1);
  });

  it('extracts UV index, visibility in meters, cloud cover as ratio', () => {
    const [raw] = createMockAccuWeatherResponse();
    const wd = mapAccuWeatherCurrentToWeatherData(raw as AccuWeatherCurrentConditions);
    // UVIndexFloat = 3.2
    expect(wd.uvIndex).toBeCloseTo(3.2, 5);
    // Visibility 16 km -> 16000 m
    expect(wd.visibility).toBeCloseTo(16000, 0);
    // CloudCover 75% -> 0.75
    expect(wd.cloudCover).toBeCloseTo(0.75, 5);
  });

  it('extracts precipitation last hour and temperature departure', () => {
    const [raw] = createMockAccuWeatherResponse({
      Precip1hr: { Metric: { Value: 2.5, Unit: 'mm' }, Imperial: { Value: 0.1, Unit: 'in' } },
    });
    const wd = mapAccuWeatherCurrentToWeatherData(raw as AccuWeatherCurrentConditions);
    expect(wd.precipitationLastHour).toBeCloseTo(2.5, 5);
    // Past24HourTemperatureDeparture 1.5 C in default fixture
    expect(wd.temperatureDeparture24h).toBeCloseTo(1.5, 5);
  });

  it('extracts pressure tendency from code F/S/R', () => {
    const [falling] = createMockAccuWeatherResponse({
      PressureTendency: {
        Code: 'F',
        LocalizedText: 'Falling',
      } as AccuWeatherCurrentConditions['PressureTendency'],
    } as unknown as Partial<AccuWeatherCurrentConditions>);
    const [steady] = createMockAccuWeatherResponse({
      PressureTendency: {
        Code: 'S',
        LocalizedText: 'Steady',
      } as AccuWeatherCurrentConditions['PressureTendency'],
    } as unknown as Partial<AccuWeatherCurrentConditions>);
    const [rising] = createMockAccuWeatherResponse({
      PressureTendency: {
        Code: 'R',
        LocalizedText: 'Rising',
      } as AccuWeatherCurrentConditions['PressureTendency'],
    } as unknown as Partial<AccuWeatherCurrentConditions>);
    expect(
      mapAccuWeatherCurrentToWeatherData(falling as AccuWeatherCurrentConditions).pressureTendency
    ).toBe(-1);
    expect(
      mapAccuWeatherCurrentToWeatherData(steady as AccuWeatherCurrentConditions).pressureTendency
    ).toBe(0);
    expect(
      mapAccuWeatherCurrentToWeatherData(rising as AccuWeatherCurrentConditions).pressureTendency
    ).toBe(1);
  });

  it('extracts precipitation type and visibility obstruction as sanitized strings', () => {
    const [raw] = createMockAccuWeatherResponse({
      PrecipitationType: 'Rain' as unknown as AccuWeatherCurrentConditions['PrecipitationType'],
      ObstructionsToVisibility:
        'Fog' as unknown as AccuWeatherCurrentConditions['ObstructionsToVisibility'],
    } as unknown as Partial<AccuWeatherCurrentConditions>);
    const wd = mapAccuWeatherCurrentToWeatherData(raw as AccuWeatherCurrentConditions);
    expect(wd.precipitationType).toBe('Rain');
    expect(wd.visibilityObstruction).toBe('Fog');
  });

  it('capString sanitizes control characters and non-string values', () => {
    const [raw] = createMockAccuWeatherResponse({
      WeatherText: 'Partly\x01Cloudy' as unknown as AccuWeatherCurrentConditions['WeatherText'],
    } as unknown as Partial<AccuWeatherCurrentConditions>);
    const wd = mapAccuWeatherCurrentToWeatherData(raw as AccuWeatherCurrentConditions);
    // Control char stripped
    expect(wd.description).toBe('PartlyCloudy');
  });

  it('uses AccuWeather-provided WindChillTemperature when present', () => {
    const [raw] = createMockAccuWeatherResponse({
      WindChillTemperature: {
        Metric: { Value: -5, Unit: 'C' },
        Imperial: { Value: 23, Unit: 'F' },
      },
    });
    const wd = mapAccuWeatherCurrentToWeatherData(raw as AccuWeatherCurrentConditions);
    // -5 C -> 268.15 K
    expect(wd.windChill).toBeCloseTo(268.15, 1);
  });

  it('falls back to Environment Canada wind-chill formula when WindChillTemperature is absent', () => {
    // Remove the WindChillTemperature block; mapper must compute wind chill.
    const base = {
      Temperature: { Metric: { Value: 0 } },
      Pressure: { Metric: { Value: 1013 } },
      RelativeHumidity: 50,
      Wind: { Speed: { Metric: { Value: 36 } }, Direction: { Degrees: 180 } },
      DewPoint: { Metric: { Value: -5 } },
      WeatherText: 'Clear',
      WeatherIcon: 1,
      LocalObservationDateTime: '2026-06-22T12:00:00Z',
    } as unknown as AccuWeatherCurrentConditions;
    const wd = mapAccuWeatherCurrentToWeatherData(base);
    // Wind chill formula active (0 C, 10 m/s) -> should be below 273.15 K
    expect(wd.windChill).toBeLessThan(273.15);
  });

  it('derives severeCondition from the weatherIcon code', () => {
    // Icon 15 is thunderstorms in AccuWeather's table; severity map classifies it.
    const [raw] = createMockAccuWeatherResponse({
      WeatherIcon: 15,
      WetBulbGlobeTemperature: undefined,
    });
    const wd = mapAccuWeatherCurrentToWeatherData(raw as AccuWeatherCurrentConditions);
    expect(wd.severeCondition).toBeDefined();
    expect(wd.severeCondition).not.toBe('none');
  });

  it('passes weatherIcon through to the output', () => {
    const [raw] = createMockAccuWeatherResponse({ WeatherIcon: 7 });
    const wd = mapAccuWeatherCurrentToWeatherData(raw as AccuWeatherCurrentConditions);
    expect(wd.weatherIcon).toBe(7);
  });

  it('omits optional fields when blocks are absent', () => {
    // A minimal record without any of the optional enhanced blocks.
    const minimal = {
      Temperature: { Metric: { Value: 20 } },
      Pressure: { Metric: { Value: 1013 } },
      RelativeHumidity: 50,
      Wind: { Speed: { Metric: { Value: 18 } }, Direction: { Degrees: 90 } },
      DewPoint: { Metric: { Value: 10 } },
      WeatherText: 'Clear',
      WeatherIcon: 1,
      LocalObservationDateTime: '2026-06-22T12:00:00Z',
    } as unknown as AccuWeatherCurrentConditions;
    const wd = mapAccuWeatherCurrentToWeatherData(minimal);
    expect(wd.realFeel).toBeUndefined();
    expect(wd.realFeelShade).toBeUndefined();
    expect(wd.wetBulbTemperature).toBeUndefined();
    expect(wd.apparentTemperature).toBeUndefined();
    expect(wd.uvIndex).toBeUndefined();
    expect(wd.visibility).toBeUndefined();
    expect(wd.cloudCover).toBeUndefined();
    expect(wd.precipitationLastHour).toBeUndefined();
    expect(wd.pressureTendency).toBeUndefined();
    expect(wd.precipitationType).toBeUndefined();
    expect(wd.visibilityObstruction).toBeUndefined();
  });
});
