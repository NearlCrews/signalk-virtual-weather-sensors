// src/__tests__/mappers/MetNoForecastMapper.test.ts
import { describe, expect, it } from 'vitest';
import {
  mapMetNoToDailyForecasts,
  mapMetNoToHourlyForecasts,
  mapMetNoToObservation,
} from '../../mappers/MetNoForecastMapper.js';
import type { MetNoLocationforecastResponse } from '../../types/index.js';

function entry(time: string, temp: number, opts: Record<string, unknown> = {}) {
  return {
    time,
    data: {
      instant: {
        details: {
          air_temperature: temp,
          air_pressure_at_sea_level: 1013,
          relative_humidity: 50,
          dew_point_temperature: 10,
          wind_speed: 5,
          wind_from_direction: 90,
          cloud_area_fraction: 25,
          ...opts,
        },
      },
      next_1_hours: { summary: { symbol_code: 'cloudy' }, details: { precipitation_amount: 0.4 } },
    },
  };
}

const HOURLY: MetNoLocationforecastResponse = {
  properties: {
    timeseries: [entry('2026-06-22T12:00:00Z', 20), entry('2026-06-22T13:00:00Z', 19)],
  },
};

describe('MetNoForecastMapper', () => {
  it('maps next_1_hours entries to ascending SI point forecasts', () => {
    const out = mapMetNoToHourlyForecasts(HOURLY);
    expect(out).toHaveLength(2);
    expect(out[0]?.type).toBe('point');
    expect(out[0]?.date).toBe('2026-06-22T12:00:00Z');
    expect(out[0]?.outside?.temperature).toBeCloseTo(293.15, 2);
    expect(out[0]?.outside?.relativeHumidity).toBeCloseTo(0.5, 5);
    expect(out[0]?.outside?.pressure).toBeCloseTo(101300, 0);
    expect(out[0]?.outside?.precipitationVolume).toBeCloseTo(0.0004, 7); // 0.4 mm to m
    expect(out[0]?.outside?.horizontalVisibility).toBeUndefined(); // Met.no has none
    expect(out[0]?.wind?.speedTrue).toBeCloseTo(5, 5);
    expect(out[0]?.wind?.directionTrue).toBeCloseTo(Math.PI / 2, 5);
    expect(out[0]?.description).toBe('Cloudy'); // symbol_code 'cloudy' maps to 'Cloudy'
    expect(out[1]?.date).toBe('2026-06-22T13:00:00Z');
  });
  it('maps the first entry to a single observation', () => {
    const obs = mapMetNoToObservation(HOURLY);
    expect(obs.type).toBe('observation');
    expect(obs.date).toBe('2026-06-22T12:00:00Z');
    expect(obs.outside?.temperature).toBeCloseTo(293.15, 2);
  });
  it('returns a degenerate envelope when the timeseries is empty', () => {
    const obs = mapMetNoToObservation({ properties: { timeseries: [] } });
    expect(obs.type).toBe('observation');
    expect(obs.date).toBe('');
    expect(obs.outside).toEqual({});
  });
  it('derives per-UTC-day min and max temperature from the 6-hour windows', () => {
    const six = (time: string, max: number, min: number, precip: number) => ({
      time,
      data: {
        instant: { details: { air_temperature: (max + min) / 2 } },
        next_6_hours: {
          summary: { symbol_code: 'rain' },
          details: {
            air_temperature_max: max,
            air_temperature_min: min,
            precipitation_amount: precip,
          },
        },
      },
    });
    const out = mapMetNoToDailyForecasts({
      properties: {
        timeseries: [
          six('2026-06-23T00:00:00Z', 14, 8, 1),
          six('2026-06-23T06:00:00Z', 20, 12, 0),
          six('2026-06-23T12:00:00Z', 24, 15, 2),
          six('2026-06-23T18:00:00Z', 18, 11, 0),
          six('2026-06-23T03:00:00Z', 99, -99, 99), // off-grid hour, must be ignored
        ],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('daily');
    expect(out[0]?.date).toBe('2026-06-23');
    expect(out[0]?.outside?.maxTemperature).toBeCloseTo(297.15, 2); // 24 C, the off-grid 99 ignored
    expect(out[0]?.outside?.minTemperature).toBeCloseTo(281.15, 2); // 8 C, the off-grid -99 ignored
    expect(out[0]?.outside?.precipitationVolume).toBeCloseTo(0.003, 6); // (1+0+2+0) mm to m, off-grid excluded
    expect(out[0]?.description).toBe('Rain'); // from the 12:00 window symbol
  });
  it('uses the earliest window description when the day has no 12:00 window', () => {
    const six = (time: string, symbol: string) => ({
      time,
      data: {
        instant: { details: { air_temperature: 15 } },
        next_6_hours: {
          summary: { symbol_code: symbol },
          details: { air_temperature_max: 20, air_temperature_min: 10, precipitation_amount: 0 },
        },
      },
    });
    const out = mapMetNoToDailyForecasts({
      properties: {
        timeseries: [
          six('2026-06-26T00:00:00Z', 'snow'), // earliest -> 'Snow'
          six('2026-06-26T06:00:00Z', 'rain'), // should NOT overwrite
          six('2026-06-26T18:00:00Z', 'cloudy'), // should NOT overwrite
        ],
      },
    });
    expect(out).toHaveLength(1);
    // The 00:00 window is the earliest and must win, not the last (18:00) window.
    expect(out[0]?.description).toBe('Snow');
  });
  it('keeps an earlier description when the 12:00 window has no symbol_code', () => {
    const six = (time: string, symbol?: string) => ({
      time,
      data: {
        instant: { details: { air_temperature: 15 } },
        next_6_hours: {
          ...(symbol !== undefined && { summary: { symbol_code: symbol } }),
          details: { air_temperature_max: 20, air_temperature_min: 10, precipitation_amount: 0 },
        },
      },
    });
    const out = mapMetNoToDailyForecasts({
      properties: {
        timeseries: [
          six('2026-06-26T00:00:00Z', 'snow'), // fallback description
          six('2026-06-26T12:00:00Z'), // noon window without a symbol must not clobber it
        ],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.description).toBe('Snow');
  });
  it('lets a later window supply the description when noon has no symbol_code', () => {
    const six = (time: string, symbol?: string) => ({
      time,
      data: {
        instant: { details: { air_temperature: 15 } },
        next_6_hours: {
          ...(symbol !== undefined && { summary: { symbol_code: symbol } }),
          details: { air_temperature_max: 20, air_temperature_min: 10, precipitation_amount: 0 },
        },
      },
    });
    const out = mapMetNoToDailyForecasts({
      properties: {
        timeseries: [
          six('2026-06-26T06:00:00Z'), // no symbol yet
          six('2026-06-26T12:00:00Z'), // noon also empty; must not lock the day
          six('2026-06-26T18:00:00Z', 'cloudy'), // only window with a symbol
        ],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.description).toBe('Cloudy');
  });
  it('emits precipitationVolume of 0 when all 6-hour windows report 0 mm', () => {
    const dryDay = (time: string) => ({
      time,
      data: {
        instant: { details: { air_temperature: 15 } },
        next_6_hours: {
          summary: { symbol_code: 'clearsky' },
          details: { air_temperature_max: 20, air_temperature_min: 10, precipitation_amount: 0 },
        },
      },
    });
    const out = mapMetNoToDailyForecasts({
      properties: {
        timeseries: [
          dryDay('2026-06-24T00:00:00Z'),
          dryDay('2026-06-24T06:00:00Z'),
          dryDay('2026-06-24T12:00:00Z'),
          dryDay('2026-06-24T18:00:00Z'),
        ],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.outside?.precipitationVolume).toBe(0);
  });
  it('omits precipitationVolume when no 6-hour window supplies the field', () => {
    const noField = (time: string) => ({
      time,
      data: {
        instant: { details: { air_temperature: 15 } },
        next_6_hours: {
          summary: { symbol_code: 'clearsky' },
          details: { air_temperature_max: 20, air_temperature_min: 10 },
        },
      },
    });
    const out = mapMetNoToDailyForecasts({
      properties: {
        timeseries: [noField('2026-06-25T00:00:00Z'), noField('2026-06-25T12:00:00Z')],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.outside?.precipitationVolume).toBeUndefined();
  });
});
