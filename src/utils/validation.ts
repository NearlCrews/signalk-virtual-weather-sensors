/**
 * Data Validation Utilities
 * Comprehensive validation functions for weather data, coordinates, and plugin configuration
 */

import { VALIDATION_LIMITS } from '../constants/index.js';
import type { PluginConfiguration, VesselNavigationData, WeatherData } from '../types/index.js';

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
function validateHumidityField(
  data: Partial<WeatherData>,
  errors: string[],
  _warnings: string[]
): void {
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
  if (data.uvIndex !== undefined && (data.uvIndex < 0 || data.uvIndex > 15)) {
    warnings.push(`UV Index ${data.uvIndex} is outside typical range (0-15)`);
  }

  if (data.visibility !== undefined && (data.visibility < 0 || data.visibility > 50000)) {
    warnings.push(`Visibility ${data.visibility}m is outside typical range (0-50000m)`);
  }

  if (data.cloudCover !== undefined && (data.cloudCover < 0 || data.cloudCover > 1)) {
    errors.push(`Cloud cover ${data.cloudCover} must be between 0 and 1`);
  }

  if (data.beaufortScale !== undefined && (data.beaufortScale < 0 || data.beaufortScale > 12)) {
    warnings.push(`Beaufort scale ${data.beaufortScale} is outside valid range (0-12)`);
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
  validateHumidityField(data, errors, warnings);
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
 * Validate temperature consistency across multiple readings
 */
export function validateTemperatureConsistency(data: Partial<WeatherData>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (data.temperature && data.dewPoint) {
    if (data.dewPoint > data.temperature) {
      errors.push('Dew point cannot be higher than air temperature');
    }
  }

  if (data.temperature && data.windChill) {
    if (data.windChill > data.temperature && data.windSpeed && data.windSpeed > 1) {
      warnings.push('Wind chill is higher than air temperature despite wind presence');
    }
  }

  if (data.wetBulbTemperature && data.temperature) {
    if (data.wetBulbTemperature > data.temperature) {
      errors.push('Wet bulb temperature cannot exceed dry bulb temperature');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Vessel Navigation Data Validation Functions
 */

/**
 * Validate position fields
 */
function validatePositionFields(data: Partial<VesselNavigationData>, errors: string[]): void {
  if (!data.position) return;

  if (!isValidLatitude(data.position.latitude)) {
    errors.push(`Invalid latitude: ${data.position.latitude} (must be between -90 and 90)`);
  }
  if (!isValidLongitude(data.position.longitude)) {
    errors.push(`Invalid longitude: ${data.position.longitude} (must be between -180 and 180)`);
  }
}

/**
 * Validate speed over ground field
 */
function validateSpeedOverGround(
  data: Partial<VesselNavigationData>,
  errors: string[],
  warnings: string[]
): void {
  if (data.speedOverGround === undefined) return;

  if (typeof data.speedOverGround !== 'number' || !Number.isFinite(data.speedOverGround)) {
    errors.push('Speed over ground must be a finite number');
    return;
  }

  if (data.speedOverGround < 0) {
    errors.push('Speed over ground cannot be negative');
  } else if (data.speedOverGround > 100) {
    warnings.push(`Speed over ground ${data.speedOverGround}m/s seems unusually high (>100m/s)`);
  }
}

/**
 * Validate course over ground field
 */
function validateCourseOverGround(
  data: Partial<VesselNavigationData>,
  errors: string[],
  warnings: string[]
): void {
  if (data.courseOverGroundTrue === undefined) return;

  if (
    typeof data.courseOverGroundTrue !== 'number' ||
    !Number.isFinite(data.courseOverGroundTrue)
  ) {
    errors.push('Course over ground must be a finite number');
    return;
  }

  if (data.courseOverGroundTrue < 0 || data.courseOverGroundTrue > 2 * Math.PI) {
    warnings.push(
      `Course over ground ${data.courseOverGroundTrue} rad should be normalized to 0-2π range`
    );
  }
}

/**
 * Validate data age field
 */
function validateDataAge(
  data: Partial<VesselNavigationData>,
  errors: string[],
  warnings: string[]
): void {
  if (data.dataAge === undefined) return;

  if (data.dataAge > 60) {
    warnings.push(`Vessel data is ${data.dataAge} seconds old (consider refreshing)`);
  }
  if (data.dataAge > 300) {
    errors.push(`Vessel data is too old (${data.dataAge} seconds) for reliable calculations`);
  }
}

/**
 * Validate vessel navigation data for completeness
 */
export function validateNavigationData(data: Partial<VesselNavigationData>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  validatePositionFields(data, errors);
  validateSpeedOverGround(data, errors, warnings);
  validateCourseOverGround(data, errors, warnings);
  validateDataAge(data, errors, warnings);

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if vessel data is complete for wind calculations
 */
export function isCompleteForWindCalculations(data: Partial<VesselNavigationData>): boolean {
  return !!(
    data.position &&
    typeof data.speedOverGround === 'number' &&
    typeof data.courseOverGroundTrue === 'number' &&
    data.isComplete === true
  );
}

/**
 * Plugin Configuration Validation Functions
 */

/**
 * AccuWeather API key format validation
 * AccuWeather API keys are typically 32 alphanumeric characters
 */
const ACCUWEATHER_API_KEY_PATTERN = /^[a-zA-Z0-9]{20,40}$/;

/**
 * Validate API key field
 * AccuWeather API keys are typically 32 alphanumeric characters
 */
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

  // Check minimum length
  if (trimmedKey.length < 20) {
    errors.push(
      'AccuWeather API key is too short (minimum 20 characters). Get your key at https://developer.accuweather.com/'
    );
    return;
  }

  // Check maximum reasonable length
  if (trimmedKey.length > 40) {
    warnings.push('AccuWeather API key is longer than expected (typically 32 characters)');
  } else if (!ACCUWEATHER_API_KEY_PATTERN.test(trimmedKey)) {
    // Only check format if length is in expected range (regex enforces {20,40})
    warnings.push(
      'AccuWeather API key contains unexpected characters (should be alphanumeric). Please verify your key is correct.'
    );
  }

  // Check for common placeholder patterns
  const placeholderPatterns = [
    /^your[_-]?api[_-]?key$/i,
    /^api[_-]?key[_-]?here$/i,
    /^xxx+$/i,
    /^test+$/i,
    /^demo+$/i,
    /^sample+$/i,
  ];

  if (placeholderPatterns.some((pattern) => pattern.test(trimmedKey))) {
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
 * Validate complete plugin configuration
 */
export function validateConfiguration(config: Partial<PluginConfiguration>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  validateApiKey(config, errors, warnings);
  validateUpdateFrequency(config, errors, warnings);
  validateEmissionInterval(config, errors, warnings);

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Sanitize and normalize configuration with defaults
 */
export function sanitizeConfiguration(config: Partial<PluginConfiguration>): PluginConfiguration {
  return {
    accuWeatherApiKey: config.accuWeatherApiKey?.trim() || '',
    updateFrequency: Math.max(1, Math.min(60, config.updateFrequency || 5)),
    emissionInterval: Math.max(1, Math.min(60, config.emissionInterval || 5)),
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
  const requiredFields = [
    'LocalObservationDateTime',
    'Temperature',
    'RelativeHumidity',
    'Wind',
    'Pressure',
    'DewPoint',
  ];

  for (const field of requiredFields) {
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

  // Temperature range: -40°C to +85°C (NMEA2000 spec)
  if (data.temperature !== undefined) {
    const tempC = data.temperature - 273.15;
    if (tempC < -40 || tempC > 85) {
      warnings.push(`Temperature ${tempC.toFixed(1)}°C is outside NMEA2000 range (-40°C to +85°C)`);
    }
  }

  // Pressure range: reasonable atmospheric range
  if (data.pressure !== undefined) {
    if (data.pressure < 80000 || data.pressure > 120000) {
      warnings.push(
        `Pressure ${data.pressure}Pa is outside typical atmospheric range (80000-120000Pa)`
      );
    }
  }

  // Wind speed range: 0 to 102.3 m/s (0-200 knots, NMEA2000 max)
  if (data.windSpeed !== undefined && data.windSpeed > 102.3) {
    warnings.push(`Wind speed ${data.windSpeed}m/s exceeds NMEA2000 maximum (102.3m/s)`);
  }

  if (data.windGustSpeed !== undefined && data.windGustSpeed > 102.3) {
    warnings.push(`Wind gust speed ${data.windGustSpeed}m/s exceeds NMEA2000 maximum (102.3m/s)`);
  }

  // Humidity must be valid ratio (0-1)
  if (data.humidity !== undefined && (data.humidity < 0 || data.humidity > 1)) {
    errors.push(`Humidity ${data.humidity} must be between 0 and 1 (ratio)`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Sanitize data to fit NMEA2000 ranges
 */
export function sanitizeForNMEA2000(data: WeatherData): WeatherData {
  const sanitized = { ...data };

  // Clamp temperature to NMEA2000 range
  if (sanitized.temperature !== undefined) {
    const tempC = sanitized.temperature - 273.15;
    const clampedTempC = Math.max(-40, Math.min(85, tempC));
    sanitized.temperature = clampedTempC + 273.15;
  }

  // Clamp pressure to reasonable range
  if (sanitized.pressure !== undefined) {
    sanitized.pressure = Math.max(80000, Math.min(120000, sanitized.pressure));
  }

  // Clamp humidity to valid ratio range (0-1)
  if (sanitized.humidity !== undefined) {
    sanitized.humidity = Math.max(0, Math.min(1, sanitized.humidity));
  }

  // Clamp wind speeds to NMEA2000 maximum
  if (sanitized.windSpeed !== undefined) {
    sanitized.windSpeed = Math.max(0, Math.min(102.3, sanitized.windSpeed));
  }

  if (sanitized.windGustSpeed !== undefined) {
    sanitized.windGustSpeed = Math.max(0, Math.min(102.3, sanitized.windGustSpeed));
  }

  // Normalize wind directions
  if (sanitized.windDirection !== undefined) {
    sanitized.windDirection =
      ((sanitized.windDirection % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  }

  return sanitized;
}

/**
 * Comprehensive Validation Functions
 */

/**
 * Perform complete validation of weather data
 */
export function validateCompleteWeatherData(data: Partial<WeatherData>): ValidationResult {
  const basicValidation = validateWeatherData(data);
  const consistencyValidation = validateTemperatureConsistency(data);
  const nmea2000Validation = validateNMEA2000Ranges(data);

  const allErrors = [
    ...basicValidation.errors,
    ...consistencyValidation.errors,
    ...nmea2000Validation.errors,
  ];

  const allWarnings = [
    ...basicValidation.warnings,
    ...consistencyValidation.warnings,
    ...nmea2000Validation.warnings,
  ];

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

/**
 * Get validation summary for logging
 */
export function getValidationSummary(result: ValidationResult): string {
  if (result.isValid) {
    return result.warnings.length > 0 ? `Valid with ${result.warnings.length} warnings` : 'Valid';
  }
  return `Invalid: ${result.errors.length} errors, ${result.warnings.length} warnings`;
}

/**
 * Validate latitude value
 */
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
export const WeatherDataValidator = {
  validateWeatherData,
  validateTemperatureConsistency,
} as const;

export const VesselDataValidator = {
  validateNavigationData,
  isCompleteForWindCalculations,
} as const;

export const ConfigurationValidator = {
  validateConfiguration,
  sanitizeConfiguration,
} as const;

export const ApiResponseValidator = {
  validateAccuWeatherResponse,
} as const;

export const NMEA2000Validator = {
  validateNMEA2000Ranges,
  sanitizeForNMEA2000,
} as const;

export const ValidationOrchestrator = {
  validateCompleteWeatherData,
  getValidationSummary,
} as const;
