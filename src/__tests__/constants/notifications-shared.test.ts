/**
 * Tests for shared notification constants and resolvers in notifications-shared.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEATHER_MODE,
  providerRequiresApiKey,
  resolveWeatherMode,
  resolveWeatherProvider,
  WEATHER_MODE_IDS,
  WEATHER_PROVIDER_IDS,
} from '../../constants/notifications-shared.js';

describe('resolveWeatherProvider honors the id list', () => {
  it('accepts every known id, not just a hardcoded pair', () => {
    for (const id of WEATHER_PROVIDER_IDS) {
      expect(resolveWeatherProvider(id, false)).toBe(id);
    }
  });
  it('falls back by key presence for an unknown explicit value', () => {
    expect(resolveWeatherProvider('bogus', true)).toBe('accuweather');
    expect(resolveWeatherProvider(undefined, false)).toBe('open-meteo');
  });
});

describe('providerRequiresApiKey', () => {
  it('marks accuweather keyed and open-meteo keyless', () => {
    expect(providerRequiresApiKey('accuweather')).toBe(true);
    expect(providerRequiresApiKey('open-meteo')).toBe(false);
  });
});

describe('resolveWeatherMode', () => {
  it('defaults to single for missing or unknown values', () => {
    expect(resolveWeatherMode(undefined)).toBe('single');
    expect(resolveWeatherMode('bogus')).toBe('single');
    expect(DEFAULT_WEATHER_MODE).toBe('single');
  });
  it('honors an explicit valid mode', () => {
    expect(resolveWeatherMode('merged')).toBe('merged');
    expect(resolveWeatherMode('single')).toBe('single');
  });
  it('lists both modes', () => {
    expect([...WEATHER_MODE_IDS]).toEqual(['single', 'merged']);
  });
});
