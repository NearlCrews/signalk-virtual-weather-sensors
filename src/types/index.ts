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
  /** Pressure tendency indicator */
  readonly pressureTendency?: string;

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

  /** Age of navigation data in milliseconds */
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
// NMEA2000 & Signal K Types
// ===============================

/**
 * NMEA2000 message structure for environmental data
 * Aligns with PGN 130310, 130311, 130312 specifications
 */
export interface NMEA2000Message {
  readonly pgn: number;
  readonly prio: number;
  readonly dst: number;
  readonly fields: Record<string, unknown>;
}

/**
 * Signal K delta message format for real-time data updates
 */
export interface SignalKDelta {
  readonly context: string;
  readonly updates: ReadonlyArray<{
    readonly timestamp: string;
    readonly values: ReadonlyArray<{
      readonly path: string;
      readonly value: unknown;
    }>;
  }>;
}

// ===============================
// Utility & Helper Types
// ===============================

/**
 * Supported weather data sources
 */
export type WeatherSource = 'accuweather';

/**
 * Temperature unit types for conversions
 */
export type TemperatureUnit = 'K' | 'C' | 'F';

/**
 * Wind calculation result with validation
 */
export interface WindCalculationResult {
  readonly apparentWindSpeed: number;
  readonly apparentWindAngle: number;
  readonly isValid: boolean;
  readonly validationErrors?: ReadonlyArray<string>;
}

/**
 * Geolocation coordinates with validation
 */
export interface GeoLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly isValid: boolean;
}

/**
 * API response wrapper with error handling
 */
export interface ApiResponse<T> {
  readonly data?: T;
  readonly error?: {
    readonly message: string;
    readonly code: string;
    readonly statusCode?: number;
  };
  readonly timestamp: string;
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

/**
 * Error severity classification
 */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

// ===============================
// External API Types
// ===============================

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
  readonly Temperature: {
    readonly Metric: { readonly Value: number; readonly Unit: string };
    readonly Imperial: { readonly Value: number; readonly Unit: string };
  };

  // Enhanced temperature readings
  readonly RealFeelTemperature: {
    readonly Metric: { readonly Value: number; readonly Unit: string; readonly Phrase: string };
    readonly Imperial: { readonly Value: number; readonly Unit: string; readonly Phrase: string };
  };
  readonly RealFeelTemperatureShade: {
    readonly Metric: { readonly Value: number; readonly Unit: string; readonly Phrase: string };
    readonly Imperial: { readonly Value: number; readonly Unit: string; readonly Phrase: string };
  };
  readonly ApparentTemperature: {
    readonly Metric: { readonly Value: number; readonly Unit: string };
    readonly Imperial: { readonly Value: number; readonly Unit: string };
  };
  readonly WindChillTemperature: {
    readonly Metric: { readonly Value: number; readonly Unit: string };
    readonly Imperial: { readonly Value: number; readonly Unit: string };
  };
  readonly WetBulbTemperature: {
    readonly Metric: { readonly Value: number; readonly Unit: string };
    readonly Imperial: { readonly Value: number; readonly Unit: string };
  };
  readonly WetBulbGlobeTemperature: {
    readonly Metric: { readonly Value: number; readonly Unit: string };
    readonly Imperial: { readonly Value: number; readonly Unit: string };
  };
  readonly DewPoint: {
    readonly Metric: { readonly Value: number; readonly Unit: string };
    readonly Imperial: { readonly Value: number; readonly Unit: string };
  };

  // Humidity data (outside and inside)
  readonly RelativeHumidity: number;
  readonly IndoorRelativeHumidity: number;

  // Enhanced wind data
  readonly Wind: {
    readonly Speed: {
      readonly Metric: { readonly Value: number; readonly Unit: string };
      readonly Imperial: { readonly Value: number; readonly Unit: string };
    };
    readonly Direction: {
      readonly Degrees: number;
      readonly Localized: string;
      readonly English: string;
    };
  };
  readonly WindGust: {
    readonly Speed: {
      readonly Metric: { readonly Value: number; readonly Unit: string };
      readonly Imperial: { readonly Value: number; readonly Unit: string };
    };
  };

  // Pressure data
  readonly Pressure: {
    readonly Metric: { readonly Value: number; readonly Unit: string };
    readonly Imperial: { readonly Value: number; readonly Unit: string };
  };
  readonly PressureTendency: {
    readonly LocalizedText: string;
    readonly Code: string;
  };

