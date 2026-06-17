/**
 * Unit tests for OpenMeteoService. Covers a successful fetch and mapping, URL
 * construction (params and m/s wind unit), the keyless quota accessors, error
 * propagation on a non-2xx status, the configurable base URL, and coordinate
 * validation guarding the network call.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
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
