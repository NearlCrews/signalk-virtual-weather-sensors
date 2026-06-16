/**
 * Unit tests for the current-weather provider factory: it returns the provider
 * the config selects, with the right identity and source ref.
 */

import { describe, expect, it } from 'vitest';
import { createCurrentWeatherProvider } from '../../providers/createCurrentWeatherProvider.js';
import { sanitizeConfiguration } from '../../utils/validation.js';

describe('createCurrentWeatherProvider', () => {
  it('returns the Open-Meteo provider for a keyless config', () => {
    const config = sanitizeConfiguration({ weatherProvider: 'open-meteo' });
    const provider = createCurrentWeatherProvider(config);
    expect(provider.name).toBe('Open-Meteo');
    expect(provider.sourceRef).toBe('open-meteo');
    expect(provider.getRequestCountLast24h()).toBe(0);
  });

  it('returns the AccuWeather provider when AccuWeather is selected with a key', () => {
    const config = sanitizeConfiguration({
      weatherProvider: 'accuweather',
      accuWeatherApiKey: 'A1b2C3d4E5f6G7h8I9j0K1l2',
    });
    const provider = createCurrentWeatherProvider(config);
    expect(provider.name).toBe('AccuWeather');
    expect(provider.sourceRef).toBe('accuweather');
  });

  it('defaults a fresh install to Open-Meteo', () => {
    const provider = createCurrentWeatherProvider(sanitizeConfiguration({}));
    expect(provider.name).toBe('Open-Meteo');
  });
});
