import {
  BEAUFORT_LIMITS,
  CLOUD_CEILING_LIMITS_M,
  DEFAULT_CONFIG,
  HEAT_STRESS_INDEX_LIMITS,
  NMEA2000_LIMITS,
  PRECIPITATION_LIMITS,
  UV_INDEX_LIMITS,
  VALIDATION_LIMITS,
  VISIBILITY_LIMITS_M,
} from '../constants/index.js';
import type { NotificationsConfig, PluginConfiguration, WeatherData } from '../types/index.js';
import {
  celsiusToKelvin,
  clamp,
  isWithinBounds,
  kelvinToCelsius,
  normalizeAngle0To2Pi,
  normalizeAnglePiToPi,
} from './conversions.js';

/** NMEA2000 temperature bounds expressed in Kelvin (precomputed to avoid C↔K work on the hot path). */
const NMEA2000_TEMP_K_MIN = celsiusToKelvin(NMEA2000_LIMITS.TEMPERATURE_C.MIN);
const NMEA2000_TEMP_K_MAX = celsiusToKelvin(NMEA2000_LIMITS.TEMPERATURE_C.MAX);

/** Field names required on every AccuWeather current-conditions response. */
const REQUIRED_ACCUWEATHER_FIELDS: ReadonlyArray<string> = [
  'LocalObservationDateTime',
  'Temperature',
  'RelativeHumidity',
  'Wind',
  'Pressure',
  'DewPoint',
];

/**
 * Weather data validation results
 */
