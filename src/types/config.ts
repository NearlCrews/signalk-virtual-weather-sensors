/**
 * Plugin configuration types for signalk-virtual-weather-sensors.
 */

import type { WeatherMode, WeatherProviderId } from '../constants/notifications-shared.js';

/**
 * Severe-weather notification controls. Master `enabled` is off by default so
 * the plugin preserves its measurement-only behavior on upgrade; flipping
 * `enabled` activates each per-category sub-toggle individually so operators
 * can suppress a category (e.g. wind alerts while at anchor) without losing
 * the others.
 */
export interface NotificationsConfig {
  /** Master switch: when false, no `notifications.environment.*` deltas are emitted. */
  readonly enabled: boolean;
  /** Beaufort gale/storm/hurricane bands on `notifications.environment.wind.*`. */
  readonly wind: boolean;
  /** Low / very-low visibility on `notifications.environment.visibility.*`. */
  readonly visibility: boolean;
  /** Heat-stress-index bands on `notifications.environment.heat.*`. */
  readonly heat: boolean;
  /** Wind-chill bands on `notifications.environment.cold.*`. */
  readonly cold: boolean;
  /** Severe-condition codes (thunderstorm/ice/freezing rain) on `notifications.environment.weather.severe`. */
  readonly weather: boolean;
}

/**
 * Runtime plugin configuration, validated and normalized by
 * `ConfigurationValidator` in `utils/validation.ts`.
 */
export interface PluginConfiguration {
  /**
   * Selected weather source. New installs default to `open-meteo` (keyless);
   * an existing AccuWeather install is preserved on upgrade. See
   * `resolveWeatherProvider`.
   */
  readonly weatherProvider: WeatherProviderId;

  /**
   * How configured providers are combined. `single` (default) uses one source;
   * `merged` blends every available provider into synthetic values. See
   * `resolveWeatherMode`.
   */
  readonly weatherMode: WeatherMode;

  /**
   * AccuWeather API key. Empty string when using a keyless provider
   * (`open-meteo`); required when single mode selects `accuweather`, and
   * optional in merged mode where it controls whether AccuWeather participates.
   */
  readonly accuWeatherApiKey: string;

  /**
   * Open-Meteo host override (empty string uses the default public host). Lets
   * a commercial user point at a self-hosted or paid Open-Meteo instance, since
   * the free public service is non-commercial.
   */
  readonly openMeteoBaseUrl: string;

  /**
   * Emit the optional sea-state layer (waves, swell, sea surface temperature,
   * surface current) from the keyless Open-Meteo Marine API. Off by default; it
   * is a separate fetch and only meaningful for coastal and offshore vessels.
   */
  readonly marineData: boolean;

  /** Weather data update frequency in minutes (default: 30; see CONFIG_DEFAULTS). */
  readonly updateFrequency: number;

  /** NMEA2000 emission interval in seconds (default: 5; see CONFIG_DEFAULTS). */
  readonly emissionInterval: number;

  /**
   * Daily AccuWeather API call cap (rolling 24 hours). The default of 50 fits
   * the default 30-minute cadence for a stationary vessel (at most 48
   * conditions calls plus one location lookup per day); operators on a paid
   * plan raise it to their allowance. It applies whenever AccuWeather
   * participates, including merged mode. Set to 0 to disable the cap (no quota
   * tracking, no warnings, no auto-pause).
   */
  readonly dailyApiQuota: number;

  /** Severe-weather notification settings (opt-in, off by default). */
  readonly notifications: NotificationsConfig;

  /**
   * Ordered provider ids included in merge mode; the first is the primary: it
   * sets the categorical-field picks, the tie-breaks, and the forecast source.
   * Resolved by `resolveMergeProviders`. Ignored in single mode.
   */
  readonly mergeProviders: ReadonlyArray<WeatherProviderId>;
}
