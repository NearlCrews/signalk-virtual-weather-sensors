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

import type { WeatherData as SKWeatherData } from '@signalk/server-api';
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

  /** Maximum acceptable age of a current observation from this provider. */
  readonly maxObservationAgeMs?: number;

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

  /** True only when this provider cannot make a current request right now. */
  isCurrentWeatherFetchBlocked?(): boolean;
}

/** Forecast window a provider declares about itself, read by the v2 adapter. */
export interface ForecastCapabilities {
  /** Hours of hourly (point) forecast the provider serves. */
  readonly hourlyHours: number;
  /** Days of daily forecast the provider serves. */
  readonly dailyDays: number;
}

/**
 * A provider that can serve a single current observation in the Signal K v2
 * envelope, in addition to the live emission path. Open-Meteo and AccuWeather
 * both implement this; a minimal source might implement only the base tier.
 */
export interface ObservationCapableProvider extends CurrentWeatherProvider {
  /** Current conditions at an arbitrary position, in the SK v2 WeatherData shape. */
  getObservation(location: GeoLocation): Promise<SKWeatherData>;
}

/**
 * A provider that additionally serves point (hourly) and daily forecasts in the
 * SK v2 envelope, and declares its own forecast horizon. Forecast arrays are
 * ascending by date, per the v2 contract.
 */
export interface ForecastCapableProvider extends ObservationCapableProvider {
  readonly forecastCapabilities: ForecastCapabilities;
  getHourlyForecast(location: GeoLocation): Promise<SKWeatherData[]>;
  getDailyForecast(location: GeoLocation): Promise<SKWeatherData[]>;
}

/** Narrow a base provider to one that can serve a v2 observation. */
export function supportsObservations(
  provider: CurrentWeatherProvider
): provider is ObservationCapableProvider {
  return typeof (provider as ObservationCapableProvider).getObservation === 'function';
}

/** Narrow a base provider to one that can serve v2 forecasts. */
export function supportsForecasts(
  provider: CurrentWeatherProvider
): provider is ForecastCapableProvider {
  const p = provider as ForecastCapableProvider;
  return (
    typeof p.getHourlyForecast === 'function' &&
    typeof p.getDailyForecast === 'function' &&
    typeof p.getObservation === 'function' &&
    typeof p.forecastCapabilities === 'object' &&
    p.forecastCapabilities !== null
  );
}
