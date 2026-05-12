/**
 * Application constants for signalk-virtual-weather-sensors plugin
 * Centralized configuration values and NMEA2000 specifications
 */

import { DEFAULT_NOTIFICATIONS } from './notifications-shared.js';

export { DEFAULT_NOTIFICATIONS, NOTIFICATION_LABELS } from './notifications-shared.js';

/**
 * Fixed reference point used by the admin-UI panel's `/api/test-key`
 * endpoint to probe a candidate AccuWeather key with one location-search
 * call. Greenwich Royal Observatory is an arbitrary, well-defined coordinate;
 * the test does not depend on a live vessel GPS fix.
 */
export const TEST_KEY_LOCATION = { latitude: 51.4779, longitude: 0.0015 } as const;

// ===============================
// Plugin Metadata
// ===============================

/** Plugin identification and versioning */
export const PLUGIN = {
  NAME: 'signalk-virtual-weather-sensors',
  DISPLAY_NAME: 'Virtual Weather Sensors',
  DESCRIPTION:
    'Signal K plugin providing comprehensive weather data from AccuWeather API with NMEA2000-compatible environmental measurements',
  VERSION: process.env.PKG_VERSION || '1.0.0',
  /**
   * Stable Signal K $source ref for every delta this plugin emits, so users
   * can configure source priorities to prefer real onboard sensors over the
   * AccuWeather feed.
   */
  SOURCE_REF: 'accuweather',
  STATUS: {
    RUNNING: 'Running',
    /** Banner prefix once 24h API usage crosses `API_QUOTA.WARN_RATIO`. */
    RUNNING_QUOTA_WARN: 'Running [quota 90% used]',
    STOPPED: 'Stopped',
  },
  /** Delay before first weather fetch after start, in ms */
  INITIAL_UPDATE_DELAY_MS: 5000,
  /**
   * Multiplier on `updateFrequency` (minutes) used to decide when emitted
   * weather data has gone stale. At the default 30-minute fetch cadence,
   * data older than 60 minutes trips the stale-data error.
   */
  STALENESS_FACTOR: 2,
} as const;

// ===============================
// Default Configuration Values
// ===============================

/** Default plugin configuration settings */
export const DEFAULT_CONFIG = {
  /**
   * Default fetch cadence: 30 minutes yields 48 AccuWeather calls/day
   * (24h * 60min / 30 = 48), which fits inside the free-tier 50/day quota
   * with headroom. Operators on paid tiers commonly lower this to 5 to 15
   * minutes via the admin UI. INVARIANT: if `UPDATE_FREQUENCY` drops below
   * `Math.ceil(1440 / DAILY_API_QUOTA)` minutes the plugin will exhaust the
   * quota inside any rolling 24h window and pause fetches.
   */
  UPDATE_FREQUENCY: 30, // minutes
  EMISSION_INTERVAL: 5, // seconds
  /**
   * AccuWeather free tier allows 50 calls/day. Operators on a paid tier can
   * raise this in plugin settings (max 1000); setting it to 0 disables the cap
   * entirely. Paired with `UPDATE_FREQUENCY`: see the invariant note there.
   */
  DAILY_API_QUOTA: 50,
  /** Maximum value accepted for `dailyApiQuota` in plugin settings. */
  DAILY_API_QUOTA_MAX: 1000,
  LOCATION_CACHE_TIMEOUT: 3600, // seconds (1 hour)
  REQUEST_TIMEOUT: 10000, // milliseconds
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000, // milliseconds
  /**
   * Severe-weather notifications are opt-in (master off by default) so the
   * existing measurement-only behaviour is preserved on upgrade. The per-
   * category toggles default to true so a single flip of `enabled` lights up
   * the full set; operators can untick individual categories from the admin UI.
   * Values come from notifications-shared.js so the JSX panel and the rjsf
   * schema agree on the canonical defaults.
   */
  NOTIFICATIONS: {
    ENABLED: DEFAULT_NOTIFICATIONS.enabled,
    WIND: DEFAULT_NOTIFICATIONS.wind,
    VISIBILITY: DEFAULT_NOTIFICATIONS.visibility,
    HEAT: DEFAULT_NOTIFICATIONS.heat,
    COLD: DEFAULT_NOTIFICATIONS.cold,
    WEATHER: DEFAULT_NOTIFICATIONS.weather,
  },
} as const;

/**
 * Quota usage thresholds (as ratios of `dailyApiQuota`). Crossing
 * `WARN_RATIO` switches the status banner into a warning prefix; reaching
 * `EXHAUST_RATIO` trips a setPluginError and pauses fetches until the rolling
 * 24h window drops below the cap.
 */
