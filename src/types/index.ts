/**
 * Core TypeScript type definitions for signalk-virtual-weather-sensors plugin
 * Provides comprehensive type safety for AccuWeather API integration and NMEA2000 data
 */

// ===============================
// Weather Data Types
// ===============================

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
  /** Precipitation in last hour in mm */
  readonly precipitationLastHour?: number;
  /** Current precipitation rate in mm/h */
  readonly precipitationCurrent?: number;

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
   * navigation data allows the apparent wind to be derived; the mapper falls
   * back to `windChill` for the apparent-wind-chill leaf when it is absent.
   */
  readonly apparentWindChill?: number;

  // Metadata
  /** Human-readable weather description (e.g. "Partly cloudy"). */
  readonly description?: string;
  /**
   * AccuWeather icon code (1..44) used by the notification state machine to
   * detect severe-condition categories. Stored on WeatherData so downstream
   * notifiers do not have to re-parse the original API response.
   */
  readonly weatherIcon?: number;
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
 * Vessel navigation data required for wind calculations
 * Contains motion vectors and position information
 */
export interface VesselNavigationData {
  /** GPS position coordinates */
  readonly position?:
    | {
        readonly latitude: number;
        readonly longitude: number;
      }
    | undefined;

  /** Speed over ground in m/s */
  readonly speedOverGround?: number | undefined;

  /** Course over ground (true) in radians */
  readonly courseOverGroundTrue?: number | undefined;

  /** Heading (magnetic) in radians */
  readonly headingMagnetic?: number | undefined;

  /** Heading (true) in radians */
  readonly headingTrue?: number | undefined;

  /** Magnetic variation in radians (positive = East) */
  readonly magneticVariation?: number | undefined;

  /** Indicates if all required fields are present for calculations */
  readonly isComplete: boolean;

  /** Age of navigation data in seconds */
  readonly dataAge?: number | undefined;
}

// ===============================
// Plugin Configuration Types
// ===============================

/**
 * Severe-weather notification controls. Master `enabled` is off by default so
 * the plugin preserves its measurement-only behaviour on upgrade; flipping
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
 * Runtime plugin configuration with validation
 * Uses Zod schema for type-safe configuration parsing
 */
export interface PluginConfiguration {
  /** AccuWeather API key (required) */
  readonly accuWeatherApiKey: string;

  /** Weather data update frequency in minutes (default: 30; see CONFIG_DEFAULTS). */
  readonly updateFrequency: number;

  /** NMEA2000 emission interval in seconds (default: 5; see CONFIG_DEFAULTS). */
  readonly emissionInterval: number;

  /**
   * Daily AccuWeather API call cap (rolling 24 hours). The free tier allows 50
   * calls/day; this value lets operators surface that limit and stop fetching
   * when it is reached. Set to 0 to disable the cap (no quota tracking, no
   * warnings, no auto-pause).
   */
  readonly dailyApiQuota: number;

  /** Severe-weather notification settings (opt-in, off by default). */
  readonly notifications: NotificationsConfig;
}

/**
 * Signal K notification state values per spec 1.8.2 (notifications.html).
 * `normal` is the resolved-state sentinel that clears an active notification;
 * `alert`, `warn`, `alarm`, `emergency` form the ascending hazard ladder.
 */
export type NotificationState = 'normal' | 'alert' | 'warn' | 'alarm' | 'emergency';

/** Methods a notification consumer is asked to invoke (visual cue, audible alert). */
export type NotificationMethod = 'visual' | 'sound';

/**
 * Value object placed at a `notifications.environment.*` path. Matches the
 * shape consumed by `signalk-to-nmea2000`'s notification → Alert PGN bridge
 * (PGN 126983 + Alert Text 126985); fields not in the spec are intentionally
 * omitted to keep the payload simple.
 */
export interface NotificationValue {
  readonly state: NotificationState;
  readonly method: ReadonlyArray<NotificationMethod>;
  readonly message: string;
  /** ISO 8601 timestamp of the state transition. */
  readonly timestamp: string;
}

/**
 * Shape returned by the admin-UI panel's `/api/status` REST endpoint. Shared
 * between the producer (src/index.ts:registerPanelRoutes) and the consumer
 * (src/configpanel/PluginConfigurationPanel.jsx via JSDoc) so a typo on the
 * producer side fails compile-time rather than silently shipping.
 */
export interface PanelStatusResponse {
  readonly running: boolean;
  readonly banner: string;
  readonly updates: number;
  readonly quotaUsedLast24h: number;
  /** Whole-minute integer; null until the first successful fetch. */
  readonly lastUpdateMinutesAgo: number | null;
  readonly activeNotifications: number;
}

/**
 * AccuWeather API specific configuration
 */
export interface AccuWeatherConfig {
  readonly apiKey: string;
  readonly locationCacheTimeout: number;
  readonly requestTimeout: number;
  readonly retryAttempts: number;
  readonly retryDelay: number;
}

// ===============================
// Utility & Helper Types
// ===============================

/**
 * Wind calculation result with validation
 */
export interface WindCalculationResult {
  readonly apparentWindSpeed: number;
  readonly apparentWindAngle: number;
  readonly isValid: boolean;
  readonly validationErrors?: ReadonlyArray<string>;
}

