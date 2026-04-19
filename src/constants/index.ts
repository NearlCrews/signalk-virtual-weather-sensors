/**
 * Application constants for signalk-virtual-weather-sensors plugin
 * Centralized configuration values and NMEA2000 specifications
 */

// ===============================
// Plugin Metadata
// ===============================

/** Plugin identification and versioning */
export const PLUGIN = {
  NAME: 'signalk-virtual-weather-sensors',
  DISPLAY_NAME: 'Signal K Virtual Weather Sensors',
  DESCRIPTION:
    'Signal K plugin providing comprehensive weather data from AccuWeather API with NMEA2000-compatible environmental measurements',
  VERSION: process.env.PKG_VERSION || '1.0.0',
  AUTHOR: 'Signal K Community',
} as const;

// ===============================
// Default Configuration Values
// ===============================

/** Default plugin configuration settings */
export const DEFAULT_CONFIG = {
  UPDATE_FREQUENCY: 5, // minutes
  EMISSION_INTERVAL: 5, // seconds
  ENABLE_EVENT_DRIVEN: true,
  USE_VESSEL_POSITION: true,
  LOCATION_CACHE_TIMEOUT: 3600, // seconds (1 hour)
  REQUEST_TIMEOUT: 10000, // milliseconds
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000, // milliseconds
} as const;

// ===============================
// NMEA2000 PGN Specifications
// ===============================

/** NMEA2000 Parameter Group Numbers for environmental data */
export const PGN = {
  /** Environmental Parameters - Temperature, pressure, humidity */
  ENVIRONMENTAL_PARAMETERS: 130310,

  /** Environmental Parameters - Pressure */
  ENVIRONMENTAL_PRESSURE: 130311,

  /** Environmental Parameters - Temperature */
  ENVIRONMENTAL_TEMPERATURE: 130312,

  /** Humidity */
  HUMIDITY: 130313,

  /** Actual Pressure (enhanced) */
  ACTUAL_PRESSURE: 130314,

  /** Wind Data */
  WIND_DATA: 130306,
} as const;

/** NMEA2000 temperature instance assignments (aligned with emitter-cannon) */
export const TEMPERATURE_INSTANCES = {
  OUTSIDE: 101,
  DEW_POINT: 102,
  WIND_CHILL: 103,
  HEAT_INDEX: 104,
  REAL_FEEL_SHADE: 108,
  APPARENT: 109,
  WET_BULB: 110,
  WET_BULB_GLOBE: 111,
} as const;

/** NMEA2000 humidity instance assignments (aligned with emitter-cannon) */
export const HUMIDITY_INSTANCES = {
  OUTSIDE: 100,
  INSIDE: 101,
} as const;

/** NMEA2000 message priority levels */
export const NMEA2000_PRIORITY = {
  HIGH: 2,
  NORMAL: 6,
  LOW: 7,
} as const;

/** NMEA2000 destination addresses */
export const NMEA2000_DESTINATION = {
  GLOBAL: 255,
  NULL: 255,
} as const;

// ===============================
// Signal K Path Constants
// ===============================

