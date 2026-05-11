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
  /** Wind chill temperature in Kelvin */
  readonly windChill: number;
  /** Heat index temperature in Kelvin */
  readonly heatIndex: number;

  // Enhanced temperature readings (new from AccuWeather)
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

  // Metadata (existing)
  /** Human-readable weather description */
  readonly description?: string;
  /** ISO 8601 timestamp of measurement */
  readonly timestamp: string;
  /** Data quality indicator (0-1, 1 = highest quality) */
  readonly quality?: number;

  // Calculated synthetic values (new)
  /** Beaufort scale (0-12) calculated from wind + gust */
  readonly beaufortScale?: number;
  /** Enhanced air density in kg/m³ (includes elevation if available) */
  readonly airDensityEnhanced?: number;
  /** Absolute humidity in kg/m³ */
  readonly absoluteHumidity?: number;
  /** Heat stress index from wet bulb globe temperature */
  readonly heatStressIndex?: number;
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
 * Runtime plugin configuration with validation
 * Uses Zod schema for type-safe configuration parsing
 */
export interface PluginConfiguration {
  /** AccuWeather API key (required) */
  readonly accuWeatherApiKey: string;

  /** Weather data update frequency in minutes (default: 5) */
  readonly updateFrequency: number;

  /** NMEA2000 emission interval in seconds (default: 5) */
  readonly emissionInterval: number;

  /**
   * Daily AccuWeather API call cap (rolling 24 hours). The free tier allows 50
   * calls/day; this value lets operators surface that limit and stop fetching
   * when it is reached. Set to 0 to disable the cap (no quota tracking, no
   * warnings, no auto-pause).
   */
  readonly dailyApiQuota: number;
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
/** Min/max temperature range for a time window */
type AcwTempRange = {
  readonly Minimum: AcwMetricPair;
  readonly Maximum: AcwMetricPair;
};

/**
 * AccuWeather API current conditions response (enhanced with all available fields)
 */
export interface AccuWeatherCurrentConditions {
  readonly LocalObservationDateTime: string;
  readonly EpochTime: number;
  readonly WeatherText: string;
  readonly WeatherIcon: number;
  readonly HasPrecipitation: boolean;
  readonly PrecipitationType?: string | null;
  readonly IsDayTime: boolean;

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

  // Humidity data (outside and inside)
  readonly RelativeHumidity: number;
  readonly IndoorRelativeHumidity: number;

  // Enhanced wind data
  readonly Wind: {
    readonly Speed: AcwMetricPair;
    readonly Direction: {
      readonly Degrees: number;
      readonly Localized: string;
      readonly English: string;
    };
  };
  readonly WindGust: {
    readonly Speed: AcwMetricPair;
  };

  // Pressure data
  readonly Pressure: AcwMetricPair;
  readonly PressureTendency: {
    readonly LocalizedText: string;
    readonly Code: string;
  };

  // Atmospheric conditions
  readonly UVIndex: number;
  readonly UVIndexFloat: number;
  readonly UVIndexText: string;
  readonly Visibility: AcwMetricPair;
  readonly CloudCover: number;
  readonly Ceiling: AcwMetricPair;
  readonly ObstructionsToVisibility: string;

  // Temperature trends
  readonly Past24HourTemperatureDeparture: AcwMetricPair;

  // Precipitation data
  readonly Precip1hr: AcwMetricPair;
  readonly PrecipitationSummary: {
    readonly Precipitation: AcwMetricPair;
    readonly PastHour: AcwMetricPair;
    readonly Past3Hours: AcwMetricPair;
    readonly Past6Hours: AcwMetricPair;
    readonly Past12Hours: AcwMetricPair;
    readonly Past24Hours: AcwMetricPair;
  };

  // Temperature ranges
  readonly TemperatureSummary: {
    readonly Past6HourRange: AcwTempRange;
    readonly Past12HourRange: AcwTempRange;
    readonly Past24HourRange: AcwTempRange;
  };

  // Links
  readonly MobileLink: string;
  readonly Link: string;
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
