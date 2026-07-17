/**
 * Unit tests for OpenMeteoService. Covers a successful fetch and mapping, URL
 * construction (params and m/s wind unit), the keyless quota accessors, error
 * propagation on a non-2xx status, the configurable base URL, coordinate
 * validation guarding the network call, and the v2 forecast-capability surface
 * (forecastCapabilities, getObservation, getHourlyForecast, getDailyForecast).
 */

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { supportsForecasts } from '../../providers/WeatherProvider.js';
import { OpenMeteoService } from '../../services/OpenMeteoService.js';
import { createMockFetchResponse, GREENWICH } from '../setup.js';

const SAMPLE = {
  current: {
    time: '2026-06-16T19:00',
    temperature_2m: 20,
    relative_humidity_2m: 50,
    pressure_msl: 1013,
    wind_speed_10m: 5,
    wind_direction_10m: 180,
    dew_point_2m: 10,
    weather_code: 1,
  },
};

describe('OpenMeteoService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches and maps current weather, and reports keyless quota accessors', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(createMockFetchResponse(SAMPLE));
    const service = new OpenMeteoService();

    const data = await service.fetchCurrentWeather(GREENWICH);

    expect(data.temperature).toBeCloseTo(293.15, 2);
    expect(data.windSpeed).toBe(5);
    expect(service.getRequestCount()).toBe(1);
    expect(service.getRequestCountLast24h()).toBe(0);
    expect(service.getCacheStats()).toEqual({ size: 0 });
    expect(service.name).toBe('Open-Meteo');
    expect(service.sourceRef).toBe('open-meteo');
  });

  it('requests the current block with m/s wind units at the vessel position', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(createMockFetchResponse(SAMPLE));
    const service = new OpenMeteoService();

    await service.fetchCurrentWeather(GREENWICH);

    const calledUrl = String((global.fetch as Mock).mock.calls[0][0]);
    expect(calledUrl).toContain('api.open-meteo.com/v1/forecast');
    expect(calledUrl).toContain('latitude=51.4779');
    expect(calledUrl).toContain('longitude=-0.0015');
    expect(calledUrl).toContain('wind_speed_unit=ms');
    expect(calledUrl).toContain('temperature_2m');
    expect(calledUrl).toContain('weather_code');
  });

  it('propagates a tagged error on a non-2xx status', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(
      createMockFetchResponse('rate limited', { ok: false, status: 429 })
    );
    const service = new OpenMeteoService();

    await expect(service.fetchCurrentWeather(GREENWICH)).rejects.toThrow(/429/);
  });

  it('uses a configured base URL', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(createMockFetchResponse(SAMPLE));
    const service = new OpenMeteoService(() => {}, { baseUrl: 'https://meteo.example.test/' });

    await service.fetchCurrentWeather(GREENWICH);

    const calledUrl = String((global.fetch as Mock).mock.calls[0][0]);
    expect(calledUrl).toContain('meteo.example.test/v1/forecast');
  });

  it('rejects invalid coordinates without issuing a request', async () => {
    const service = new OpenMeteoService();
    await expect(service.fetchCurrentWeather({ latitude: 999, longitude: 0 })).rejects.toThrow(
      /coordinates/i
    );
    expect(global.fetch as Mock).not.toHaveBeenCalled();
  });
});

const HOURLY_SAMPLE = {
  hourly: {
    time: ['2026-06-16T00:00', '2026-06-16T01:00', '2026-06-16T02:00'],
    temperature_2m: [18, 19, 20],
    relative_humidity_2m: [60, 55, 50],
    dew_point_2m: [10, 11, 10],
    apparent_temperature: [17, 18, 19],
    precipitation: [0, 0.5, 0],
    weather_code: [1, 61, 1],
    cloud_cover: [20, 80, 30],
    pressure_msl: [1012, 1011, 1013],
    wind_speed_10m: [3, 5, 4],
    wind_direction_10m: [180, 270, 90],
    wind_gusts_10m: [5, 8, 6],
    visibility: [10000, 5000, 10000],
    uv_index: [0, 0, 1],
  },
};

const DAILY_SAMPLE = {
  daily: {
    time: ['2026-06-16', '2026-06-17', '2026-06-18'],
    temperature_2m_max: [22, 24, 21],
    temperature_2m_min: [14, 15, 13],
    precipitation_sum: [0, 2.5, 0],
    weather_code: [1, 63, 0],
    wind_speed_10m_max: [6, 9, 5],
    wind_direction_10m_dominant: [180, 270, 90],
    wind_gusts_10m_max: [10, 14, 8],
    uv_index_max: [4, 2, 5],
    sunrise: ['2026-06-16T04:43', '2026-06-17T04:44', '2026-06-18T04:45'],
    sunset: ['2026-06-16T21:22', '2026-06-17T21:21', '2026-06-18T21:20'],
  },
};

