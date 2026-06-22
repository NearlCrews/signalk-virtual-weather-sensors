/**
 * Tests for shared notification constants and resolvers in notifications-shared.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEATHER_MODE,
  resolveWeatherMode,
  WEATHER_MODE_IDS,
} from '../../constants/notifications-shared.js';

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
