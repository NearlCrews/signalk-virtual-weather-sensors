/**
 * Provider seam for the current-conditions emission path.
 *
 * `WeatherService` and the plugin entry depend on this interface rather than a
 * concrete service, so a second source (Open-Meteo) can be dropped in without
 * touching the orchestration. The boundary is the internal SI `WeatherData`
 * type: each provider's transform produces it, and everything downstream
 * (mapper, notifier, PGN bridge) is already provider-agnostic over it.
 *
 * Quota accessors are part of the contract because the status banner reports
 * them. A keyless provider (Open-Meteo) implements them as constant zero: it
 * has no per-key daily cap, so there is no rolling window to surface.
 */

import type { GeoLocation, WeatherData } from '../types/index.js';

export interface CurrentWeatherProvider {
  /**
   * Human-facing provider name, surfaced in logs and the v2 Weather API
   * provider registration (for example `AccuWeather`, `Open-Meteo`).
   */
  readonly name: string;
  /**
   * Signal K `$source` reference stamped on every delta this provider's data
   * produces, so operators can set source priorities to prefer a real onboard
   * sensor or a specific weather source. Stable per provider.
   */
  readonly sourceRef: string;

  /** Fetch and transform current conditions for a position into SI `WeatherData`. */
  fetchCurrentWeather(location: GeoLocation): Promise<WeatherData>;

  /**
   * Cumulative upstream request count since construction. Zero for a keyless
   * provider that does not meter requests.
   */
  getRequestCount(): number;

  /**
   * Upstream request count in the rolling last 24 hours, used by the quota
   * banner. Zero for a keyless provider with no daily cap.
   */
  getRequestCountLast24h(): number;

  /** Location-cache size, for the status panel. Zero-sized for cacheless providers. */
  getCacheStats(): { size: number };
}
