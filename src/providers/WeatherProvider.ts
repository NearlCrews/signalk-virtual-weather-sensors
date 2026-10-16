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
 * them. A keyless provider (Open-Meteo, Met.no) reports a zero rolling window
 * and declares no `dailyQuota`, so the banner shows no quota for it.
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

  /**
   * Daily request cap this provider enforces on itself, or absent for a keyless
   * source with none. The status banner shows `K/Q today`, the quota warning,
   * and the quota pause only against a declared cap.
   */
  readonly dailyQuota?: number | undefined;

  /**
   * True for a provider that authenticates with an operator-supplied API key.
   * A 401 from it means the key is wrong, which no retry can fix, so the
   * service stops fetching until the configuration changes. Absent for keyless
   * providers (a 401 there comes from something else, such as an
   * authenticating proxy in front of a self-hosted instance) and for the
   * merging provider (a rejected child leaves the blend running on its siblings).
   */
  readonly usesApiKey?: boolean;

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

  /** True only when this provider cannot make a current request right now. */
  isCurrentWeatherFetchBlocked?(): boolean;

  /**
   * Names of the children that cannot make a current request right now, for a
   * provider that fans out to several. Implemented only by the merging
   * provider; a single provider reports its whole state through
   * `isCurrentWeatherFetchBlocked`. Lets the status banner say which source
   * dropped out of a blend that is still producing values.
   */
  getBlockedChildNames?(): string[];
}

/** Forecast window a provider declares about itself, read by the v2 adapter. */
export interface ForecastCapabilities {
  /** Hours of hourly (point) forecast the provider serves. */
  readonly hourlyHours: number;
  /** Days of daily forecast the provider serves. */
  readonly dailyDays: number;
}

/**
 * A provider that additionally serves a current observation, point (hourly)
 * forecasts, and daily forecasts in the SK v2 envelope, and declares its own
 * forecast horizon. Forecast arrays are ascending by date, per the v2 contract.
 */
export interface ForecastCapableProvider extends CurrentWeatherProvider {
  readonly forecastCapabilities: ForecastCapabilities;
  /** Current conditions at an arbitrary position, in the SK v2 WeatherData shape. */
  getObservation(location: GeoLocation): Promise<SKWeatherData>;
  getHourlyForecast(location: GeoLocation): Promise<SKWeatherData[]>;
  getDailyForecast(location: GeoLocation): Promise<SKWeatherData[]>;
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