  // Atmospheric conditions
  readonly UVIndex: number;
  readonly UVIndexFloat: number;
  readonly UVIndexText: string;
  readonly Visibility: {
    readonly Metric: { readonly Value: number; readonly Unit: string };
    readonly Imperial: { readonly Value: number; readonly Unit: string };
  };
  readonly CloudCover: number;
  readonly Ceiling: {
    readonly Metric: { readonly Value: number; readonly Unit: string };
    readonly Imperial: { readonly Value: number; readonly Unit: string };
  };
  readonly ObstructionsToVisibility: string;

  // Temperature trends
  readonly Past24HourTemperatureDeparture: {
    readonly Metric: { readonly Value: number; readonly Unit: string };
    readonly Imperial: { readonly Value: number; readonly Unit: string };
  };

  // Precipitation data
  readonly Precip1hr: {
    readonly Metric: { readonly Value: number; readonly Unit: string };
    readonly Imperial: { readonly Value: number; readonly Unit: string };
  };
  readonly PrecipitationSummary: {
    readonly Precipitation: {
      readonly Metric: { readonly Value: number; readonly Unit: string };
      readonly Imperial: { readonly Value: number; readonly Unit: string };
    };
    readonly PastHour: {
      readonly Metric: { readonly Value: number; readonly Unit: string };
      readonly Imperial: { readonly Value: number; readonly Unit: string };
    };
    readonly Past3Hours: {
      readonly Metric: { readonly Value: number; readonly Unit: string };
      readonly Imperial: { readonly Value: number; readonly Unit: string };
    };
    readonly Past6Hours: {
      readonly Metric: { readonly Value: number; readonly Unit: string };
      readonly Imperial: { readonly Value: number; readonly Unit: string };
    };
    readonly Past12Hours: {
      readonly Metric: { readonly Value: number; readonly Unit: string };
      readonly Imperial: { readonly Value: number; readonly Unit: string };
    };
    readonly Past24Hours: {
      readonly Metric: { readonly Value: number; readonly Unit: string };
      readonly Imperial: { readonly Value: number; readonly Unit: string };
    };
  };

  // Temperature ranges
  readonly TemperatureSummary: {
    readonly Past6HourRange: {
      readonly Minimum: {
        readonly Metric: { readonly Value: number; readonly Unit: string };
        readonly Imperial: { readonly Value: number; readonly Unit: string };
      };
      readonly Maximum: {
        readonly Metric: { readonly Value: number; readonly Unit: string };
        readonly Imperial: { readonly Value: number; readonly Unit: string };
      };
    };
    readonly Past12HourRange: {
      readonly Minimum: {
        readonly Metric: { readonly Value: number; readonly Unit: string };
        readonly Imperial: { readonly Value: number; readonly Unit: string };
      };
      readonly Maximum: {
        readonly Metric: { readonly Value: number; readonly Unit: string };
        readonly Imperial: { readonly Value: number; readonly Unit: string };
      };
    };
    readonly Past24HourRange: {
      readonly Minimum: {
        readonly Metric: { readonly Value: number; readonly Unit: string };
        readonly Imperial: { readonly Value: number; readonly Unit: string };
      };
      readonly Maximum: {
        readonly Metric: { readonly Value: number; readonly Unit: string };
        readonly Imperial: { readonly Value: number; readonly Unit: string };
      };
    };
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
 * Type guard for checking if weather data is complete
 */
export function isCompleteWeatherData(data: Partial<WeatherData>): data is WeatherData {
  return !!(
    Number.isFinite(data.temperature) &&
    Number.isFinite(data.pressure) &&
    Number.isFinite(data.humidity) &&
    Number.isFinite(data.windSpeed) &&
    Number.isFinite(data.windDirection) &&
    data.timestamp
  );
}

/**
 * Type guard for checking if vessel navigation data is sufficient for calculations
 */
export function isCompleteNavigationData(
  data: Partial<VesselNavigationData>
): data is Required<Pick<VesselNavigationData, 'speedOverGround' | 'courseOverGroundTrue'>> &
  VesselNavigationData {
  return !!(
    Number.isFinite(data.speedOverGround) &&
    Number.isFinite(data.courseOverGroundTrue) &&
    data.isComplete === true
  );
}