/** Geolocation coordinates. */
export interface GeoLocation {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Plugin lifecycle states
 */
export type PluginState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

/**
 * Logging levels for structured logging
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger function signature used across all services
 */
export type Logger = (level: LogLevel, message: string, metadata?: Record<string, unknown>) => void;

// ===============================
// External API Types
// ===============================

/** AccuWeather metric/imperial measurement pair */
type AcwMeasurement = { readonly Value: number; readonly Unit: string };
/** AccuWeather measurement that includes a phrase for "RealFeel" responses */
type AcwPhrasedMeasurement = AcwMeasurement & { readonly Phrase: string };
/** Bilingual measurement pair returned by AccuWeather */
type AcwMetricPair = { readonly Metric: AcwMeasurement; readonly Imperial: AcwMeasurement };

/**
 * AccuWeather API current conditions response.
 *
 * Only fields actually consumed by the plugin are typed: the type is a
 * contract for what the plugin uses, not a full mirror of the AccuWeather
 * schema. MobileLink and Link (web URLs) and IndoorRelativeHumidity (irrelevant
 * to a vessel) stay omitted on purpose.
 */
export interface AccuWeatherCurrentConditions {
  readonly LocalObservationDateTime: string;
  readonly EpochTime: number;
  /** Plain-English description of the current condition (e.g. "Partly cloudy"). */
  readonly WeatherText: string;
  /**
   * AccuWeather icon code (1..44) used to map severe-condition categories
   * (thunderstorms, ice, freezing rain, etc.) into Signal K notifications.
   */
  readonly WeatherIcon: number;

  // Core temperature data
  readonly Temperature: AcwMetricPair;

  // Enhanced temperature readings
  readonly RealFeelTemperature: {
    readonly Metric: AcwPhrasedMeasurement;
    readonly Imperial: AcwPhrasedMeasurement;
  };
  readonly RealFeelTemperatureShade: {
    readonly Metric: AcwPhrasedMeasurement;
    readonly Imperial: AcwPhrasedMeasurement;
  };
  readonly ApparentTemperature: AcwMetricPair;
  readonly WindChillTemperature: AcwMetricPair;
  readonly WetBulbTemperature: AcwMetricPair;
  readonly WetBulbGlobeTemperature: AcwMetricPair;
  readonly DewPoint: AcwMetricPair;

  // Humidity
  readonly RelativeHumidity: number;

  // Wind
  readonly Wind: {
    readonly Speed: AcwMetricPair;
    readonly Direction: {
      readonly Degrees: number;
      readonly Localized: string;
      readonly English: string;
    };
  };
  /** Optional: free-tier and partial responses may omit WindGust entirely. */
  readonly WindGust?: {
    readonly Speed: AcwMetricPair;
  };

  // Pressure
  readonly Pressure: AcwMetricPair;

  // Atmospheric conditions
  readonly UVIndex: number;
  readonly UVIndexFloat: number;
  readonly Visibility: AcwMetricPair;
  readonly CloudCover: number;
  readonly Ceiling: AcwMetricPair;

  // Temperature trends
  readonly Past24HourTemperatureDeparture: AcwMetricPair;

  // Precipitation
  readonly Precip1hr: AcwMetricPair;
  readonly PrecipitationSummary: {
    readonly Precipitation: AcwMetricPair;
    readonly PastHour: AcwMetricPair;
    readonly Past3Hours: AcwMetricPair;
    readonly Past6Hours: AcwMetricPair;
    readonly Past12Hours: AcwMetricPair;
    readonly Past24Hours: AcwMetricPair;
  };

  // Optional condition detail: free-tier and partial responses may omit these.
  /** Barometric tendency. `Code` is "F" falling, "S" steady, "R" rising. */
  readonly PressureTendency?: {
    readonly Code: string;
  };
  /** Precipitation type ("Rain", "Snow", "Ice", "Mixed"); null when none. */
  readonly PrecipitationType?: string | null;
  /** Obstruction reducing visibility (e.g. "Fog"); empty string when none. */
  readonly ObstructionsToVisibility?: string;
}

/**
 * AccuWeather location search response
 */
export interface AccuWeatherLocation {
  readonly Key: string;
  readonly LocalizedName: string;
  readonly Country: {
    readonly ID: string;
    readonly LocalizedName: string;
  };
  readonly AdministrativeArea: {
    readonly ID: string;
    readonly LocalizedName: string;
  };
  readonly GeoPosition: {
    readonly Latitude: number;
    readonly Longitude: number;
  };
}

// ===============================
// Type Guards & Validators
// ===============================

/**
 * Returns true when navigation data carries the speed and course required for
 * apparent-wind calculations and is flagged complete by the producer.
 */
export function isCompleteNavigationData(
  data: VesselNavigationData
): data is VesselNavigationData & {
  readonly speedOverGround: number;
  readonly courseOverGroundTrue: number;
} {
  return !!(
    data.isComplete &&
    Number.isFinite(data.speedOverGround) &&
    Number.isFinite(data.courseOverGroundTrue)
  );
}
