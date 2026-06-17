/**
 * Unit tests for OpenMeteoMarineService: a successful fetch and mapping, URL
 * construction against the marine host, error propagation, and coordinate
 * validation guarding the network call.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { OpenMeteoMarineService } from '../../services/OpenMeteoMarineService.js';
import { createMockFetchResponse, GREENWICH } from '../setup.js';

const SAMPLE = {
  current: {
    time: '2026-06-16T23:45',
    wave_height: 1.2,
    wave_direction: 200,
    wave_period: 6,
    sea_surface_temperature: 14,
    ocean_current_velocity: 3.6,
    ocean_current_direction: 90,
  },
};

describe('OpenMeteoMarineService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches and maps marine data', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(createMockFetchResponse(SAMPLE));
    const service = new OpenMeteoMarineService();

    const data = await service.fetchMarine(GREENWICH);

    expect(data.significantWaveHeight).toBe(1.2);
    expect(data.seaSurfaceTemperature).toBeCloseTo(287.15, 2);
    expect(data.surfaceCurrentSpeed).toBeCloseTo(1.0, 6);
    expect(service.getRequestCount()).toBe(1);
  });

  it('requests the marine current block at the vessel position', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(createMockFetchResponse(SAMPLE));
    const service = new OpenMeteoMarineService();

    await service.fetchMarine(GREENWICH);

    const calledUrl = String((global.fetch as Mock).mock.calls[0][0]);
    expect(calledUrl).toContain('marine-api.open-meteo.com/v1/marine');
    expect(calledUrl).toContain('wave_height');
    expect(calledUrl).toContain('ocean_current_velocity');
    expect(calledUrl).toContain('latitude=51.4779');
  });

  it('uses a configured base URL (self-hosted)', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(createMockFetchResponse(SAMPLE));
    const service = new OpenMeteoMarineService(() => {}, {
      baseUrl: 'https://meteo.example.test/',
    });

    await service.fetchMarine(GREENWICH);

    expect(String((global.fetch as Mock).mock.calls[0][0])).toContain(
      'meteo.example.test/v1/marine'
    );
  });

  it('propagates a tagged error on a non-2xx status', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(
      createMockFetchResponse('err', { ok: false, status: 500 })
    );
    const service = new OpenMeteoMarineService();
    await expect(service.fetchMarine(GREENWICH)).rejects.toThrow(/500/);
  });

  it('rejects invalid coordinates without issuing a request', async () => {
    const service = new OpenMeteoMarineService();
    await expect(service.fetchMarine({ latitude: 999, longitude: 0 })).rejects.toThrow(
      /coordinates/i
    );
    expect(global.fetch as Mock).not.toHaveBeenCalled();
  });
});