/** Standardized Signal K paths for environmental data (enhanced) */
export const SIGNALK_PATHS = {
  ENVIRONMENT: {
    OUTSIDE: {
      // Core temperature paths
      TEMPERATURE: 'environment.outside.temperature',
      DEW_POINT: 'environment.outside.dewPoint',
      HEAT_INDEX_TEMPERATURE: 'environment.outside.heatIndexTemperature',
      WIND_CHILL_TEMPERATURE: 'environment.outside.windChillTemperature',

      // Enhanced temperature paths (new from AccuWeather)
      DEW_POINT_TEMPERATURE: 'environment.outside.dewPointTemperature',
      APPARENT_TEMPERATURE: 'environment.outside.apparentTemperature',
      REAL_FEEL_SHADE: 'environment.outside.realFeelShade',
      WET_BULB_TEMPERATURE: 'environment.outside.wetBulbTemperature',
      WET_BULB_GLOBE_TEMPERATURE: 'environment.outside.wetBulbGlobeTemperature',
      THEORETICAL_WIND_CHILL_TEMPERATURE: 'environment.outside.theoreticalWindChillTemperature',

      // Core atmospheric paths
      PRESSURE: 'environment.outside.pressure',
      HUMIDITY: 'environment.outside.humidity',
      RELATIVE_HUMIDITY: 'environment.outside.relativeHumidity',

      // Enhanced atmospheric paths (new from AccuWeather)
      ABSOLUTE_HUMIDITY: 'environment.outside.absoluteHumidity',
      UV_INDEX: 'environment.outside.uvIndex',
      VISIBILITY: 'environment.outside.visibility',
      CLOUD_COVER: 'environment.outside.cloudCover',
      CLOUD_CEILING: 'environment.outside.cloudCeiling',
      PRESSURE_TENDENCY: 'environment.outside.pressureTendency',
      AIR_DENSITY: 'environment.outside.airDensity',

      // Precipitation paths (new from AccuWeather)
      PRECIPITATION_LAST_HOUR: 'environment.outside.precipitationLastHour',
      PRECIPITATION_CURRENT: 'environment.outside.precipitationCurrent',

      // Temperature trends (new from AccuWeather)
      TEMPERATURE_DEPARTURE_24H: 'environment.outside.temperatureDeparture24h',

      // Heat stress assessment (new calculated)
      HEAT_STRESS_INDEX: 'environment.outside.heatStressIndex',
    },

    INSIDE: {
      // Indoor environment (new from AccuWeather)
      RELATIVE_HUMIDITY: 'environment.inside.relativeHumidity',
      TEMPERATURE: 'environment.inside.temperature',
    },

    WIND: {
      // Core wind paths
      SPEED_TRUE: 'environment.wind.speedTrue',
      ANGLE_TRUE: 'environment.wind.angleTrue',
      DIRECTION_TRUE: 'environment.wind.directionTrue',
      DIRECTION_MAGNETIC: 'environment.wind.directionMagnetic',
      SPEED_APPARENT: 'environment.wind.speedApparent',
      ANGLE_APPARENT: 'environment.wind.angleApparent',
      DIRECTION_APPARENT: 'environment.wind.directionApparent',

      // Enhanced wind paths (new from AccuWeather)
      SPEED_GUST: 'environment.wind.speedGust',
      GUST_FACTOR: 'environment.wind.gustFactor',
      BEAUFORT_SCALE: 'environment.wind.beaufortScale',
      SPEED_OVER_GROUND: 'environment.wind.speedOverGround',
      ANGLE_TRUE_WATER: 'environment.wind.angleTrueWater',
    },
  },
} as const;

// ===============================
// Unit Conversion Constants
// ===============================

/** Physical constants and conversion factors */
export const UNITS = {
  /** Temperature conversions */
  TEMPERATURE: {
    CELSIUS_TO_KELVIN: 273.15,
    FAHRENHEIT_TO_CELSIUS: (f: number) => ((f - 32) * 5) / 9,
    CELSIUS_TO_FAHRENHEIT: (c: number) => (c * 9) / 5 + 32,
  },

  /** Pressure conversions */
  PRESSURE: {
    MILLIBAR_TO_PASCAL: 100,
    INCHES_HG_TO_PASCAL: 3386.389,
    ATM_TO_PASCAL: 101325,
  },

  /** Wind speed conversions */
  WIND_SPEED: {
    KMH_TO_MS: 1 / 3.6,
    MPH_TO_MS: 0.44704,
    KNOTS_TO_MS: 0.514444,
  },

  /** Angular conversions */
  ANGLE: {
    DEGREES_TO_RADIANS: Math.PI / 180,
    RADIANS_TO_DEGREES: 180 / Math.PI,
  },
} as const;

// ===============================
// AccuWeather API Constants
// ===============================

/** AccuWeather API configuration and endpoints */
export const ACCUWEATHER = {
  BASE_URL: 'https://dataservice.accuweather.com',
  ENDPOINTS: {
    LOCATION_SEARCH: '/locations/v1/cities/geoposition/search',
    CURRENT_CONDITIONS: '/currentconditions/v1',
  },
  API_VERSION: 'v1',
  DEFAULT_LANGUAGE: 'en-us',
  LOCATION_SEARCH_RADIUS: 50, // kilometers
} as const;

// ===============================
// Data Validation Constants
// ===============================

/** Data validation ranges and limits */
export const VALIDATION_LIMITS = {
  TEMPERATURE: {
    MIN: 173.15, // -100°C in Kelvin
    MAX: 373.15, // 100°C in Kelvin
  },

  PRESSURE: {
    MIN: 80000, // 800 mbar in Pascals
    MAX: 108000, // 1080 mbar in Pascals
  },

  HUMIDITY: {
    MIN: 0,
    MAX: 1, // 0-1 ratio per Signal K spec
  },

  WIND_SPEED: {
    MIN: 0,
    MAX: 150, // m/s (extreme hurricane speeds)
  },

  WIND_DIRECTION: {
    MIN: 0,
    MAX: 2 * Math.PI, // 0-360° in radians
  },

  COORDINATES: {
    LATITUDE: {
      MIN: -90,
      MAX: 90,
    },
    LONGITUDE: {
      MIN: -180,
      MAX: 180,
    },
  },

  /** Vessel speed validation (m/s) - 100 m/s ≈ 200 knots (extreme but possible) */
  VESSEL_SPEED: {
    MIN: 0,
    MAX: 100,
  },

  /** Navigation data age threshold (seconds) */
  MAX_DATA_AGE: 30,

  /** Vessel movement detection threshold (m/s) - 0.5 m/s ≈ 1 knot */
  VESSEL_MOVING_THRESHOLD: 0.5,
} as const;