export interface ValidationResult {
  readonly isValid: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

/**
 * Weather Data Validation Functions
 */

/**
 * Validate temperature field
 */
function validateTemperatureField(
  data: Partial<WeatherData>,
  errors: string[],
  warnings: string[]
): void {
  if (data.temperature === undefined || !Number.isFinite(data.temperature)) {
    errors.push('Temperature is required and must be a finite number');
    return;
  }

  if (
    data.temperature < VALIDATION_LIMITS.TEMPERATURE.MIN ||
    data.temperature > VALIDATION_LIMITS.TEMPERATURE.MAX
  ) {
    warnings.push(
      `Temperature ${data.temperature}K is outside expected range (${VALIDATION_LIMITS.TEMPERATURE.MIN}-${VALIDATION_LIMITS.TEMPERATURE.MAX}K)`
    );
  }
}

/**
 * Validate pressure field
 */
function validatePressureField(
  data: Partial<WeatherData>,
  errors: string[],
  warnings: string[]
): void {
  if (data.pressure === undefined || !Number.isFinite(data.pressure)) {
    errors.push('Pressure is required and must be a finite number');
    return;
  }

  if (
    data.pressure < VALIDATION_LIMITS.PRESSURE.MIN ||
    data.pressure > VALIDATION_LIMITS.PRESSURE.MAX
  ) {
    warnings.push(
      `Pressure ${data.pressure}Pa is outside expected range (${VALIDATION_LIMITS.PRESSURE.MIN}-${VALIDATION_LIMITS.PRESSURE.MAX}Pa)`
    );
  }
}

/**
 * Validate humidity field
 */
function validateHumidityField(data: Partial<WeatherData>, errors: string[]): void {
  if (data.humidity === undefined || !Number.isFinite(data.humidity)) {
    errors.push('Humidity is required and must be a finite number');
    return;
  }

  if (
    data.humidity < VALIDATION_LIMITS.HUMIDITY.MIN ||
    data.humidity > VALIDATION_LIMITS.HUMIDITY.MAX
  ) {
    errors.push(
      `Humidity ${data.humidity} must be between ${VALIDATION_LIMITS.HUMIDITY.MIN} and ${VALIDATION_LIMITS.HUMIDITY.MAX}`
    );
  }
}

/**
 * Validate wind fields
 */
function validateWindFields(
  data: Partial<WeatherData>,
  errors: string[],
  warnings: string[]
): void {
  if (data.windSpeed === undefined || !Number.isFinite(data.windSpeed)) {
    errors.push('Wind speed is required and must be a finite number');
  } else if (
    data.windSpeed < VALIDATION_LIMITS.WIND_SPEED.MIN ||
    data.windSpeed > VALIDATION_LIMITS.WIND_SPEED.MAX
  ) {
    warnings.push(
      `Wind speed ${data.windSpeed}m/s is outside expected range (${VALIDATION_LIMITS.WIND_SPEED.MIN}-${VALIDATION_LIMITS.WIND_SPEED.MAX}m/s)`
    );
  }

  if (data.windDirection === undefined || !Number.isFinite(data.windDirection)) {
    errors.push('Wind direction is required and must be a finite number');
  } else if (
    data.windDirection < VALIDATION_LIMITS.WIND_DIRECTION.MIN ||
    data.windDirection > VALIDATION_LIMITS.WIND_DIRECTION.MAX
  ) {
    errors.push(
      `Wind direction ${data.windDirection} must be between ${VALIDATION_LIMITS.WIND_DIRECTION.MIN} and ${VALIDATION_LIMITS.WIND_DIRECTION.MAX} radians`
    );
  }
}

/**
 * Validate timestamp field
 */
function validateTimestampField(data: Partial<WeatherData>, errors: string[]): void {
  if (!data.timestamp || typeof data.timestamp !== 'string') {
    errors.push('Timestamp is required and must be a valid ISO string');
    return;
  }

  try {
    const date = new Date(data.timestamp);
    if (!Number.isFinite(date.getTime())) {
      errors.push('Timestamp must be a valid ISO date string');
    }
  } catch {
    errors.push('Timestamp must be a valid ISO date string');
  }
}

/**
 * Validate optional enhanced fields
 */
function validateEnhancedFields(
  data: Partial<WeatherData>,
  errors: string[],
  warnings: string[]
): void {
  if (
    data.uvIndex !== undefined &&
    (data.uvIndex < UV_INDEX_LIMITS.MIN || data.uvIndex > UV_INDEX_LIMITS.MAX)
  ) {
    warnings.push(
      `UV Index ${data.uvIndex} is outside typical range (${UV_INDEX_LIMITS.MIN}-${UV_INDEX_LIMITS.MAX})`
    );
  }

  if (
    data.visibility !== undefined &&
    (data.visibility < VISIBILITY_LIMITS_M.MIN || data.visibility > VISIBILITY_LIMITS_M.MAX)
  ) {
    warnings.push(
      `Visibility ${data.visibility}m is outside typical range (${VISIBILITY_LIMITS_M.MIN}-${VISIBILITY_LIMITS_M.MAX}m)`
    );
  }

  if (
    data.cloudCover !== undefined &&
    (data.cloudCover < VALIDATION_LIMITS.HUMIDITY.MIN ||
      data.cloudCover > VALIDATION_LIMITS.HUMIDITY.MAX)
  ) {
    errors.push(
      `Cloud cover ${data.cloudCover} must be between ${VALIDATION_LIMITS.HUMIDITY.MIN} and ${VALIDATION_LIMITS.HUMIDITY.MAX}`
    );
  }

  if (
    data.beaufortScale !== undefined &&
    (data.beaufortScale < BEAUFORT_LIMITS.MIN || data.beaufortScale > BEAUFORT_LIMITS.MAX)
  ) {
    warnings.push(
      `Beaufort scale ${data.beaufortScale} is outside valid range (${BEAUFORT_LIMITS.MIN}-${BEAUFORT_LIMITS.MAX})`
    );
  }
}

/**
 * Validate complete weather data structure
 */
export function validateWeatherData(data: Partial<WeatherData>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  validateTemperatureField(data, errors, warnings);
  validatePressureField(data, errors, warnings);
  validateHumidityField(data, errors);
  validateWindFields(data, errors, warnings);
  validateTimestampField(data, errors);
  validateEnhancedFields(data, errors, warnings);

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Plugin Configuration Validation Functions
 */

/** Minimum length for any plausible AccuWeather API key. */
export const API_KEY_MIN_LENGTH = 20;
/** Disallowed control/whitespace characters in API keys (catches paste mistakes). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching paste-error control chars
const API_KEY_INVALID_CHARS = /[\s\x00-\x1f\x7f]/;

/** Common placeholder strings users paste before adding their real key */
const API_KEY_PLACEHOLDER_PATTERNS: ReadonlyArray<RegExp> = [
  /^your[_-]?api[_-]?key$/i,
  /^api[_-]?key[_-]?here$/i,
  /^xxx+$/i,
  /^test+$/i,
  /^demo+$/i,
  /^sample+$/i,
];

function validateApiKey(
  config: Partial<PluginConfiguration>,
  errors: string[],
  warnings: string[]
): void {
  if (!config.accuWeatherApiKey || typeof config.accuWeatherApiKey !== 'string') {
    errors.push('AccuWeather API key is required');
    return;
  }

  const trimmedKey = config.accuWeatherApiKey.trim();

  if (trimmedKey.length === 0) {
    errors.push('AccuWeather API key cannot be empty');
    return;
  }

  if (trimmedKey.length < API_KEY_MIN_LENGTH) {
    errors.push(
      `AccuWeather API key is too short (minimum ${API_KEY_MIN_LENGTH} characters). Get your key at https://developer.accuweather.com/`
    );
    return;
  }

  // Catch paste errors: spaces, tabs, control characters. Don't whitelist alphanumeric:
  // legitimate keys vary in character set across AccuWeather generations.
  if (API_KEY_INVALID_CHARS.test(trimmedKey)) {
    warnings.push(
      'AccuWeather API key contains whitespace or control characters. Please verify your key is correct.'
    );
  }

  if (API_KEY_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmedKey))) {
    errors.push(
      'AccuWeather API key appears to be a placeholder. Please enter your actual API key.'
    );
  }
}

