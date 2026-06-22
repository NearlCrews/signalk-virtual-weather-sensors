// src/__tests__/providers/MergingWeatherProvider.test.ts
import { describe, expect, it, vi } from 'vitest';
import { MergingWeatherProvider } from '../../providers/MergingWeatherProvider.js';
import type {
  CurrentWeatherProvider,
  ForecastCapableProvider,
} from '../../providers/WeatherProvider.js';
import type { WeatherData } from '../../types/index.js';

const wd = (over: Partial<WeatherData>): WeatherData => ({
  temperature: 290,
  pressure: 101000,
  humidity: 0.5,
  windSpeed: 5,
  windDirection: 0,
  dewPoint: 283,
  windChill: 290,
  heatIndex: 290,
  timestamp: '2026-06-22T12:00:00Z',
  ...over,
});

function stubProvider(
  over: Partial<CurrentWeatherProvider> & { data?: WeatherData; fail?: boolean }
): CurrentWeatherProvider {
  return {
    name: over.name ?? 'stub',
    sourceRef: over.sourceRef ?? 'stub',
    fetchCurrentWeather: vi.fn(async () => {
      if (over.fail) throw new Error('boom');
      return over.data ?? wd({});
    }),
    getRequestCount: () => 1,
    getRequestCountLast24h: () => 2,
    getCacheStats: () => ({ size: 3 }),
  };
}

function forecastStub(): ForecastCapableProvider {
  return {
    ...stubProvider({ name: 'fc', sourceRef: 'fc' }),
    forecastCapabilities: { hourlyHours: 48, dailyDays: 9 },
    getObservation: vi.fn(async () => ({ date: 'd', type: 'observation' }) as never),
    getHourlyForecast: vi.fn(async () => []),
    getDailyForecast: vi.fn(async () => []),
  };
}

describe('MergingWeatherProvider', () => {
  it('blends survivors and stamps the merged source', async () => {
    const fc = forecastStub();
    const svc = new MergingWeatherProvider(
      [fc, stubProvider({ data: wd({ temperature: 300 }) })],
      fc,
      () => {}
    );
    const merged = await svc.fetchCurrentWeather({ latitude: 0, longitude: 0 });
    expect(merged.temperature).toBeCloseTo(295, 5); // mean of 290 and 300
    expect(svc.sourceRef).toBe('merged');
    expect(svc.name).toContain('merged');
  });
  it('returns the single survivor unchanged when only one child succeeds', async () => {
    const fc = forecastStub();
    const only = wd({ temperature: 277 });
    const svc = new MergingWeatherProvider([fc, stubProvider({ fail: true })], fc, () => {});
    (fc.fetchCurrentWeather as ReturnType<typeof vi.fn>).mockResolvedValueOnce(only);
    const merged = await svc.fetchCurrentWeather({ latitude: 0, longitude: 0 });
    expect(merged).toEqual(only); // passthrough, no synthesis
  });
  it('throws when every child fails', async () => {
    const fc = forecastStub();
    (fc.fetchCurrentWeather as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('down'));
    const svc = new MergingWeatherProvider([fc, stubProvider({ fail: true })], fc, () => {});
    await expect(svc.fetchCurrentWeather({ latitude: 0, longitude: 0 })).rejects.toThrow();
  });
  it('sums child request counts and delegates forecasts to the designated child', async () => {
    const fc = forecastStub();
    const svc = new MergingWeatherProvider([fc, stubProvider({})], fc, () => {});
    expect(svc.getRequestCount()).toBe(2); // 1 + 1
    expect(svc.getRequestCountLast24h()).toBe(4); // 2 + 2
    expect(svc.getCacheStats()).toEqual({ size: 6 }); // 3 + 3
    expect(svc.forecastCapabilities).toEqual({ hourlyHours: 48, dailyDays: 9 });
    await svc.getHourlyForecast({ latitude: 0, longitude: 0 });
    expect(fc.getHourlyForecast).toHaveBeenCalled();
  });
  it('rejects a MergingWeatherProvider child at construction (no nesting)', () => {
    const fc = forecastStub();
    const inner = new MergingWeatherProvider([fc, stubProvider({})], fc, () => {});
    expect(() => new MergingWeatherProvider([inner, fc], fc, () => {})).toThrow();
  });
});
