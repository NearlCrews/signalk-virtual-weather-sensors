/**
 * Unit tests for the AccuWeather WeatherIcon to SevereCondition mapping.
 *
 * This is the provider-specific encoding that the transform applies so the
 * notifier never sees a raw AccuWeather icon code. The notifier's own tests
 * cover what it does with the resulting SevereCondition.
 */

import { describe, expect, it } from 'vitest';
import { accuWeatherSevereCondition } from '../../providers/accuweather-severity.js';

describe('accuWeatherSevereCondition', () => {
  it('maps thunderstorm icons (15, 16, 17, 41, 42) to warn/Thunderstorms', () => {
    for (const icon of [15, 16, 17, 41, 42]) {
      expect(accuWeatherSevereCondition(icon)).toEqual({
        state: 'warn',
        label: 'Thunderstorms',
      });
    }
  });

  it('maps ice (24) to alarm/Ice', () => {
    expect(accuWeatherSevereCondition(24)).toEqual({ state: 'alarm', label: 'Ice' });
  });

  it('maps snow icons (22, 23, 43, 44) to warn/Snow', () => {
    for (const icon of [22, 23, 43, 44]) {
      expect(accuWeatherSevereCondition(icon)).toEqual({ state: 'warn', label: 'Snow' });
    }
  });

  it('maps freezing rain (26) to warn/Freezing rain', () => {
    expect(accuWeatherSevereCondition(26)).toEqual({ state: 'warn', label: 'Freezing rain' });
  });

  it('returns undefined for benign, out-of-range, and missing codes', () => {
    for (const icon of [1, 10, 0, 100, -1, Number.NaN]) {
      expect(accuWeatherSevereCondition(icon)).toBeUndefined();
    }
    expect(accuWeatherSevereCondition(undefined)).toBeUndefined();
  });
});