// ===============================
// Error and Logging Constants
// ===============================

/** Structured error codes and messages */
export const ERROR_CODES = {
  CONFIGURATION: {
    INVALID_API_KEY: 'INVALID_API_KEY',
    MISSING_LOCATION: 'MISSING_LOCATION',
    INVALID_COORDINATES: 'INVALID_COORDINATES',
  },

  NETWORK: {
    API_TIMEOUT: 'API_TIMEOUT',
    API_RATE_LIMIT: 'API_RATE_LIMIT',
    API_UNAUTHORIZED: 'API_UNAUTHORIZED',
    API_FORBIDDEN: 'API_FORBIDDEN',
    API_INVALID_RESPONSE: 'API_INVALID_RESPONSE',
    RESPONSE_TOO_LARGE: 'RESPONSE_TOO_LARGE',
    NETWORK_ERROR: 'NETWORK_ERROR',
  },

  DATA: {
    INVALID_WEATHER_DATA: 'INVALID_WEATHER_DATA',
    STALE_VESSEL_DATA: 'STALE_VESSEL_DATA',
    CALCULATION_ERROR: 'CALCULATION_ERROR',
  },

  SYSTEM: {
    PLUGIN_START_FAILED: 'PLUGIN_START_FAILED',
    PLUGIN_STOP_FAILED: 'PLUGIN_STOP_FAILED',
    MEMORY_LIMIT: 'MEMORY_LIMIT',
  },
} as const;

// ===============================
// Performance and Timing Constants
// ===============================

/**
 * Performance monitoring and timing configurations
 *
 * These thresholds are based on:
 * - Real-time marine navigation requirements (sub-second response needed)
 * - AccuWeather API typical response times (1-3 seconds)
 * - NMEA2000 network emission requirements
 * - Signal K server resource constraints
 */
export const PERFORMANCE = {
  /**
   * Maximum allowed processing times in milliseconds
   *
   * WEATHER_UPDATE: 5000ms (5 seconds)
   *   - AccuWeather API calls typically complete in 1-3 seconds
   *   - Allows for network latency and retry logic
   *   - Exceeding this indicates network issues or API problems
   *
   * WIND_CALCULATION: 100ms
   *   - Vector calculations should complete in <10ms
   *   - 100ms threshold allows for JS engine variations
   *   - Exceeding this indicates computational issues
   *
   * DATA_EMISSION: 1000ms (1 second)
   *   - Delta message creation and Signal K emission
   *   - Should complete in <100ms normally
   *   - 1 second allows for large delta messages
   */
  MAX_PROCESSING_TIME: {
    WEATHER_UPDATE: 5000,
    WIND_CALCULATION: 100,
    DATA_EMISSION: 1000,
  },

  /**
   * Memory usage thresholds in bytes
   *
   * WARNING: 50MB
   *   - Plugins should typically use <20MB
   *   - 50MB indicates possible memory leak or excessive caching
   *   - Triggers warning log for investigation
   *
   * CRITICAL: 100MB
   *   - Approaching Node.js heap limits on constrained devices
   *   - Triggers error log and potential mitigation actions
   */
  MEMORY_THRESHOLDS: {
    WARNING: 50 * 1024 * 1024, // 50MB
    CRITICAL: 100 * 1024 * 1024, // 100MB
  },

  /**
   * Timing intervals in milliseconds for background tasks
   *
   * HEALTH_CHECK: 60000ms (1 minute)
   *   - Frequency for checking service health status
   *   - Balances monitoring granularity with CPU usage
   *
   * MEMORY_CHECK: 300000ms (5 minutes)
   *   - Memory usage monitoring interval
   *   - Less frequent to reduce overhead
   *
   * CLEANUP: 3600000ms (1 hour)
   *   - Cache cleanup and resource reclamation
   *   - Hourly cleanup prevents gradual memory growth
   */
  INTERVALS: {
    HEALTH_CHECK: 60000, // 1 minute
    MEMORY_CHECK: 300000, // 5 minutes
    CLEANUP: 3600000, // 1 hour
  },
} as const;

// ===============================
// Type-safe Constant Utilities
// ===============================

/** Utility type to extract keys from constant objects */
export type ConstantKeys<T> = T extends Record<infer K, unknown> ? K : never;

/** Utility type to extract values from constant objects */
export type ConstantValues<T> = T extends Record<string, infer V> ? V : never;

/** Type-safe way to get Signal K paths */
export type ExtractSignalKPath<T extends keyof typeof SIGNALK_PATHS> =
  (typeof SIGNALK_PATHS)[T] extends Record<string, infer U>
    ? U extends Record<string, infer V>
      ? V
      : U
    : never;
