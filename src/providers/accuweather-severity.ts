/**
 * AccuWeather `WeatherIcon` to provider-agnostic `SevereCondition` mapping.
 *
 * Lives with the AccuWeather provider, not the notifier: it is the one piece
 * of AccuWeather-specific decoding the severe-condition band needs, so keeping
 * it here lets the notifier consume the normalized `SevereCondition` and stay
 * provider-neutral. Each weather provider supplies its own equivalent mapping.
 *
 * Only codes that warrant a marine-relevant alert appear here; codes 1..10
 * (sunny/cloudy variants), the fog/wind/hot/cold codes 30..32, and the
 * clear/cloudy night variants 33..40 are absent because those hazards are
 * surfaced through the dedicated visibility, temperature, and wind-band
 * notifications. Liquid precipitation without thunder (codes 12..14, 18) is
 * surfaced through the visibility-low band's rain-rate suffix, not as a
 * standalone severe-weather alert.
 *
 * AccuWeather icon catalogue: https://developer.accuweather.com/weather-icons
 */

import type { SevereCondition } from '../types/index.js';

const WEATHER_ICON_SEVERITY: ReadonlyMap<number, SevereCondition> = new Map([
  [15, { state: 'warn', label: 'Thunderstorms' }],
  [16, { state: 'warn', label: 'Thunderstorms' }],
  [17, { state: 'warn', label: 'Thunderstorms' }],
  // Flurries (mild snow showers). Same operator action as full Snow at code 22.
  [19, { state: 'warn', label: 'Flurries' }],
  [20, { state: 'warn', label: 'Flurries' }],
  [21, { state: 'warn', label: 'Flurries' }],
  [22, { state: 'warn', label: 'Snow' }],
  [23, { state: 'warn', label: 'Snow' }],
  [24, { state: 'alarm', label: 'Ice' }],
  [25, { state: 'warn', label: 'Sleet' }],
  [26, { state: 'warn', label: 'Freezing rain' }],
  [29, { state: 'warn', label: 'Rain and snow' }],
  [41, { state: 'warn', label: 'Thunderstorms' }],
  [42, { state: 'warn', label: 'Thunderstorms' }],
  [43, { state: 'warn', label: 'Snow' }],
  [44, { state: 'warn', label: 'Snow' }],
]);

/**
 * Classify an AccuWeather icon code into a provider-agnostic `SevereCondition`,
 * or `undefined` when the code is benign, out of range, missing, or `NaN`
 * (`Map.get(NaN)` is `undefined`, so non-mapped numerics fall through cleanly).
 */
export function accuWeatherSevereCondition(icon: number | undefined): SevereCondition | undefined {
  return icon === undefined ? undefined : WEATHER_ICON_SEVERITY.get(icon);
}
