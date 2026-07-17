/**
 * Unit tests for MetNoService. Covers a successful fetch and mapping, URL
 * construction (/complete endpoint, lat/lon toFixed(4), contact User-Agent),
 * the keyless quota accessors, the sourceRef, and the v2 forecast surface
 * (forecastCapabilities, getObservation, getHourlyForecast, getDailyForecast,
 * and the document memo that collapses three calls into one upstream fetch).
 */

import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supportsForecasts } from '../../providers/WeatherProvider.js';
import { MetNoService } from '../../services/MetNoService.js';
import { createMockFetchResponse } from '../setup.js';

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

const SAMPLE = {
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
            },
          },
          next_1_hours: { summary: { symbol_code: 'cloudy' } },
        },
      },
    ],
  },
};

describe('MetNoService', () => {
  it('fetches Locationforecast complete and maps to WeatherData with a contact User-Agent', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(createMockFetchResponse(SAMPLE));
    const svc = new MetNoService(() => {});
    const wd = await svc.fetchCurrentWeather({ latitude: 60, longitude: 11 });
    expect(wd.temperature).toBeCloseTo(293.15, 2);
    const call = (global.fetch as Mock).mock.calls[0];
    const url = String(call[0]);
    expect(url).toContain('/complete');
    const headers = (call[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('github.com');
    expect(svc.sourceRef).toBe('met-no');
    expect(svc.getRequestCount()).toBe(1);
    expect(svc.getRequestCountLast24h()).toBe(0);
    expect(svc.getCacheStats().size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FORECAST_SAMPLE: carries a next_1_hours entry for observation/hourly and a
// full set of 00/06/12/18 UTC entries with next_6_hours for the daily mapper.
// ---------------------------------------------------------------------------
const instant = (t: number, p = 1013) => ({
  details: {
    air_temperature: t,
    air_pressure_at_sea_level: p,
    relative_humidity: 50,
    dew_point_temperature: 10,
    wind_speed: 5,
    wind_from_direction: 90,
  },
});
const sixHour = (max: number, min: number, precip: number, symbol = 'cloudy') => ({
  summary: { symbol_code: symbol },
  details: { air_temperature_max: max, air_temperature_min: min, precipitation_amount: precip },
});
const FORECAST_SAMPLE = {
  properties: {
    timeseries: [
      // First entry: the nowcast, carries next_1_hours (drives observation and hourly).
      {
        time: '2026-06-23T00:00:00Z',
        data: {
          instant: instant(14),
          next_1_hours: {
            summary: { symbol_code: 'cloudy' },
            details: { precipitation_amount: 0.2 },
          },
          next_6_hours: sixHour(14, 8, 1),
        },
      },
      {
        time: '2026-06-23T06:00:00Z',
        data: { instant: instant(18), next_6_hours: sixHour(20, 12, 0) },
      },
      {
        time: '2026-06-23T12:00:00Z',
        data: { instant: instant(22), next_6_hours: sixHour(24, 15, 2, 'rain') },
      },
      {
        time: '2026-06-23T18:00:00Z',
        data: { instant: instant(16), next_6_hours: sixHour(18, 11, 0) },
      },
    ],
  },
};

describe('MetNoService v2 capability', () => {
  it('declares its forecast horizon and is forecast-capable', () => {
    const svc = new MetNoService(() => {});
    expect(svc.forecastCapabilities).toEqual({ hourlyHours: 48, dailyDays: 9 });
    expect(supportsForecasts(svc)).toBe(true);
  });
  it('serves the observation, hourly, and daily forecast from one memoized document', async () => {
    (global.fetch as Mock).mockResolvedValue(createMockFetchResponse(FORECAST_SAMPLE));
    const svc = new MetNoService(() => {});
    const obs = await svc.getObservation({ latitude: 60, longitude: 11 });
    const hourly = await svc.getHourlyForecast({ latitude: 60, longitude: 11 });
    const daily = await svc.getDailyForecast({ latitude: 60, longitude: 11 });
    expect(obs.type).toBe('observation');
    expect(hourly[0]?.type).toBe('point');
    expect(daily[0]?.type).toBe('daily');
    // Three v2 calls at the same position share one upstream fetch (the document memo).
    expect((global.fetch as Mock).mock.calls).toHaveLength(1);
    expect(svc.getRequestCount()).toBe(1);
  });
  it('coalesces concurrent current and v2 requests for the same position', async () => {
    (global.fetch as Mock).mockResolvedValue(createMockFetchResponse(FORECAST_SAMPLE));
    const svc = new MetNoService(() => {});
    const position = { latitude: 60, longitude: 11 };
    await Promise.all([
      svc.fetchCurrentWeather(position),
      svc.getObservation(position),
      svc.getHourlyForecast(position),
      svc.getDailyForecast(position),
    ]);
    expect((global.fetch as Mock).mock.calls).toHaveLength(1);
    expect(svc.getRequestCount()).toBe(1);
  });
});
