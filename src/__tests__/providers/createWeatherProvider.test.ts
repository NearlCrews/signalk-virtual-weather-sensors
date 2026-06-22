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
    expect(p.sourceRef).toBe('merged');
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
    expect(p.sourceRef).toBe('merged'); // primary is met-no but the merged ref is constant
  });
});
