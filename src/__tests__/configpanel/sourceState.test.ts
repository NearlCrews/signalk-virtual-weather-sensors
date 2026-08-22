import { describe, expect, it } from 'vitest';
import type { PanelFormState } from '../../configpanel/hooks/usePanelConfig.js';
import { deriveSourceState } from '../../configpanel/sourceState.js';
import { createMockConfig } from '../setup.js';

function mergedForm(accuWeatherApiKey: string): PanelFormState {
  return {
    ...createMockConfig({
      weatherProvider: 'open-meteo',
      weatherMode: 'merged',
      mergeProviders: ['open-meteo', 'accuweather'],
      accuWeatherApiKey,
    }),
  };
}

describe('deriveSourceState', () => {
  it('does not show AccuWeather quota controls when merged mode has no key', () => {
    const state = deriveSourceState(mergedForm(''));
    expect(state.accuWeatherInPlay).toBe(false);
    expect(state.showKeyField).toBe(true);
    expect(state.quotaSummary).toBe('keyless');
  });

  it('shows AccuWeather quota controls when merged mode has a key', () => {
    const state = deriveSourceState(mergedForm('A'.repeat(20)));
    expect(state.accuWeatherInPlay).toBe(true);
    expect(state.quotaSummary).toBe('quota 50/day');
  });

  it('offers the Open-Meteo base URL when the marine layer runs under another provider', () => {
    // The marine layer passes the same base URL to marine-api.open-meteo.com
    // whatever the atmospheric provider is, and utils/validation.ts validates it
    // on those terms, so the panel must not hide the only field that sets it.
    const state = deriveSourceState(
      createMockConfig({
        weatherProvider: 'met-no',
        weatherMode: 'single',
        marineData: true,
      })
    );
    expect(state.openMeteoActive).toBe(true);
  });

  it('hides the Open-Meteo base URL when no Open-Meteo host is fetched', () => {
    const state = deriveSourceState(
      createMockConfig({
        weatherProvider: 'met-no',
        weatherMode: 'single',
        marineData: false,
      })
    );
    expect(state.openMeteoActive).toBe(false);
  });
});
