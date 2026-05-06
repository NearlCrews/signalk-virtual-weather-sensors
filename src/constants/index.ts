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
  STATUS: {
    RUNNING: 'SK to N2K Weather running',
    STOPPED: 'SK to N2K Weather stopped',
    SERVICE_RUNNING: 'Weather service running',
    SERVICE_STOPPED: 'Weather service stopped',
  },
  /** Number of Signal K paths emitted by NMEA2000PathMapper (core + always-present enhanced fields) */
  ENHANCED_FIELD_COUNT: 24,
  /** Delay before first weather fetch after start, in ms */
  INITIAL_UPDATE_DELAY_MS: 5000,
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
  /** Environmental Parameters - Pressure */
  ENVIRONMENTAL_PRESSURE: 130311,

  /** Environmental Parameters - Temperature */
  ENVIRONMENTAL_TEMPERATURE: 130312,

  /** Humidity */
  HUMIDITY: 130313,

  /** Wind Data */
  WIND_DATA: 130306,
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
      HEAT_INDEX_TEMPERATURE: 'environment.outside.heatIndexTemperature',
      WIND_CHILL_TEMPERATURE: 'environment.outside.windChillTemperature',

      // Enhanced temperature paths (new from AccuWeather)
      DEW_POINT_TEMPERATURE: 'environment.outside.dewPointTemperature',
      APPARENT_TEMPERATURE: 'environment.outside.apparentTemperature',
      REAL_FEEL_SHADE: 'environment.outside.realFeelShade',
      WET_BULB_TEMPERATURE: 'environment.outside.wetBulbTemperature',
      WET_BULB_GLOBE_TEMPERATURE: 'environment.outside.wetBulbGlobeTemperature',

      // Core atmospheric paths
      PRESSURE: 'environment.outside.pressure',
      HUMIDITY: 'environment.outside.humidity',

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

    WIND: {
      // Core wind paths
      SPEED_TRUE: 'environment.wind.speedTrue',
      DIRECTION_TRUE: 'environment.wind.directionTrue',
      SPEED_APPARENT: 'environment.wind.speedApparent',
      ANGLE_APPARENT: 'environment.wind.angleApparent',

      // Enhanced wind paths (new from AccuWeather)
      SPEED_GUST: 'environment.wind.speedGust',
      GUST_FACTOR: 'environment.wind.gustFactor',
      BEAUFORT_SCALE: 'environment.wind.beaufortScale',
      SPEED_OVER_GROUND: 'environment.wind.speedOverGround',
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
  DEFAULT_LANGUAGE: 'en-us',
  LOCATION_SEARCH_RADIUS: 50, // kilometers
  /** Maximum length for descriptive strings copied verbatim from API responses into Signal K deltas */
  MAX_DESCRIPTION_LENGTH: 128,
  /** Maximum length for short labels (e.g. PressureTendency.LocalizedText) */
  MAX_LABEL_LENGTH: 64,
} as const;

// ===============================
// Data Validation Constants
// ===============================

/** NMEA2000-spec sanitization ranges. Used by sanitizeForNMEA2000 to clamp before bus emission. */
export const NMEA2000_LIMITS = {
  /** NMEA2000 environmental temperature range in Celsius */
  TEMPERATURE_C: { MIN: -40, MAX: 85 },
  /** Atmospheric pressure range in Pascals (broader than VALIDATION_LIMITS to allow extreme weather) */
  PRESSURE_PA: { MIN: 80000, MAX: 120000 },
  /** Maximum wind speed in m/s (200 knots, NMEA2000 max) */
  WIND_SPEED_MAX_MS: 102.3,
} as const;

/** UV Index reasonable range for sanity warnings */
export const UV_INDEX_LIMITS = { MIN: 0, MAX: 15 } as const;

/** Visibility range in meters for sanity warnings */
export const VISIBILITY_LIMITS_M = { MIN: 0, MAX: 50000 } as const;

/** Beaufort scale range */
export const BEAUFORT_LIMITS = { MIN: 0, MAX: 12 } as const;

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

/** Maximum allowed weather-update processing time in ms before logging a slow-update warning. */
export const PERFORMANCE = {
  MAX_PROCESSING_TIME: {
    WEATHER_UPDATE: 5000,
  },
} as const;