export const API_QUOTA = {
  WARN_RATIO: 0.9,
  EXHAUST_RATIO: 1.0,
} as const;

// ===============================
// Signal K Path Constants
// ===============================

/**
 * Notification paths the plugin emits under SK 1.8.2 `notifications.environment.*`.
 *
 * Each path tracks a single hazard band. Distinct paths (rather than one path
 * whose state ladder rises and falls) keep Garmin and other consumers that
 * cache by path+id from collapsing transitions into one another. The
 * WeatherNotifier state machine emits a delta only when a band's active flag
 * flips, sending `state: 'normal'` on exit so plotters clear the alert.
 */
export const NOTIFICATION_PATHS = {
  WIND_GALE: 'notifications.environment.wind.gale',
  WIND_STORM: 'notifications.environment.wind.storm',
  WIND_HURRICANE: 'notifications.environment.wind.hurricane',
  VISIBILITY_LOW: 'notifications.environment.visibility.low',
  VISIBILITY_VERY_LOW: 'notifications.environment.visibility.veryLow',
  HEAT_CAUTION: 'notifications.environment.heat.caution',
  HEAT_HIGH: 'notifications.environment.heat.high',
  HEAT_EXTREME: 'notifications.environment.heat.extreme',
  COLD_CAUTION: 'notifications.environment.cold.caution',
  COLD_EXTREME: 'notifications.environment.cold.extreme',
  WEATHER_SEVERE: 'notifications.environment.weather.severe',
} as const;

/**
 * Hazard thresholds used by the notification state machine. All thresholds
 * are inclusive entry points: `>= threshold` activates the band.
 *
 *   Wind:        Beaufort entry per WMO classification (8 gale, 10 storm, 12 hurricane).
 *   Visibility:  SOLAS restricted-visibility threshold (1 nm = 1852 m); very-low at 0.5 nm.
 *   Heat:        wet-bulb globe temperature heat stress index (military/marine bands).
 *   Cold:        wind chill in Kelvin (0 C caution, -20 C extreme).
 */
export const NOTIFICATION_THRESHOLDS = {
  WIND: {
    GALE_BEAUFORT: 8,
    STORM_BEAUFORT: 10,
    HURRICANE_BEAUFORT: 12,
  },
  VISIBILITY: {
    LOW_M: 1852,
    VERY_LOW_M: 926,
  },
  HEAT_STRESS: {
    CAUTION_INDEX: 2,
    HIGH_INDEX: 3,
    EXTREME_INDEX: 4,
  },
  COLD: {
    CAUTION_K: 273.15,
    EXTREME_K: 253.15,
  },
} as const;

/**
 * Signal K paths emitted by this plugin. See
 * https://signalk.org/specification/1.8.2/doc/vesselsBranch.html for canonical
 * vocabulary.
 *
 * ENVIRONMENT.OUTSIDE and ENVIRONMENT.WIND hold ONLY 1.8.2-vocabulary leaves.
 * Anything not in the 1.8.2 vocabulary lives under ENVIRONMENT.WEATHER so the
 * plugin never squats an object node on a canonical container that the spec
 * defines as leaf-only. Provenance stays in `$source`, not in the path.
 */
