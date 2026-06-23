/**
 * Unit tests for the weatherMode-aware provider factory: single mode returns
 * the catalog provider directly, merged mode returns a forecast-capable
 * MergingWeatherProvider over all available providers.
 */
import { describe, expect, it } from 'vitest';
import { createWeatherProvider } from '../../providers/createWeatherProvider.js';
import { supportsForecasts } from '../../providers/WeatherProvider.js';
import { sanitizeConfiguration } from '../../utils/validation.js';

describe('createWeatherProvider', () => {
  it('returns a single provider in single mode', () => {
    const p = createWeatherProvider(
      sanitizeConfiguration({ weatherProvider: 'open-meteo', weatherMode: 'single' }),
      () => {}
    );
    expect(p.sourceRef).toBe('open-meteo');
  });
  it('returns a forecast-capable merged provider in merged mode with two keyless providers available', () => {
    // Open-Meteo and Met.no are always available, so merged mode always has two.
    const p = createWeatherProvider(
      sanitizeConfiguration({ weatherProvider: 'open-meteo', weatherMode: 'merged' }),
      () => {}
    );
    expect(p.sourceRef).toBe('vws-merged');
    expect(p.name).toContain('merged');
    // The merged provider must be forecast-capable (delegating to a child) so the
    // v2 adapter registers in merged mode; a regression that loses this fails here.
    expect(supportsForecasts(p)).toBe(true);
  });
  it('uses the configured provider as the merged primary (priority first)', () => {
    const p = createWeatherProvider(
      sanitizeConfiguration({ weatherProvider: 'met-no', weatherMode: 'merged' }),
      () => {}
    );
    expect(p.sourceRef).toBe('vws-merged'); // primary is met-no but the merged ref is constant
  });
  it('excludes an unavailable primary (accuweather without a key) from the merged order', () => {
    const p = createWeatherProvider(
      sanitizeConfiguration({ weatherProvider: 'accuweather', weatherMode: 'merged' }),
      () => {}
    );
    expect(p.sourceRef).toBe('vws-merged');
    expect(supportsForecasts(p)).toBe(true);
  });
  it('honors an explicit mergeProviders order in merged mode', () => {
    const p = createWeatherProvider(
      sanitizeConfiguration({
        weatherProvider: 'open-meteo',
        weatherMode: 'merged',
        mergeProviders: ['met-no', 'open-meteo'],
      }),
      () => {}
    );
    expect(p.sourceRef).toBe('vws-merged');
    expect(supportsForecasts(p)).toBe(true);
  });
  it('degrades to single when mergeProviders selects only one available provider', () => {
    // Only one keyless provider is reachable when mergeProviders contains a
    // single valid id that is available.
    const p = createWeatherProvider(
      sanitizeConfiguration({
        weatherProvider: 'open-meteo',
        weatherMode: 'merged',
        mergeProviders: ['open-meteo'],
      }),
      () => {}
    );
    // Single-source degrade: the returned provider is not the merged wrapper.
    expect(p.sourceRef).not.toBe('vws-merged');
  });
  it('excludes accuweather from mergeProviders selection when no key is configured', () => {
    // mergeProviders explicitly lists accuweather, but no key: should merge
    // only the keyless providers.
    const p = createWeatherProvider(
      sanitizeConfiguration({
        weatherProvider: 'open-meteo',
        weatherMode: 'merged',
        mergeProviders: ['accuweather', 'open-meteo', 'met-no'],
      }),
      () => {}
    );
    expect(p.sourceRef).toBe('vws-merged');
    expect(supportsForecasts(p)).toBe(true);
  });
});
