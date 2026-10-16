import { describe, expect, it } from 'vitest';
import {
  type CurrentWeatherProvider,
  type ForecastCapableProvider,
  supportsForecasts,
} from '../../providers/WeatherProvider.js';
import type { GeoLocation, WeatherData } from '../../types/index.js';

const currentOnly: CurrentWeatherProvider = {
  name: 'Current Only',
  sourceRef: 'current-only',
  fetchCurrentWeather: async (_l: GeoLocation): Promise<WeatherData> => {
    throw new Error('unused');
  },
  getRequestCount: () => 0,
  getRequestCountLast24h: () => 0,
};

const full: ForecastCapableProvider = {
  ...currentOnly,
  name: 'Full',
  sourceRef: 'full',
  forecastCapabilities: { hourlyHours: 12, dailyDays: 5 },
  getObservation: async () => ({}) as never,
  getHourlyForecast: async () => [],
  getDailyForecast: async () => [],
};

describe('provider capability guards', () => {
  it('supportsForecasts is false for a current-only provider', () => {
    expect(supportsForecasts(currentOnly)).toBe(false);
  });
  it('supportsForecasts is true for a full provider', () => {
    expect(supportsForecasts(full)).toBe(true);
  });
  it('supportsForecasts is false when only getObservation is present', () => {
    const obsOnly = { ...currentOnly, getObservation: async () => ({}) as never };
    expect(supportsForecasts(obsOnly)).toBe(false);
  });
});