export const SIGNALK_PATHS = {
  ENVIRONMENT: {
    OUTSIDE: {
      TEMPERATURE: 'environment.outside.temperature',
      PRESSURE: 'environment.outside.pressure',
      RELATIVE_HUMIDITY: 'environment.outside.relativeHumidity',
      DEW_POINT_TEMPERATURE: 'environment.outside.dewPointTemperature',
      APPARENT_WIND_CHILL_TEMPERATURE: 'environment.outside.apparentWindChillTemperature',
      HEAT_INDEX_TEMPERATURE: 'environment.outside.heatIndexTemperature',
      AIR_DENSITY: 'environment.outside.airDensity',
    },

    // AccuWeather wind is ground-referenced; speedTrue (water-referenced)
    // would clobber a real anemometer feed on a moving vessel.
    WIND: {
      SPEED_OVER_GROUND: 'environment.wind.speedOverGround',
      DIRECTION_TRUE: 'environment.wind.directionTrue',
      SPEED_APPARENT: 'environment.wind.speedApparent',
      ANGLE_APPARENT: 'environment.wind.angleApparent',
    },

    /**
     * Producer-namespaced branch for everything outside the 1.8.2 vocabulary.
     * Keeps non-spec leaves off `environment.outside` and `environment.wind`
     * so consumers walking those canonical containers see only spec leaves.
     */
    WEATHER: {
      APPARENT_TEMPERATURE: 'environment.weather.apparentTemperature',
      REAL_FEEL_SHADE: 'environment.weather.realFeelShade',
      WET_BULB_TEMPERATURE: 'environment.weather.wetBulbTemperature',
      WET_BULB_GLOBE_TEMPERATURE: 'environment.weather.wetBulbGlobeTemperature',
      ABSOLUTE_HUMIDITY: 'environment.weather.absoluteHumidity',
      UV_INDEX: 'environment.weather.uvIndex',
      VISIBILITY: 'environment.weather.visibility',
      CLOUD_COVER: 'environment.weather.cloudCover',
      CLOUD_CEILING: 'environment.weather.cloudCeiling',
      PRECIPITATION_LAST_HOUR: 'environment.weather.precipitationLastHour',
      PRECIPITATION_CURRENT: 'environment.weather.precipitationCurrent',
      TEMPERATURE_DEPARTURE_24H: 'environment.weather.temperatureDeparture24h',
      SPEED_GUST: 'environment.weather.speedGust',
      GUST_FACTOR: 'environment.weather.gustFactor',
      BEAUFORT_SCALE: 'environment.weather.beaufortScale',
      HEAT_STRESS_INDEX: 'environment.weather.heatStressIndex',
    },
  },

  /**
   * Signal K paths this plugin READS from the vessel's `self` context via
   * `app.getSelfPath`. Centralized so a typo in any input path becomes a
   * type error instead of a silent runtime undefined.
   */
  NAVIGATION: {
    POSITION: 'navigation.position',
    SPEED_OVER_GROUND: 'navigation.speedOverGround',
    COURSE_OVER_GROUND_TRUE: 'navigation.courseOverGroundTrue',
    COURSE_OVER_GROUND_MAGNETIC: 'navigation.courseOverGroundMagnetic',
    HEADING_TRUE: 'navigation.headingTrue',
    HEADING_MAGNETIC: 'navigation.headingMagnetic',
    MAGNETIC_VARIATION: 'navigation.magneticVariation',
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
  },

  /** Wind speed conversions */
  WIND_SPEED: {
    KMH_TO_MS: 1 / 3.6,
    KNOTS_TO_MS: 0.514444,
  },

  /** Angular conversions */
  ANGLE: {
    DEGREES_TO_RADIANS: Math.PI / 180,
    RADIANS_TO_DEGREES: 180 / Math.PI,
  },

  /** Precipitation conversions: Signal K uses meters for depth and m/s for rate. */
  PRECIPITATION: {
    /** Millimeters to meters (depth). */
    MM_TO_M: 1 / 1000,
    /** Millimeters per hour to meters per second (rate). */
    MMH_TO_MS: 1 / (1000 * 3600),
  },

  /** Length conversions. */
  LENGTH: {
    /** Kilometers to meters. */
    KM_TO_M: 1000,
  },
} as const;

/**
 * August-Roche-Magnus formula coefficients used for saturation vapour pressure
 * and dew-point calculations. Both `WindCalculator.calculateDewPoint` and
 * `conversions.calculateSaturationVaporPressure` reference this single source.
 * See https://en.wikipedia.org/wiki/Arden_Buck_equation for variant context.
 */
export const MAGNUS = {
  /** Multiplier on temperature in the exponent (dimensionless). */
  A: 17.625,
  /** Offset on temperature in the exponent (degrees Celsius). */
  B: 243.04,
  /** Saturation pressure at 0°C in hPa. */
  C: 6.1094,
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
  /** Maximum length for descriptive strings copied verbatim from API responses into Signal K deltas */
  MAX_DESCRIPTION_LENGTH: 128,
  /** Maximum length for short labels copied verbatim from API responses (e.g. observation timestamps). */
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

/** Cloud ceiling cap: above the tropopause is garbage. */
export const CLOUD_CEILING_LIMITS_M = { MIN: 0, MAX: 20000 } as const;

/**
 * Precipitation caps in raw AccuWeather units (mm hourly, mm/h rate). The
 * mapper converts to Signal K SI (m, m/s) downstream. 1000 caps a poisoned
 * API response without rejecting any plausible meteorological event.
 */
export const PRECIPITATION_LIMITS = {
  HOURLY_MM_MAX: 1000,
  RATE_MMH_MAX: 1000,
} as const;

/** Heat-stress index: 0 low to 4 extreme. */
export const HEAT_STRESS_INDEX_LIMITS = { MIN: 0, MAX: 4 } as const;

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

  /** Navigation data age threshold (seconds) used by SignalKService cache. */
  MAX_DATA_AGE: 30,

  /** Vessel movement detection threshold (m/s): 0.5 m/s is roughly 1 knot. */
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
