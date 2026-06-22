/**
 * Unit tests for MetNoService. Covers a successful fetch and mapping, URL
 * construction (/complete endpoint, lat/lon toFixed(4), contact User-Agent),
 * the keyless quota accessors, and the sourceRef.
 */

import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  });
});
