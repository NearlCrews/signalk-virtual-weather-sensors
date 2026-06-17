/**
 * Unit tests for the Open-Meteo WMO weather-code to SevereCondition mapping.
 *
 * Mirrors the AccuWeather severity philosophy: only marine-relevant severe
 * conditions map; benign sky states, fog, and plain liquid precipitation
 * return undefined because those hazards are surfaced through the dedicated
 * visibility, temperature, and wind-band notifications.
 */

import { describe, expect, it } from 'vitest';
import { openMeteoSevereCondition } from '../../providers/open-meteo-severity.js';

describe('openMeteoSevereCondition', () => {
  it('maps a plain thunderstorm (95) to warn/Thunderstorms', () => {
    expect(openMeteoSevereCondition(95)).toEqual({ state: 'warn', label: 'Thunderstorms' });
  });

  it('escalates thunderstorm with hail (96, 99) to alarm', () => {
    for (const code of [96, 99]) {
      expect(openMeteoSevereCondition(code)).toEqual({ state: 'alarm', label: 'Thunderstorms' });
    }
  });

  it('maps snowfall and snow showers (71, 73, 75, 77, 85, 86) to warn/Snow', () => {
    for (const code of [71, 73, 75, 77, 85, 86]) {
      expect(openMeteoSevereCondition(code)).toEqual({ state: 'warn', label: 'Snow' });
    }
  });

  it('maps freezing rain (66, 67) to warn/Freezing rain', () => {
    for (const code of [66, 67]) {
      expect(openMeteoSevereCondition(code)).toEqual({ state: 'warn', label: 'Freezing rain' });
    }
  });

  it('maps freezing drizzle (56, 57) to warn/Freezing drizzle', () => {
    for (const code of [56, 57]) {
      expect(openMeteoSevereCondition(code)).toEqual({ state: 'warn', label: 'Freezing drizzle' });
    }
  });

  it('returns undefined for clear, cloud, fog, plain rain, and missing codes', () => {
    // 0..3 sky states, 45/48 fog, 51..55 drizzle, 61..65 rain, 80..82 rain showers.
    for (const code of [
      0,
      1,
      2,
      3,
      45,
      48,
      51,
      53,
      55,
      61,
      63,
      65,
      80,
      81,
      82,
      100,
      -1,
      Number.NaN,
    ]) {
      expect(openMeteoSevereCondition(code)).toBeUndefined();
    }
    expect(openMeteoSevereCondition(undefined)).toBeUndefined();
  });
});