/**
 * Validate update frequency field.
 *
 * Note: the admin UI schema in `index.ts` already enforces 1 to 60. The
 * runtime warn-instead-of-error for > 60 is deliberate tolerance for
 * hand-edited plugin config (e.g. operator pre-load before booting the
 * server). `sanitizeConfiguration` clamps the actual value used at runtime,
 * so the warning is purely advisory.
 */
function validateUpdateFrequency(
  config: Partial<PluginConfiguration>,
  errors: string[],
  warnings: string[]
): void {
  if (config.updateFrequency === undefined) return;

  if (typeof config.updateFrequency !== 'number' || !Number.isFinite(config.updateFrequency)) {
    errors.push('Update frequency must be a finite number');
    return;
  }

  if (config.updateFrequency < 1) {
    errors.push('Update frequency must be at least 1 minute');
  } else if (config.updateFrequency > 60) {
    warnings.push('Update frequency over 60 minutes may result in stale data');
  }
}

/**
 * Validate emission interval field. Same hand-edited-config tolerance as
 * `validateUpdateFrequency`: schema bounds are stricter, the runtime warns
 * and `sanitizeConfiguration` clamps.
 */
function validateEmissionInterval(
  config: Partial<PluginConfiguration>,
  errors: string[],
  warnings: string[]
): void {
  if (config.emissionInterval === undefined) return;

  if (typeof config.emissionInterval !== 'number' || !Number.isFinite(config.emissionInterval)) {
    errors.push('Emission interval must be a finite number');
    return;
  }

  if (config.emissionInterval < 1) {
    errors.push('Emission interval must be at least 1 second');
  } else if (config.emissionInterval > 60) {
    warnings.push('Emission interval over 60 seconds may not be suitable for real-time NMEA2000');
  }
}

/**
 * Validate daily API quota field. Zero is the documented "no cap" sentinel,
 * so accept it without warning.
 */
function validateDailyApiQuota(
  config: Partial<PluginConfiguration>,
  errors: string[],
  warnings: string[]
): void {
  if (config.dailyApiQuota === undefined) return;

  if (typeof config.dailyApiQuota !== 'number' || !Number.isFinite(config.dailyApiQuota)) {
    errors.push('Daily API quota must be a finite number');
    return;
  }

  if (config.dailyApiQuota < 0) {
    errors.push('Daily API quota must be 0 or greater (0 disables the cap)');
  } else if (config.dailyApiQuota > DEFAULT_CONFIG.DAILY_API_QUOTA_MAX) {
    warnings.push(
      `Daily API quota over ${DEFAULT_CONFIG.DAILY_API_QUOTA_MAX} is unusual; clamping to ${DEFAULT_CONFIG.DAILY_API_QUOTA_MAX}`
    );
  }
}

/**
 * Validate complete plugin configuration
 */
