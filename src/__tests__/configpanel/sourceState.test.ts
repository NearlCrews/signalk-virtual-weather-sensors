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
});
