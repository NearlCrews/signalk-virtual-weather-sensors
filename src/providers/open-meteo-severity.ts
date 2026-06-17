/**
 * Open-Meteo WMO weather-code (WW) to provider-agnostic `SevereCondition`
 * mapping, the Open-Meteo analog of `accuweather-severity`.
 *
 * Mirrors the AccuWeather mapping philosophy so the severe-condition band
 * behaves the same regardless of source: only marine-relevant severe weather
 * maps. Benign sky states (0..3), fog (45, 48), and plain liquid precipitation
 * (drizzle 51..55, rain 61..65, rain showers 80..82) return undefined because
 * those hazards are already surfaced through the dedicated visibility,
 * temperature, and wind-band notifications. Snow and icing precipitation match
 * AccuWeather's `warn`; a thunderstorm with hail escalates to `alarm`, matching
 * how AccuWeather treats ice.
 *
 * WMO code table 4677 (as used by Open-Meteo): https://open-meteo.com/en/docs
 */

import type { SevereCondition } from '../types/index.js';

const WMO_CODE_SEVERITY: ReadonlyMap<number, SevereCondition> = new Map([
  // Freezing drizzle: an icing hazard, same operator action as freezing rain.
  [56, { state: 'warn', label: 'Freezing drizzle' }],
  [57, { state: 'warn', label: 'Freezing drizzle' }],
  // Freezing rain: matches AccuWeather code 26 (warn).
  [66, { state: 'warn', label: 'Freezing rain' }],
  [67, { state: 'warn', label: 'Freezing rain' }],
  // Snowfall and snow grains.
  [71, { state: 'warn', label: 'Snow' }],
  [73, { state: 'warn', label: 'Snow' }],
  [75, { state: 'warn', label: 'Snow' }],
  [77, { state: 'warn', label: 'Snow' }],
  // Snow showers.
  [85, { state: 'warn', label: 'Snow' }],
  [86, { state: 'warn', label: 'Snow' }],
  // Thunderstorm without hail: matches AccuWeather thunderstorms (warn).
  [95, { state: 'warn', label: 'Thunderstorms' }],
  // Thunderstorm with hail: escalated to alarm, as AccuWeather treats ice.
  [96, { state: 'alarm', label: 'Thunderstorms' }],
  [99, { state: 'alarm', label: 'Thunderstorms' }],
]);

/**
 * Classify an Open-Meteo WMO weather code into a provider-agnostic
 * `SevereCondition`, or `undefined` when the code is benign, out of range,
 * missing, or `NaN` (`Map.get(NaN)` is `undefined`).
 */
export function openMeteoSevereCondition(code: number | undefined): SevereCondition | undefined {
  return code === undefined ? undefined : WMO_CODE_SEVERITY.get(code);
}