export function validateConfiguration(config: Partial<PluginConfiguration>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  validateApiKey(config, errors, warnings);
  validateUpdateFrequency(config, errors, warnings);
  validateEmissionInterval(config, errors, warnings);
  validateDailyApiQuota(config, errors, warnings);

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Coerce a raw notifications subobject into the canonical `NotificationsConfig`
 * shape, falling back to `DEFAULT_CONFIG.NOTIFICATIONS` for any missing or
 * non-boolean field. Treats missing input as "use all defaults" so legacy
 * configurations (no `notifications` key) continue to load.
 */
function sanitizeNotifications(input: unknown): NotificationsConfig {
  const defaults = DEFAULT_CONFIG.NOTIFICATIONS;
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  return {
    enabled: bool(raw.enabled, defaults.ENABLED),
    wind: bool(raw.wind, defaults.WIND),
    visibility: bool(raw.visibility, defaults.VISIBILITY),
    heat: bool(raw.heat, defaults.HEAT),
    cold: bool(raw.cold, defaults.COLD),
    weather: bool(raw.weather, defaults.WEATHER),
  };
}

/**
 * Sanitize and normalize configuration with defaults. `dailyApiQuota` uses
 * `??` (not `||`) because 0 is the meaningful "no cap" value and would
 * otherwise be replaced by the default.
 */
export function sanitizeConfiguration(config: Partial<PluginConfiguration>): PluginConfiguration {
  return {
    accuWeatherApiKey: config.accuWeatherApiKey?.trim() || '',
    updateFrequency: clamp(config.updateFrequency || DEFAULT_CONFIG.UPDATE_FREQUENCY, 1, 60),
    emissionInterval: clamp(config.emissionInterval || DEFAULT_CONFIG.EMISSION_INTERVAL, 1, 60),
    dailyApiQuota: clamp(
      config.dailyApiQuota ?? DEFAULT_CONFIG.DAILY_API_QUOTA,
      0,
      DEFAULT_CONFIG.DAILY_API_QUOTA_MAX
    ),
    notifications: sanitizeNotifications(config.notifications),
  };
}

/**
 * API Response Validation Functions
 */

/**
 * Validate response is array
 */
function validateResponseIsArray(response: unknown, errors: string[]): response is unknown[] {
  if (!Array.isArray(response)) {
    errors.push('AccuWeather response must be an array');
    return false;
  }

  if (response.length === 0) {
    errors.push('AccuWeather response array is empty');
    return false;
  }

  return true;
}

/**
 * Validate required fields in response
 */
function validateRequiredFields(data: Record<string, unknown>, errors: string[]): void {
  for (const field of REQUIRED_ACCUWEATHER_FIELDS) {
    if (!(field in data)) {
      errors.push(`Missing required field: ${field}`);
    }
  }
}

/**
 * Validate temperature structure in response
 */
function validateTemperatureStructure(data: Record<string, unknown>, errors: string[]): void {
  if (!data.Temperature || typeof data.Temperature !== 'object') return;

  const temp = data.Temperature as Record<string, unknown>;
  if (!temp.Metric || typeof temp.Metric !== 'object') {
    errors.push('Temperature.Metric is required');
    return;
  }

  const metric = temp.Metric as Record<string, unknown>;
  if (typeof metric.Value !== 'number') {
    errors.push('Temperature.Metric.Value must be a number');
  }
}

/**
 * Validate wind structure in response
 */
function validateWindStructure(data: Record<string, unknown>, errors: string[]): void {
  if (!data.Wind || typeof data.Wind !== 'object') return;

  const wind = data.Wind as Record<string, unknown>;
  if (!wind.Speed || !wind.Direction) {
    errors.push('Wind.Speed and Wind.Direction are required');
  }
}

/**
 * Validate AccuWeather API response structure
 */
export function validateAccuWeatherResponse(response: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!validateResponseIsArray(response, errors)) {
    return { isValid: false, errors, warnings };
  }

  const data = response[0] as Record<string, unknown>;

  validateRequiredFields(data, errors);
  validateTemperatureStructure(data, errors);
  validateWindStructure(data, errors);

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * NMEA2000 Data Validation Functions
 */

/**
 * Validate data ranges for NMEA2000 compatibility
 */
export function validateNMEA2000Ranges(data: Partial<WeatherData>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (data.temperature !== undefined) {
    const tempC = kelvinToCelsius(data.temperature);
    if (tempC < NMEA2000_LIMITS.TEMPERATURE_C.MIN || tempC > NMEA2000_LIMITS.TEMPERATURE_C.MAX) {
      warnings.push(
        `Temperature ${tempC.toFixed(1)}°C is outside NMEA2000 range (${NMEA2000_LIMITS.TEMPERATURE_C.MIN}°C to +${NMEA2000_LIMITS.TEMPERATURE_C.MAX}°C)`
      );
    }
  }

  if (data.pressure !== undefined) {
    if (
      data.pressure < NMEA2000_LIMITS.PRESSURE_PA.MIN ||
      data.pressure > NMEA2000_LIMITS.PRESSURE_PA.MAX
    ) {
      warnings.push(
        `Pressure ${data.pressure}Pa is outside typical atmospheric range (${NMEA2000_LIMITS.PRESSURE_PA.MIN}-${NMEA2000_LIMITS.PRESSURE_PA.MAX}Pa)`
      );
    }
  }

  if (data.windSpeed !== undefined && data.windSpeed > NMEA2000_LIMITS.WIND_SPEED_MAX_MS) {
    warnings.push(
      `Wind speed ${data.windSpeed}m/s exceeds NMEA2000 maximum (${NMEA2000_LIMITS.WIND_SPEED_MAX_MS}m/s)`
    );
  }

  if (data.windGustSpeed !== undefined && data.windGustSpeed > NMEA2000_LIMITS.WIND_SPEED_MAX_MS) {
    warnings.push(
      `Wind gust speed ${data.windGustSpeed}m/s exceeds NMEA2000 maximum (${NMEA2000_LIMITS.WIND_SPEED_MAX_MS}m/s)`
    );
  }

  if (
    data.humidity !== undefined &&
    (data.humidity < VALIDATION_LIMITS.HUMIDITY.MIN ||
      data.humidity > VALIDATION_LIMITS.HUMIDITY.MAX)
  ) {
    errors.push(
      `Humidity ${data.humidity} must be between ${VALIDATION_LIMITS.HUMIDITY.MIN} and ${VALIDATION_LIMITS.HUMIDITY.MAX} (ratio)`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Numeric WeatherData fields that the mapper emits. Excludes any field whose
 * sanitization is non-numeric (angles handled separately).
 */
type SanitizableNumericKey = {
  [K in keyof WeatherData]-?: WeatherData[K] extends number | undefined ? K : never;
}[keyof WeatherData];

const TWO_PI = 2 * Math.PI;
const TEMP_K_BOUNDS = [NMEA2000_TEMP_K_MIN, NMEA2000_TEMP_K_MAX] as const;
const WIND_SPEED_BOUNDS = [0, NMEA2000_LIMITS.WIND_SPEED_MAX_MS] as const;
const HUMIDITY_BOUNDS = [VALIDATION_LIMITS.HUMIDITY.MIN, VALIDATION_LIMITS.HUMIDITY.MAX] as const;

/**
 * Single source of truth for every numeric leaf the mapper can emit. Adding a
 * new emitted field means appending one row here; both the fast-path range
 * check and the clamping pass walk this table so they cannot drift.
 */
const NUMERIC_FIELD_RULES: ReadonlyArray<readonly [SanitizableNumericKey, number, number]> = [
  ['temperature', ...TEMP_K_BOUNDS],
  ['pressure', NMEA2000_LIMITS.PRESSURE_PA.MIN, NMEA2000_LIMITS.PRESSURE_PA.MAX],
  ['humidity', ...HUMIDITY_BOUNDS],
  ['windSpeed', ...WIND_SPEED_BOUNDS],
  ['windGustSpeed', ...WIND_SPEED_BOUNDS],
  ['dewPoint', ...TEMP_K_BOUNDS],
  ['windChill', ...TEMP_K_BOUNDS],
  ['heatIndex', ...TEMP_K_BOUNDS],
  ['realFeelShade', ...TEMP_K_BOUNDS],
  ['wetBulbTemperature', ...TEMP_K_BOUNDS],
  ['wetBulbGlobeTemperature', ...TEMP_K_BOUNDS],
  ['apparentTemperature', ...TEMP_K_BOUNDS],
  ['apparentWindSpeed', ...WIND_SPEED_BOUNDS],
  ['uvIndex', UV_INDEX_LIMITS.MIN, UV_INDEX_LIMITS.MAX],
  ['visibility', VISIBILITY_LIMITS_M.MIN, VISIBILITY_LIMITS_M.MAX],
  ['cloudCover', ...HUMIDITY_BOUNDS],
  ['cloudCeiling', CLOUD_CEILING_LIMITS_M.MIN, CLOUD_CEILING_LIMITS_M.MAX],
  ['precipitationLastHour', 0, PRECIPITATION_LIMITS.HOURLY_MM_MAX],
  ['precipitationCurrent', 0, PRECIPITATION_LIMITS.RATE_MMH_MAX],
  ['beaufortScale', BEAUFORT_LIMITS.MIN, BEAUFORT_LIMITS.MAX],
  ['heatStressIndex', HEAT_STRESS_INDEX_LIMITS.MIN, HEAT_STRESS_INDEX_LIMITS.MAX],
];

/**
 * Returns true when no field of `data` would be modified by NMEA2000 clamping.
 *
 * Every leaf emitted by `NMEA2000PathMapper.mapToSignalKPaths` is covered here
 * so the mapper's "every path is sanitized" claim holds. Precipitation fields
 * are checked in their raw AccuWeather units (mm / mm-h); the mapper does the
 * mm-to-m conversion at emission time.
 *
 * Angles are checked inline: `windDirection` follows the Signal K 0..2π
 * convention (half-open), `apparentWindAngle` follows the (-π, π]
 * port-negative convention for canonical `environment.wind.angleApparent`.
 */
function isWithinNMEA2000Ranges(data: WeatherData): boolean {
  for (const [key, min, max] of NUMERIC_FIELD_RULES) {
    const value = data[key];
    if (value !== undefined && (value < min || value > max)) {
      return false;
    }
  }
  const dir = data.windDirection;
  if (dir !== undefined && (dir < 0 || dir >= TWO_PI)) return false;
  const aAngle = data.apparentWindAngle;
  if (aAngle !== undefined && (aAngle <= -Math.PI || aAngle > Math.PI)) return false;
  return true;
}

/**
 * Clamp every field that the mapper emits to its NMEA2000-compatible range.
 * When all fields already fit, the original object reference is returned to
 * avoid a 24-field shallow copy on the hot path.
 *
 * Coverage matches `NMEA2000PathMapper.mapToSignalKPaths`: temperatures and
 * wind speeds use NMEA2000 hardware bounds; ratios (humidity, cloudCover) are
 * spec 0..1; angles use the Signal K canonical convention (windDirection
 * 0..2π, apparentWindAngle port-negative -π..π); precipitation is capped in
 * raw mm units before the mapper converts to m and m/s.
 */
export function sanitizeForNMEA2000(data: WeatherData): WeatherData {
  if (isWithinNMEA2000Ranges(data)) {
    return data;
  }

  // `Record<string, unknown>` cast lets us index by SanitizableNumericKey
  // without re-typing every assignment; the readonly contract is restored on
  // the return type, and runtime mutation of the local copy is safe.
  const sanitized = { ...data } as Record<string, unknown>;
  for (const [key, min, max] of NUMERIC_FIELD_RULES) {
    const value = data[key];
    if (value !== undefined) {
      sanitized[key] = clamp(value, min, max);
    }
  }
  if (data.windDirection !== undefined) {
    sanitized.windDirection = normalizeAngle0To2Pi(data.windDirection);
  }
  if (data.apparentWindAngle !== undefined) {
    sanitized.apparentWindAngle = normalizeAnglePiToPi(data.apparentWindAngle);
  }
  return sanitized as unknown as WeatherData;
}

/** Validate latitude value. */
export function isValidLatitude(latitude: number): boolean {
  return isWithinBounds(
    latitude,
    VALIDATION_LIMITS.COORDINATES.LATITUDE.MIN,
    VALIDATION_LIMITS.COORDINATES.LATITUDE.MAX
  );
}

/** Validate longitude value. */
export function isValidLongitude(longitude: number): boolean {
  return isWithinBounds(
    longitude,
    VALIDATION_LIMITS.COORDINATES.LONGITUDE.MIN,
    VALIDATION_LIMITS.COORDINATES.LONGITUDE.MAX
  );
}

/**
 * Grouped exports for backward compatibility
 */
export const ConfigurationValidator = {
  validateConfiguration,
  sanitizeConfiguration,
} as const;

export const NMEA2000Validator = {
  validateNMEA2000Ranges,
  sanitizeForNMEA2000,
} as const;
