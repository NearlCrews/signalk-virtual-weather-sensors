import type { Position } from '@signalk/server-api';
import { describe, expect, it, vi } from 'vitest';
import { PLUGIN } from '../../constants/index.js';
import type { ForecastCapableProvider } from '../../providers/WeatherProvider.js';
import type { WarningsService } from '../../services/WarningsService.js';
import { WeatherProviderAdapter } from '../../services/WeatherProviderAdapter.js';

const position: Position = { latitude: 51.5, longitude: -0.12 };

const provider: ForecastCapableProvider = {
  name: 'Stub',
  sourceRef: 'stub',
  forecastCapabilities: { hourlyHours: 12, dailyDays: 5 },
  fetchCurrentWeather: async () => ({}) as never,
  getRequestCount: () => 0,
  getRequestCountLast24h: () => 0,
  getCacheStats: () => ({ size: 0 }),
  getObservation: vi.fn(
    async () => ({ date: '2026-06-17T12:00:00+00:00', type: 'observation' }) as never
  ),
  getHourlyForecast: vi.fn(
    async () =>
      [
        { date: 'h1', type: 'point' },
        { date: 'h2', type: 'point' },
        { date: 'h3', type: 'point' },
      ] as never
  ),
  getDailyForecast: vi.fn(async () => [{ date: 'd1', type: 'daily' }] as never),
};

describe('WeatherProviderAdapter', () => {
  it('exposes a provider with name from the injected provider and pluginId', () => {
    const result = new WeatherProviderAdapter(provider).toProvider();
    expect(result.name).toBe('Stub');
    expect(result.methods.pluginId).toBe(PLUGIN.NAME);
  });

  it('maps point forecasts via the provider getHourlyForecast', async () => {
    const p = new WeatherProviderAdapter(provider).toProvider();
    const result = await p.methods.getForecasts(position, 'point');
    expect(provider.getHourlyForecast).toHaveBeenCalledWith({
      latitude: position.latitude,
      longitude: position.longitude,
    });
    expect(result).toHaveLength(3);
    expect(result[0]?.type).toBe('point');
  });

  it('respects maxCount for point forecasts', async () => {
    const p = new WeatherProviderAdapter(provider).toProvider();
    const result = await p.methods.getForecasts(position, 'point', { maxCount: 2 });
    expect(result).toHaveLength(2);
  });

  it('maps daily forecasts via the provider getDailyForecast', async () => {
    const p = new WeatherProviderAdapter(provider).toProvider();
    const result = await p.methods.getForecasts(position, 'daily');
    expect(provider.getDailyForecast).toHaveBeenCalledWith({
      latitude: position.latitude,
      longitude: position.longitude,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe('daily');
  });

  it('maps a single observation, honoring the requested position', async () => {
    const p = new WeatherProviderAdapter(provider).toProvider();
    const result = await p.methods.getObservations(position);

    expect(provider.getObservation).toHaveBeenCalledWith({
      latitude: position.latitude,
      longitude: position.longitude,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe('observation');
  });

  it('throws Not supported! for warnings when no warnings service is wired', async () => {
    const p = new WeatherProviderAdapter(provider).toProvider();
    await expect(p.methods.getWarnings(position)).rejects.toThrow('Not supported!');
  });

  it('routes warnings to the warnings service, honoring the position', async () => {
    const warnings = {
      getWarnings: vi
        .fn()
        .mockResolvedValue([
          { startTime: 's', endTime: 'e', details: 'd', source: 'NWS', type: 'Gale Warning' },
        ]),
    } as unknown as WarningsService;
    const p = new WeatherProviderAdapter(provider, warnings).toProvider();

    const result = await p.methods.getWarnings(position);

    expect(warnings.getWarnings).toHaveBeenCalledWith({
      latitude: position.latitude,
      longitude: position.longitude,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe('Gale Warning');
  });
});
