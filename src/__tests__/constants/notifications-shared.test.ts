/**
 * Tests for shared notification constants and resolvers in notifications-shared.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEATHER_MODE,
  providerRequiresApiKey,
  resolveMergeProviders,
  resolveWeatherMode,
  resolveWeatherProvider,
  WEATHER_MODE_IDS,
  WEATHER_PROVIDER_IDS,
  WEATHER_PROVIDER_LABELS,
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

describe('met-no provider registration', () => {
  it('is present in WEATHER_PROVIDER_IDS', () => {
    expect([...WEATHER_PROVIDER_IDS]).toContain('met-no');
  });
  it('has a truthy label in WEATHER_PROVIDER_LABELS', () => {
    expect(WEATHER_PROVIDER_LABELS['met-no']).toBeTruthy();
  });
  it('is keyless', () => {
    expect(providerRequiresApiKey('met-no')).toBe(false);
  });
  it('is resolved as met-no when explicitly set', () => {
    expect(resolveWeatherProvider('met-no', false)).toBe('met-no');
  });
});

describe('resolveMergeProviders', () => {
  it('returns an explicit valid ordered list as-is', () => {
    expect(resolveMergeProviders(['met-no', 'open-meteo'], 'open-meteo')).toEqual([
      'met-no',
      'open-meteo',
    ]);
  });
  it('filters out invalid ids', () => {
    expect(resolveMergeProviders(['open-meteo', 'bogus', 'met-no'], 'open-meteo')).toEqual([
      'open-meteo',
      'met-no',
    ]);
  });
  it('deduplicates entries, preserving first-seen order', () => {
    expect(resolveMergeProviders(['met-no', 'open-meteo', 'met-no'], 'open-meteo')).toEqual([
      'met-no',
      'open-meteo',
    ]);
  });
  it('falls back to [primary, ...rest] when the array is empty after filtering', () => {
    expect(resolveMergeProviders(['bogus', 'also-bogus'], 'open-meteo')).toEqual([
      'open-meteo',
      'accuweather',
      'met-no',
    ]);
  });
  it('falls back to [primary, ...rest] when not an array', () => {
    expect(resolveMergeProviders(undefined, 'met-no')).toEqual([
      'met-no',
      'open-meteo',
      'accuweather',
    ]);
    expect(resolveMergeProviders(null, 'open-meteo')).toEqual([
      'open-meteo',
      'accuweather',
      'met-no',
    ]);
    expect(resolveMergeProviders('open-meteo', 'open-meteo')).toEqual([
      'open-meteo',
      'accuweather',
      'met-no',
    ]);
  });
  it('puts the given primary first in the legacy fallback', () => {
    const result = resolveMergeProviders(undefined, 'accuweather');
    expect(result[0]).toBe('accuweather');
    expect(result).toContain('open-meteo');
    expect(result).toContain('met-no');
  });
  it('falls back to [primary, ...rest] when the array is empty', () => {
    expect(resolveMergeProviders([], 'open-meteo')).toEqual([
      'open-meteo',
      'accuweather',
      'met-no',
    ]);
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