describe('OpenMeteoService v2 capability', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('declares its forecast horizon and is forecast-capable', () => {
    const svc = new OpenMeteoService(() => {});
    expect(svc.forecastCapabilities).toEqual({ hourlyHours: 48, dailyDays: 7 });
    expect(supportsForecasts(svc)).toBe(true);
  });

  it('getHourlyForecast returns ascending point forecasts', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(createMockFetchResponse(HOURLY_SAMPLE));
    const svc = new OpenMeteoService();

    const results = await svc.getHourlyForecast(GREENWICH);

    expect(results).toHaveLength(3);
    expect(results[0].type).toBe('point');
    expect(results[0].date).toBe('2026-06-16T00:00:00.000Z');
    expect(results[1].date).toBe('2026-06-16T01:00:00.000Z');
    expect(results[2].date).toBe('2026-06-16T02:00:00.000Z');
    // Temperature should be Kelvin
    expect(results[0].outside?.temperature).toBeCloseTo(291.15, 2);
    expect(svc.getRequestCount()).toBe(1);
  });

  it('getHourlyForecast URL uses hourly params and forecast_days=2', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(createMockFetchResponse(HOURLY_SAMPLE));
    const svc = new OpenMeteoService();

    await svc.getHourlyForecast(GREENWICH);

    const calledUrl = String((global.fetch as Mock).mock.calls[0][0]);
    expect(calledUrl).toContain('api.open-meteo.com/v1/forecast');
    expect(calledUrl).toContain('wind_speed_unit=ms');
    expect(calledUrl).toContain('timezone=GMT');
    expect(calledUrl).toContain('forecast_days=2');
    expect(calledUrl).toContain('hourly=');
    expect(calledUrl).toContain('temperature_2m');
  });

  it('getDailyForecast returns ascending daily forecasts', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(createMockFetchResponse(DAILY_SAMPLE));
    const svc = new OpenMeteoService();

    const results = await svc.getDailyForecast(GREENWICH);

    expect(results).toHaveLength(3);
    expect(results[0].type).toBe('daily');
    expect(results[0].date).toBe('2026-06-16T00:00:00.000Z');
    expect(results[1].date).toBe('2026-06-17T00:00:00.000Z');
    expect(results[2].date).toBe('2026-06-18T00:00:00.000Z');
    expect(svc.getRequestCount()).toBe(1);
  });

  it('getDailyForecast URL uses daily params and forecast_days=7', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(createMockFetchResponse(DAILY_SAMPLE));
    const svc = new OpenMeteoService();

    await svc.getDailyForecast(GREENWICH);

    const calledUrl = String((global.fetch as Mock).mock.calls[0][0]);
    expect(calledUrl).toContain('forecast_days=7');
    expect(calledUrl).toContain('daily=');
    expect(calledUrl).toContain('temperature_2m_max');
  });

  it('getObservation returns a single observation entry', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(
      createMockFetchResponse({
        current: {
          time: '2026-06-16T19:00',
          temperature_2m: 20,
          relative_humidity_2m: 50,
          pressure_msl: 1013,
          wind_speed_10m: 5,
          wind_direction_10m: 180,
          dew_point_2m: 10,
          weather_code: 1,
        },
      })
    );
    const svc = new OpenMeteoService();

    const obs = await svc.getObservation(GREENWICH);

    expect(obs.type).toBe('observation');
    expect(obs.date).toBe('2026-06-16T19:00:00.000Z');
    expect(obs.outside?.temperature).toBeCloseTo(293.15, 2);
    expect(svc.getRequestCount()).toBe(1);
  });

  it('rejects invalid coordinates in forecast methods without issuing a request', async () => {
    const svc = new OpenMeteoService();
    const bad = { latitude: 999, longitude: 0 };
    await expect(svc.getHourlyForecast(bad)).rejects.toThrow(/coordinates/i);
    await expect(svc.getDailyForecast(bad)).rejects.toThrow(/coordinates/i);
    await expect(svc.getObservation(bad)).rejects.toThrow(/coordinates/i);
    expect(global.fetch as Mock).not.toHaveBeenCalled();
  });
});
