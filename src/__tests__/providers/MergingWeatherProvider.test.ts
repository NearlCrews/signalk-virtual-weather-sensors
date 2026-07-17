// src/__tests__/providers/MergingWeatherProvider.test.ts
import { describe, expect, it, vi } from 'vitest';
import { MergingWeatherProvider } from '../../providers/MergingWeatherProvider.js';
import type {
  CurrentWeatherProvider,
  ForecastCapableProvider,
} from '../../providers/WeatherProvider.js';
import type { WeatherData } from '../../types/index.js';

const NOW = new Date().toISOString();

const wd = (over: Partial<WeatherData>): WeatherData => ({
  temperature: 290,
  pressure: 101000,
  humidity: 0.5,
  windSpeed: 5,
  windDirection: 0,
  dewPoint: 283,
  windChill: 290,
  heatIndex: 290,
  timestamp: NOW,
  ...over,
});

function stubProvider(
  over: Partial<CurrentWeatherProvider> & { data?: WeatherData; fail?: boolean }
): CurrentWeatherProvider {
  return {
    name: over.name ?? 'stub',
    sourceRef: over.sourceRef ?? 'stub',
    ...(over.maxObservationAgeMs !== undefined && {
      maxObservationAgeMs: over.maxObservationAgeMs,
    }),
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
    getObservation: vi.fn(async () => ({ date: NOW, type: 'observation', outside: {} })),
    getHourlyForecast: vi.fn(async () => [{ date: NOW, type: 'point', outside: {} }]),
    getDailyForecast: vi.fn(async () => [{ date: NOW, type: 'daily', outside: {} }]),
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
    expect(svc.sourceRef).toBe('vws-merged');
    expect(svc.name).toContain('merged');
  });
  it('returns the single survivor unchanged when only one child succeeds', async () => {
    const fc = forecastStub();
    const only = wd({ temperature: 277 });
    const svc = new MergingWeatherProvider([fc, stubProvider({ fail: true })], fc, () => {});
    (fc.fetchCurrentWeather as ReturnType<typeof vi.fn>).mockResolvedValueOnce(only);
    const merged = await svc.fetchCurrentWeather({ latitude: 0, longitude: 0 });
    expect(merged).toEqual(only);
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
  it('falls through to the next forecast provider after a failure', async () => {
    const first = forecastStub();
    const second = forecastStub();
    (first.getHourlyForecast as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('down'));
    const svc = new MergingWeatherProvider([first, second], [first, second], () => {});
    const result = await svc.getHourlyForecast({ latitude: 0, longitude: 0 });
    expect(result).toHaveLength(1);
    expect(first.getHourlyForecast).toHaveBeenCalledOnce();
    expect(second.getHourlyForecast).toHaveBeenCalledOnce();
  });
  it('excludes observations outside the merge skew window', async () => {
    const newest = wd({ timestamp: new Date().toISOString(), temperature: 300 });
    const old = wd({
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      temperature: 270,
    });
    const fc = forecastStub();
    (fc.fetchCurrentWeather as ReturnType<typeof vi.fn>).mockResolvedValueOnce(newest);
    const svc = new MergingWeatherProvider(
      [fc, stubProvider({ data: old, maxObservationAgeMs: 3 * 60 * 60 * 1000 })],
      fc,
      () => {}
    );
    await expect(svc.fetchCurrentWeather({ latitude: 0, longitude: 0 })).resolves.toEqual(newest);
  });
  it('uses the oldest accepted timestamp for a synthesized observation', async () => {
    const newest = new Date();
    const oldest = new Date(newest.getTime() - 30 * 60 * 1000).toISOString();
    const fc = forecastStub();
    (fc.fetchCurrentWeather as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      wd({ timestamp: newest.toISOString() })
    );
    const svc = new MergingWeatherProvider(
      [fc, stubProvider({ data: wd({ timestamp: oldest }) })],
      fc,
      () => {}
    );
    expect((await svc.fetchCurrentWeather({ latitude: 0, longitude: 0 })).timestamp).toBe(oldest);
  });
  it('rejects a MergingWeatherProvider child at construction (no nesting)', () => {
    const fc = forecastStub();
    const inner = new MergingWeatherProvider([fc, stubProvider({})], fc, () => {});
    expect(() => new MergingWeatherProvider([inner, fc], fc, () => {})).toThrow();
  });
});
