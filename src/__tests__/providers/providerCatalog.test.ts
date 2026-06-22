import { describe, expect, it } from 'vitest';
import { WEATHER_PROVIDER_IDS } from '../../constants/notifications-shared.js';
import { PROVIDER_CATALOG } from '../../providers/providerCatalog.js';
import { sanitizeConfiguration } from '../../utils/validation.js';

const baseConfig = sanitizeConfiguration({
  weatherProvider: 'open-meteo',
  accuWeatherApiKey: 'test-key-1234567890ab',
  openMeteoBaseUrl: '',
  dailyApiQuota: 50,
});

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
