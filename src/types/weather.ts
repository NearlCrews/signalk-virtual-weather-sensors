/**
 * Core weather data types for signalk-virtual-weather-sensors.
 * These are provider-agnostic SI-unit types used throughout the plugin.
 */

import type { NotificationState } from './plugin.js';

/**
 * Comprehensive weather data structure with all measurements in SI units
 * Enhanced to include all AccuWeather API fields for maximum NMEA2000 coverage
 */
export interface WeatherData {
  // Core measurements (existing)
  /** Temperature in Kelvin (SI base unit) */
  readonly temperature: number;
  /** Atmospheric pressure in Pascals (SI base unit) */
  readonly pressure: number;
  /** Relative humidity as ratio (0-1) per Signal K spec */
  readonly humidity: number;
  /** Wind speed in meters per second (SI unit) */
  readonly windSpeed: number;
  /** Wind direction in radians (SI unit, 0 = North, π/2 = East) */
  readonly windDirection: number;
  /** Dew point temperature in Kelvin */
  readonly dewPoint: number;
  /**
   * Theoretical wind chill temperature in Kelvin: computed from air temperature
   * and the true (ground-referenced) wind. Emitted on the canonical
   * `environment.outside.theoreticalWindChillTemperature` leaf.
   */
  readonly windChill: number;
  /** Heat index temperature in Kelvin (computed NWS Rothfusz, not AccuWeather RealFeel) */
  readonly heatIndex: number;

  // Enhanced temperature readings (new from AccuWeather)
  /** AccuWeather RealFeel apparent temperature (includes solar load) in Kelvin */
  readonly realFeel?: number;
  /** RealFeel temperature in shade in Kelvin */
  readonly realFeelShade?: number;
  /** Wet bulb temperature in Kelvin */
  readonly wetBulbTemperature?: number;
  /** Wet bulb globe temperature in Kelvin (heat stress index) */
  readonly wetBulbGlobeTemperature?: number;
  /** Apparent temperature in Kelvin (different from RealFeel) */
  readonly apparentTemperature?: number;

  // Enhanced wind data (new from AccuWeather)
  /** Wind gust speed in m/s */
  readonly windGustSpeed?: number;
  /** Calculated wind gust factor (gust/sustained ratio) */
  readonly windGustFactor?: number;

  // Atmospheric conditions (new from AccuWeather)
  /** UV Index value (0-11+) */
  readonly uvIndex?: number;
  /** Visibility in meters */
  readonly visibility?: number;
  /** Cloud cover percentage as ratio (0-1) */
  readonly cloudCover?: number;
  /** Cloud ceiling height in meters */
  readonly cloudCeiling?: number;

  // Precipitation data (new from AccuWeather)
  /** Liquid-equivalent precipitation accumulated over the past hour, in mm */
  readonly precipitationLastHour?: number;

  // Temperature trends (new from AccuWeather)
  /** 24-hour temperature departure in Kelvin */
  readonly temperatureDeparture24h?: number;

  // Calculated apparent wind (existing)
  /** Calculated apparent wind speed in m/s (includes vessel motion) */
  readonly apparentWindSpeed?: number;
  /** Calculated apparent wind angle in radians (relative to vessel heading) */
  readonly apparentWindAngle?: number;
  /**
   * Apparent wind chill temperature in Kelvin: wind chill computed from the
   * apparent wind (true wind plus vessel motion). Present only when vessel
   * navigation data allows the apparent wind to be derived.
   */
  readonly apparentWindChill?: number;

  // Metadata
  /** Human-readable weather description (e.g. "Partly cloudy"). */
  readonly description?: string;
  /**
   * AccuWeather icon code (1..44). Retained as provider provenance; the
   * notifier no longer reads it (see `severeCondition`). Open-Meteo and other
   * providers leave it unset.
   */
  readonly weatherIcon?: number;
  /**
   * Provider-agnostic severe-condition classification, set by each provider's
   * transform from its own condition encoding (AccuWeather icon code,
   * Open-Meteo WMO weather code). The notifier's severe band consumes this so
   * it never has to know a provider-specific code. Absent when the current
   * condition is benign.
   */
  readonly severeCondition?: SevereCondition;
  /** ISO 8601 timestamp of measurement */
  readonly timestamp: string;

  // Calculated synthetic values (new)
  /** Beaufort scale (0-12) derived from sustained wind speed */
  readonly beaufortScale?: number;
  /** Enhanced air density in kg/m³ (includes elevation if available) */
  readonly airDensityEnhanced?: number;
  /** Absolute humidity in kg/m³ */
  readonly absoluteHumidity?: number;
  /** Heat stress index from wet bulb globe temperature */
  readonly heatStressIndex?: number;

  // Condition detail (new from AccuWeather)
  /** Barometric tendency: -1 falling, 0 steady, +1 rising. */
  readonly pressureTendency?: number;
  /** Precipitation type (e.g. "Rain", "Snow", "Ice", "Mixed"). */
  readonly precipitationType?: string;
  /** Obstruction reducing visibility (e.g. "Fog", "Haze", "Smoke"). */
  readonly visibilityObstruction?: string;
}

/**
 * Provider-agnostic severe-condition classification carried on `WeatherData`.
 * `state` is the notification severity the severe band should raise; `label`
 * is the human-readable lead-in for the notification message (e.g.
 * `Thunderstorms`). Each provider's transform produces this from its own
 * condition encoding so the notifier stays provider-neutral.
 */
export interface SevereCondition {
  readonly state: NotificationState;
  readonly label: string;
}

/**
 * Sea-state data in SI units, sourced from Open-Meteo Marine independently of
 * the atmospheric provider. All fields are optional: the marine model has no
 * data for inland points, and a partial response carries only what is present.
 * Directions follow the plugin's conventions: wave and swell directions are the
 * direction the waves come FROM (true, like wind); the surface-current direction
 * is the set (the direction the current flows TOWARD, true), matching the Signal
 * K `environment.current.setTrue` semantics.
 */
export interface MarineData {
  /** ISO 8601 timestamp of the marine reading. */
  readonly timestamp: string;
  /** Significant wave height in meters. */
  readonly significantWaveHeight?: number;
  /** Mean wave direction (from) in radians, true. */
  readonly waveDirection?: number;
  /** Mean wave period in seconds. */
  readonly wavePeriod?: number;
  /** Wind-wave (locally generated) height in meters. */
  readonly windWaveHeight?: number;
  /** Swell height in meters. */
  readonly swellHeight?: number;
  /** Swell direction (from) in radians, true. */
  readonly swellDirection?: number;
  /** Swell period in seconds. */
  readonly swellPeriod?: number;
  /** Sea surface temperature in Kelvin. */
  readonly seaSurfaceTemperature?: number;
  /** Surface current speed (drift) in m/s. */
  readonly surfaceCurrentSpeed?: number;
  /** Surface current set (direction flowing toward) in radians, true. */
  readonly surfaceCurrentDirection?: number;
}

/**
 * Wind calculation result with validation
 */
export interface WindCalculationResult {
  readonly apparentWindSpeed: number;
  readonly apparentWindAngle: number;
  readonly isValid: boolean;
  readonly validationErrors?: ReadonlyArray<string>;
}
