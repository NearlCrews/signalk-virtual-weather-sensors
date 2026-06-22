/**
 * Met.no `symbol_code` to provider-agnostic `SevereCondition`, the Met.no analog
 * of open-meteo-severity and accuweather-severity. Only marine-relevant severe
 * weather maps: thunder, snow, and sleet (an icing hazard). Benign sky states,
 * fog, and plain liquid precipitation return undefined because those hazards are
 * surfaced through the dedicated wind, visibility, and temperature bands.
 *
 * No `alarm`: open-meteo-severity escalates hail-bearing codes (WMO 96, 99) to
 * alarm, but Met.no has no hail-specific symbol_code, so all thunder is `warn`.
 * `andthunder` is checked first so a combined code (e.g. snowandthunder) maps to
 * Thunderstorms, the dominant hazard, not Snow or Sleet. The
 * `_day`/`_night`/`_polartwilight` suffix is daylight-cosmetic and is stripped.
 */
import type { SevereCondition } from '../types/index.js';

export function metNoSevereCondition(symbolCode: string | undefined): SevereCondition | undefined {
  if (typeof symbolCode !== 'string') return undefined;
  const base = symbolCode.replace(/_(day|night|polartwilight)$/, '');
  if (base.includes('andthunder')) return { state: 'warn', label: 'Thunderstorms' };
  if (base.includes('snow')) return { state: 'warn', label: 'Snow' };
  if (base.includes('sleet')) return { state: 'warn', label: 'Sleet' };
  return undefined;
}
