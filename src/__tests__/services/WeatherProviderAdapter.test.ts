import type { Position } from '@signalk/server-api';
import { describe, expect, it, vi } from 'vitest';
import { PLUGIN } from '../../constants/index.js';
import { AccuWeatherService } from '../../services/AccuWeatherService.js';
import { WeatherProviderAdapter } from '../../services/WeatherProviderAdapter.js';

const position: Position = { latitude: 51.5, longitude: -0.12 };

function buildAdapter(overrides: Partial<AccuWeatherService> = {}): WeatherProviderAdapter {
  const accu = Object.assign(Object.create(AccuWeatherService.prototype), {
    getHourlyForecast: vi.fn().mockResolvedValue([
      { DateTime: 'a', Temperature: { Value: 1, Unit: 'C' } },
      { DateTime: 'b', Temperature: { Value: 2, Unit: 'C' } },
      { DateTime: 'c', Temperature: { Value: 3, Unit: 'C' } },
    ]),
    getDailyForecast: vi.fn().mockResolvedValue({
      DailyForecasts: [
        {
          Date: 'd',
          Temperature: { Minimum: { Value: 5, Unit: 'C' }, Maximum: { Value: 9, Unit: 'C' } },
        },
      ],
    }),
    ...overrides,
  }) as AccuWeatherService;
  return new WeatherProviderAdapter(accu);
}

describe('WeatherProviderAdapter', () => {
  it('exposes a provider with name and pluginId', () => {
    const provider = buildAdapter().toProvider();
    expect(provider.name).toBe('AccuWeather');
    expect(provider.methods.pluginId).toBe(PLUGIN.NAME);
  });

  it('maps point forecasts from the hourly endpoint', async () => {
    const provider = buildAdapter().toProvider();
    const result = await provider.methods.getForecasts(position, 'point');
    expect(result).toHaveLength(3);
    expect(result[0]?.type).toBe('point');
  });

  it('respects maxCount for point forecasts', async () => {
    const provider = buildAdapter().toProvider();
    const result = await provider.methods.getForecasts(position, 'point', { maxCount: 2 });
    expect(result).toHaveLength(2);
  });

  it('maps daily forecasts from the daily endpoint', async () => {
    const provider = buildAdapter().toProvider();
    const result = await provider.methods.getForecasts(position, 'daily');
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe('daily');
  });

  it('maps a single observation, honoring the requested position', async () => {
    const getCurrent = vi.fn().mockResolvedValue({
      LocalObservationDateTime: '2026-06-17T12:00:00+00:00',
      WeatherText: 'Sunny',
      Temperature: { Metric: { Value: 20, Unit: 'C' } },
      RelativeHumidity: 55,
      Pressure: { Metric: { Value: 1015, Unit: 'mb' } },
      PressureTendency: { Code: 'F' },
      Wind: { Speed: { Metric: { Value: 18, Unit: 'km/h' } }, Direction: { Degrees: 180 } },
    });
    const provider = buildAdapter({
      getCurrentConditionsForLocation: getCurrent,
    } as Partial<AccuWeatherService>).toProvider();

    const result = await provider.methods.getObservations(position);

    expect(getCurrent).toHaveBeenCalledWith({
      latitude: position.latitude,
      longitude: position.longitude,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe('observation');
    expect(result[0]?.date).toBe('2026-06-17T12:00:00+00:00');
    expect(result[0]?.description).toBe('Sunny');
    expect(result[0]?.outside?.temperature).toBeCloseTo(293.15, 2);
    expect(result[0]?.outside?.pressureTendency).toBe('decreasing');
    expect(result[0]?.wind?.speedTrue).toBeCloseTo(5, 2);
  });

  it('throws Not supported! for warnings', async () => {
    const provider = buildAdapter().toProvider();
    await expect(provider.methods.getWarnings(position)).rejects.toThrow('Not supported!');
  });
});
