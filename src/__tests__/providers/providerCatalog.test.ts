import { describe, expect, it } from 'vitest';
import { WEATHER_PROVIDER_IDS } from '../../constants/notifications-shared.js';
import { PROVIDER_CATALOG } from '../../providers/providerCatalog.js';
import type { PluginConfiguration } from '../../types/index.js';

const baseConfig = {
  weatherProvider: 'open-meteo',
  weatherMode: 'single',
  accuWeatherApiKey: 'test-key-1234567890ab',
  openMeteoBaseUrl: '',
  marineData: false,
  updateFrequency: 30,
  emissionInterval: 5,
  dailyApiQuota: 50,
  notifications: {
    enabled: false,
    wind: true,
    visibility: true,
    heat: true,
    cold: true,
    weather: true,
  },
} as PluginConfiguration;

describe('PROVIDER_CATALOG', () => {
  it('has an entry for every provider id', () => {
    for (const id of WEATHER_PROVIDER_IDS) {
      expect(PROVIDER_CATALOG[id]).toBeDefined();
    }
  });
  it('constructs each provider with the expected sourceRef', () => {
    expect(PROVIDER_CATALOG['open-meteo'].construct(baseConfig, () => {}).sourceRef).toBe(
      'open-meteo'
    );
    expect(PROVIDER_CATALOG.accuweather.construct(baseConfig, () => {}).sourceRef).toBe(
      'accuweather'
    );
  });
  it('marks open-meteo keyless and accuweather keyed', () => {
    expect(PROVIDER_CATALOG['open-meteo'].keyless).toBe(true);
    expect(PROVIDER_CATALOG.accuweather.keyless).toBe(false);
  });
});
