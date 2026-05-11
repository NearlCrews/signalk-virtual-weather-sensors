import {
  BEAUFORT_LIMITS,
  DEFAULT_CONFIG,
  NMEA2000_LIMITS,
  UV_INDEX_LIMITS,
  VALIDATION_LIMITS,
  VISIBILITY_LIMITS_M,
} from '../constants/index.js';
import type { PluginConfiguration, WeatherData } from '../types/index.js';
import { celsiusToKelvin, clamp, kelvinToCelsius, normalizeAngle0To2Pi } from './conversions.js';

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
const API_KEY_MIN_LENGTH = 20;
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
 * Validate update frequency field
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
 * Validate emission interval field
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

/** Returns true when no field of `data` would be modified by NMEA2000 clamping. */
function isWithinNMEA2000Ranges(data: WeatherData): boolean {
  const inRange = (value: number | undefined, min: number, max: number): boolean =>
    value === undefined || (value >= min && value <= max);

  return (
    inRange(data.temperature, NMEA2000_TEMP_K_MIN, NMEA2000_TEMP_K_MAX) &&
    inRange(data.pressure, NMEA2000_LIMITS.PRESSURE_PA.MIN, NMEA2000_LIMITS.PRESSURE_PA.MAX) &&
    inRange(data.humidity, VALIDATION_LIMITS.HUMIDITY.MIN, VALIDATION_LIMITS.HUMIDITY.MAX) &&
    inRange(data.windSpeed, 0, NMEA2000_LIMITS.WIND_SPEED_MAX_MS) &&
    inRange(data.windGustSpeed, 0, NMEA2000_LIMITS.WIND_SPEED_MAX_MS) &&
    (data.windDirection === undefined ||
      (data.windDirection >= 0 && data.windDirection < 2 * Math.PI))
  );
}

/**
 * Clamp every field to its NMEA2000-emission range. When all fields already fit, the
 * original object reference is returned to avoid a 24-field shallow copy on the hot path.
 */
export function sanitizeForNMEA2000(data: WeatherData): WeatherData {
  if (isWithinNMEA2000Ranges(data)) {
    return data;
  }

  const sanitized = { ...data };

  if (sanitized.temperature !== undefined) {
    sanitized.temperature = clamp(sanitized.temperature, NMEA2000_TEMP_K_MIN, NMEA2000_TEMP_K_MAX);
  }
  if (sanitized.pressure !== undefined) {
    sanitized.pressure = clamp(
      sanitized.pressure,
      NMEA2000_LIMITS.PRESSURE_PA.MIN,
      NMEA2000_LIMITS.PRESSURE_PA.MAX
    );
  }
  if (sanitized.humidity !== undefined) {
    sanitized.humidity = clamp(
      sanitized.humidity,
      VALIDATION_LIMITS.HUMIDITY.MIN,
      VALIDATION_LIMITS.HUMIDITY.MAX
    );
  }
  if (sanitized.windSpeed !== undefined) {
    sanitized.windSpeed = clamp(sanitized.windSpeed, 0, NMEA2000_LIMITS.WIND_SPEED_MAX_MS);
  }
  if (sanitized.windGustSpeed !== undefined) {
    sanitized.windGustSpeed = clamp(sanitized.windGustSpeed, 0, NMEA2000_LIMITS.WIND_SPEED_MAX_MS);
  }
  if (sanitized.windDirection !== undefined) {
    sanitized.windDirection = normalizeAngle0To2Pi(sanitized.windDirection);
  }

  return sanitized;
}

/** Validate latitude value. */
export function isValidLatitude(latitude: number): boolean {
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= VALIDATION_LIMITS.COORDINATES.LATITUDE.MIN &&
    latitude <= VALIDATION_LIMITS.COORDINATES.LATITUDE.MAX
  );
}

/**
 * Validate longitude value
 */
export function isValidLongitude(longitude: number): boolean {
  return (
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= VALIDATION_LIMITS.COORDINATES.LONGITUDE.MIN &&
    longitude <= VALIDATION_LIMITS.COORDINATES.LONGITUDE.MAX
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
