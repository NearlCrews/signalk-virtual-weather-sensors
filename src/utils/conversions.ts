/**
 * Weather Unit Conversion Utilities
 * Modern TypeScript implementation of unit conversions and weather calculations
 * Consolidates conversion logic with comprehensive type safety and validation
 */

import { UNITS, VALIDATION_LIMITS } from '../constants/index.js';
import type { TemperatureUnit } from '../types/index.js';

/**
 * Temperature conversion utilities
 */

/**
 * Convert Celsius to Kelvin
 */
export function celsiusToKelvin(celsius: number): number {
  if (!Number.isFinite(celsius)) return 0;
  return celsius + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
}

/**
 * Convert Kelvin to Celsius
 */
export function kelvinToCelsius(kelvin: number): number {
  if (!Number.isFinite(kelvin)) return 0;
  return kelvin - UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
}

/**
 * Convert Kelvin to Fahrenheit
 */
export function kelvinToFahrenheit(kelvin: number): number {
  if (!Number.isFinite(kelvin)) return 32;
  const celsius = kelvin - UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
  return UNITS.TEMPERATURE.CELSIUS_TO_FAHRENHEIT(celsius);
}

/**
 * Convert Fahrenheit to Kelvin
 */
export function fahrenheitToKelvin(fahrenheit: number): number {
  if (!Number.isFinite(fahrenheit)) return UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
  const celsius = UNITS.TEMPERATURE.FAHRENHEIT_TO_CELSIUS(fahrenheit);
  return celsius + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
}

/**
 * Convert temperature between any units
 */
export function convertTemperature(
  value: number,
  from: TemperatureUnit,
  to: TemperatureUnit
): number {
  if (!Number.isFinite(value)) return 0;
  if (from === to) return value;

  // Convert to Kelvin first
  let kelvin: number;
  switch (from) {
    case 'K':
      kelvin = value;
      break;
    case 'C':
      kelvin = celsiusToKelvin(value);
      break;
    case 'F':
      kelvin = fahrenheitToKelvin(value);
      break;
    default:
      kelvin = value; // Fallback to input value
      break;
  }

  // Convert from Kelvin to target unit
  switch (to) {
    case 'K':
      return kelvin;
    case 'C':
      return kelvinToCelsius(kelvin);
    case 'F':
      return kelvinToFahrenheit(kelvin);
    default:
      return kelvin; // Fallback to Kelvin
  }
}

/**
 * Pressure conversion utilities
 */

/**
 * Convert millibars to Pascals
 */
export function millibarsToPA(millibars: number): number {
  if (!Number.isFinite(millibars)) return 0;
  return millibars * UNITS.PRESSURE.MILLIBAR_TO_PASCAL;
}

/**
 * Convert Pascals to millibars
 */
export function pascalsToMillibars(pascals: number): number {
  if (!Number.isFinite(pascals)) return 0;
  return pascals / UNITS.PRESSURE.MILLIBAR_TO_PASCAL;
}

/**
 * Convert inches of mercury to Pascals
 */
export function inchesHgToPascals(inchesHg: number): number {
  if (!Number.isFinite(inchesHg)) return 0;
  return inchesHg * UNITS.PRESSURE.INCHES_HG_TO_PASCAL;
}

/**
 * Convert atmospheres to Pascals
 */
export function atmToPascals(atm: number): number {
  if (!Number.isFinite(atm)) return 0;
  return atm * UNITS.PRESSURE.ATM_TO_PASCAL;
}

/**
 * Wind speed conversion utilities
 */

/**
 * Convert km/h to m/s
 */
export function kmhToMS(kmh: number): number {
  if (!Number.isFinite(kmh)) return 0;
  return kmh * UNITS.WIND_SPEED.KMH_TO_MS;
}

/**
 * Convert m/s to km/h
 */
export function msToKMH(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return ms / UNITS.WIND_SPEED.KMH_TO_MS;
}

/**
 * Convert knots to m/s
 */
export function knotsToMS(knots: number): number {
  if (!Number.isFinite(knots)) return 0;
  return knots * UNITS.WIND_SPEED.KNOTS_TO_MS;
}

/**
 * Convert m/s to knots
 */
export function msToKnots(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return ms / UNITS.WIND_SPEED.KNOTS_TO_MS;
}

/**
 * Convert mph to m/s
 */
export function mphToMS(mph: number): number {
  if (!Number.isFinite(mph)) return 0;
  return mph * UNITS.WIND_SPEED.MPH_TO_MS;
}

/**
 * Convert m/s to mph
 */
export function msToMPH(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return ms / UNITS.WIND_SPEED.MPH_TO_MS;
}

/**
 * Angular conversion utilities
 */

/**
 * Convert degrees to radians
 */
export function degreesToRadians(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return degrees * UNITS.ANGLE.DEGREES_TO_RADIANS;
}

/**
 * Convert radians to degrees
 */
export function radiansToDegrees(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  return radians * UNITS.ANGLE.RADIANS_TO_DEGREES;
}

/**
 * Normalize angle to 0-2π range
 */
export function normalizeAngle0To2Pi(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  let angle = radians;
  while (angle < 0) angle += 2 * Math.PI;
  while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;
  return angle;
}

/**
 * Normalize angle to -π to π range
 */
export function normalizeAnglePiToPi(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  let angle = radians;
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

/**
 * Humidity conversion utilities
 */

/**
 * Convert percentage to ratio
 */
export function percentageToRatio(percentage: number): number {
  if (!Number.isFinite(percentage)) return 0;
  return Math.max(0, Math.min(1, percentage / 100));
}

/**
 * Convert ratio to percentage
 */
export function ratioToPercentage(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(100, ratio * 100));
}

/**
 * Normalize humidity to valid ratio (0-1)
 */
export function normalizeHumidity(humidity: number): number {
  if (!Number.isFinite(humidity)) return 0.5;

  if (humidity <= 1.0) {
    // If humidity is <= 1.0, it's likely already a ratio
    return Math.max(0, Math.min(1, humidity));
  }
  // If humidity is > 1.0, it's likely a percentage, convert to ratio
  return percentageToRatio(humidity);
}

/**
 * AccuWeather-specific conversion utilities
 */

/**
 * Convert AccuWeather temperature data to Kelvin
 */
export function convertAccuWeatherTemperature(
  tempData: { Metric?: { Value?: number } } | null | undefined
): number | null {
  if (!tempData?.Metric?.Value || !Number.isFinite(tempData.Metric.Value)) {
    return null;
  }
  // AccuWeather temperatures are in Celsius, convert to Kelvin
  return celsiusToKelvin(tempData.Metric.Value);
}

/**
 * Convert AccuWeather pressure data to Pascals
 */
export function convertAccuWeatherPressure(
  pressureData: { Metric?: { Value?: number } } | null | undefined
): number | null {
  if (!pressureData?.Metric?.Value || !Number.isFinite(pressureData.Metric.Value)) {
    return null;
  }
  // AccuWeather pressure is in millibars, convert to Pascals
  return millibarsToPA(pressureData.Metric.Value);
}

/**
 * Convert AccuWeather humidity to ratio (0-1)
 */
export function convertAccuWeatherHumidity(humidity: number | null | undefined): number | null {
  if (typeof humidity !== 'number' || !Number.isFinite(humidity)) {
    return null;
  }
  // AccuWeather humidity is in percentage (0-100), convert to ratio (0-1)
  return normalizeHumidity(humidity);
}

/**
 * Convert AccuWeather wind speed data to m/s
 */
export function convertAccuWeatherWindSpeed(
  windSpeedData: { Metric?: { Value?: number } } | null | undefined
): number | null {
  if (!windSpeedData?.Metric?.Value || !Number.isFinite(windSpeedData.Metric.Value)) {
    return null;
  }
  // AccuWeather wind speed is in km/h, convert to m/s
  return kmhToMS(windSpeedData.Metric.Value);
}

/**
 * Convert AccuWeather wind direction data to radians
 */
export function convertAccuWeatherWindDirection(
  windDirData: { Degrees?: number } | null | undefined
): number | null {
  if (!windDirData?.Degrees || !Number.isFinite(windDirData.Degrees)) {
    return null;
  }
  const degrees = windDirData.Degrees;
  return degreesToRadians(degrees);
}

/**
 * Mathematical utility functions
 */

/**
 * Clamp a value between min and max bounds
 */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Check if a value is within specified bounds
 */
export function isWithinBounds(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Validate numeric input with optional bounds
 */
export function isValidNumber(value: unknown, min?: number, max?: number): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return false;
  }
  if (min !== undefined && value < min) {
    return false;
  }
  if (max !== undefined && value > max) {
    return false;
  }
  return true;
}

/**
 * Round to specified decimal places
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Calculate percentage change between two values
 */
export function percentageChange(oldValue: number, newValue: number): number {
  if (!Number.isFinite(oldValue) || !Number.isFinite(newValue) || oldValue === 0) {
    return 0;
  }
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Data validation utilities for weather measurements
 */

/**
 * Validate temperature value
 */
export function isValidTemperature(temperature: number): boolean {
  return isWithinBounds(
    temperature,
    VALIDATION_LIMITS.TEMPERATURE.MIN,
    VALIDATION_LIMITS.TEMPERATURE.MAX
  );
}

/**
 * Validate pressure value
 */
export function isValidPressure(pressure: number): boolean {
  return isWithinBounds(pressure, VALIDATION_LIMITS.PRESSURE.MIN, VALIDATION_LIMITS.PRESSURE.MAX);
}

/**
 * Validate humidity value (as ratio)
 */
export function isValidHumidity(humidity: number): boolean {
  return isWithinBounds(humidity, VALIDATION_LIMITS.HUMIDITY.MIN, VALIDATION_LIMITS.HUMIDITY.MAX);
}

/**
 * Validate wind speed
 */
export function isValidWindSpeed(windSpeed: number): boolean {
  return isWithinBounds(
    windSpeed,
    VALIDATION_LIMITS.WIND_SPEED.MIN,
    VALIDATION_LIMITS.WIND_SPEED.MAX
  );
}

/**
 * Validate wind direction (in radians)
 */
export function isValidWindDirection(windDirection: number): boolean {
  return isWithinBounds(
    windDirection,
    VALIDATION_LIMITS.WIND_DIRECTION.MIN,
    VALIDATION_LIMITS.WIND_DIRECTION.MAX
  );
}

/**
 * Validate geographic coordinates
 */
export function isValidCoordinates(latitude: number, longitude: number): boolean {
  return (
    isWithinBounds(
      latitude,
      VALIDATION_LIMITS.COORDINATES.LATITUDE.MIN,
      VALIDATION_LIMITS.COORDINATES.LATITUDE.MAX
    ) &&
    isWithinBounds(
      longitude,
      VALIDATION_LIMITS.COORDINATES.LONGITUDE.MIN,
      VALIDATION_LIMITS.COORDINATES.LONGITUDE.MAX
    )
  );
}

/**
 * Validate and sanitize weather data object
 */
export function sanitizeWeatherData<T extends Record<string, unknown>>(data: T): T {
  const sanitized = { ...data } as Record<string, unknown>;

  // Sanitize temperature fields
  Object.keys(sanitized).forEach((key) => {
    if (key.includes('temperature') || key.includes('Temperature')) {
      const value = sanitized[key];
      if (typeof value === 'number' && !isValidTemperature(value)) {
        sanitized[key] = clamp(
          value,
          VALIDATION_LIMITS.TEMPERATURE.MIN,
          VALIDATION_LIMITS.TEMPERATURE.MAX
        );
      }
    }
  });

  return sanitized as T;
}

/**
 * Advanced atmospheric calculations
 */

/**
 * Calculate saturation vapor pressure using Magnus formula
 * @param temperatureK Temperature in Kelvin
 * @returns Saturation vapor pressure in Pascals
 */
export function calculateSaturationVaporPressure(temperatureK: number): number {
  if (!Number.isFinite(temperatureK)) return 0;

  const tempC = temperatureK - UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;

  // Magnus formula constants
  const a = 17.27;
  const b = 237.7;

  // Calculate saturation vapor pressure in hPa, then convert to Pascals
  const saturationPressureHPa = 6.112 * Math.exp((a * tempC) / (b + tempC));
  return saturationPressureHPa * 100; // Convert hPa to Pascals
}

/**
 * Calculate absolute humidity from temperature and relative humidity
 * @param temperatureK Temperature in Kelvin
 * @param relativeHumidity Relative humidity as ratio (0-1)
 * @returns Absolute humidity in kg/m³
 */
export function calculateAbsoluteHumidity(temperatureK: number, relativeHumidity: number): number {
  if (!Number.isFinite(temperatureK) || !Number.isFinite(relativeHumidity)) return 0;

  const saturationPressure = calculateSaturationVaporPressure(temperatureK);
  const vaporPressure = relativeHumidity * saturationPressure;

  // Absolute humidity in kg/m³
  const absoluteHumidity = (0.002166 * vaporPressure) / temperatureK;

  return Math.max(0, absoluteHumidity);
}

/**
 * Calculate air density from temperature, pressure, and humidity
 * Enhanced formula accounting for water vapor and altitude
 * @param temperatureK Temperature in Kelvin
 * @param pressurePa Pressure in Pascals
 * @param relativeHumidity Relative humidity as ratio (0-1)
 * @returns Air density in kg/m³
 */
export function calculateAirDensity(
  temperatureK: number,
  pressurePa: number,
  relativeHumidity = 0
): number {
  if (!Number.isFinite(temperatureK) || !Number.isFinite(pressurePa)) {
    return 1.225; // Standard air density at sea level
  }

  // Gas constants (J/kg·K)
  const R_d = 287.058; // Specific gas constant for dry air
  const R_v = 461.495; // Specific gas constant for water vapor

  // Calculate saturation vapor pressure using enhanced formula
  const saturationPressure = calculateSaturationVaporPressure(temperatureK);

  // Actual vapor pressure from relative humidity
  const vaporPressure = relativeHumidity * saturationPressure;

  // Partial pressure of dry air
  const dryAirPressure = pressurePa - vaporPressure;

  // Air density calculation using ideal gas law for mixture
  // ρ = (p_d / (R_d * T)) + (p_v / (R_v * T))
  const density = dryAirPressure / (R_d * temperatureK) + vaporPressure / (R_v * temperatureK);

  // Validate result (reasonable range for Earth's atmosphere)
  if (!Number.isFinite(density) || density <= 0 || density > 2.0) {
    return 1.225; // Standard air density at sea level (15°C, 101.325 kPa)
  }

  return density;
}

/**
 * Calculate vapor pressure deficit
 * @param temperatureK Temperature in Kelvin
 * @param relativeHumidity Relative humidity as ratio (0-1)
 * @returns Vapor pressure deficit in Pascals
 */
export function calculateVaporPressureDeficit(
  temperatureK: number,
  relativeHumidity: number
): number {
  if (!Number.isFinite(temperatureK) || !Number.isFinite(relativeHumidity)) return 0;

  const saturationPressure = calculateSaturationVaporPressure(temperatureK);
  const actualVaporPressure = relativeHumidity * saturationPressure;

  return Math.max(0, saturationPressure - actualVaporPressure);
}

/**
 * Performance-optimized conversion functions for high-frequency use
 */

// Pre-calculated constants for common conversions
const C_TO_K = UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
const MB_TO_PA = UNITS.PRESSURE.MILLIBAR_TO_PASCAL;
const KMH_TO_MS = UNITS.WIND_SPEED.KMH_TO_MS;
const DEG_TO_RAD = UNITS.ANGLE.DEGREES_TO_RADIANS;

/**
 * Fast temperature conversion (Celsius to Kelvin)
 */
export function fastCelsiusToKelvin(celsius: number): number {
  return celsius + C_TO_K;
}

/**
 * Fast pressure conversion (millibars to Pascals)
 */
export function fastMillibarsToPA(mb: number): number {
  return mb * MB_TO_PA;
}

/**
 * Fast wind speed conversion (km/h to m/s)
 */
export function fastKmhToMS(kmh: number): number {
  return kmh * KMH_TO_MS;
}

/**
 * Fast angle conversion (degrees to radians)
 */
export function fastDegreesToRadians(degrees: number): number {
  return degrees * DEG_TO_RAD;
}

/**
 * Grouped exports for backward compatibility
 */
export const TemperatureConverter = {
  celsiusToKelvin,
  kelvinToCelsius,
  kelvinToFahrenheit,
  fahrenheitToKelvin,
  convertTemperature,
} as const;

export const PressureConverter = {
  millibarsToPA,
  pascalsToMillibars,
  inchesHgToPascals,
  atmToPascals,
} as const;

export const WindSpeedConverter = {
  kmhToMS,
  msToKMH,
  knotsToMS,
  msToKnots,
  mphToMS,
  msToMPH,
} as const;

export const AngleConverter = {
  degreesToRadians,
  radiansToDegrees,
  normalizeAngle0To2Pi,
  normalizeAnglePiToPi,
} as const;

export const HumidityConverter = {
  percentageToRatio,
  ratioToPercentage,
  normalizeHumidity,
} as const;

export const AccuWeatherConverter = {
  convertTemperature: convertAccuWeatherTemperature,
  convertPressure: convertAccuWeatherPressure,
  convertHumidity: convertAccuWeatherHumidity,
  convertWindSpeed: convertAccuWeatherWindSpeed,
  convertWindDirection: convertAccuWeatherWindDirection,
} as const;

export const MathUtils = {
  clamp,
  isWithinBounds,
  isValidNumber,
  roundTo,
  percentageChange,
} as const;

export const WeatherValidator = {
  isValidTemperature,
  isValidPressure,
  isValidHumidity,
  isValidWindSpeed,
  isValidWindDirection,
  isValidCoordinates,
  sanitizeWeatherData,
} as const;

export const AtmosphericCalculations = {
  calculateSaturationVaporPressure,
  calculateAbsoluteHumidity,
  calculateAirDensity,
  calculateVaporPressureDeficit,
} as const;

export const FastConverters = {
  fastCelsiusToKelvin,
  fastMillibarsToPA,
  fastKmhToMS,
  fastDegreesToRadians,
} as const;

/**
 * Wind classification utilities
 */

/**
 * Beaufort scale thresholds (wind speed in m/s)
 */
const BEAUFORT_THRESHOLDS = [
  { max: 0.3, scale: 0 }, // Calm
  { max: 1.6, scale: 1 }, // Light air
  { max: 3.4, scale: 2 }, // Light breeze
  { max: 5.5, scale: 3 }, // Gentle breeze
  { max: 8.0, scale: 4 }, // Moderate breeze
  { max: 10.8, scale: 5 }, // Fresh breeze
  { max: 13.9, scale: 6 }, // Strong breeze
  { max: 17.2, scale: 7 }, // Near gale
  { max: 20.8, scale: 8 }, // Gale
  { max: 24.5, scale: 9 }, // Severe gale
  { max: 28.5, scale: 10 }, // Storm
  { max: 32.7, scale: 11 }, // Violent storm
] as const;

/**
 * Calculate Beaufort wind scale from wind speed
 * @param windSpeed Wind speed in m/s
 * @param gustSpeed Optional gust speed in m/s (uses higher of the two)
 * @returns Beaufort scale (0-12)
 */
export function calculateBeaufortScale(windSpeed: number, gustSpeed?: number): number {
  // Use the higher of sustained or gust speed for classification
  const effectiveWindSpeed = gustSpeed !== undefined ? Math.max(windSpeed, gustSpeed) : windSpeed;

  if (!Number.isFinite(effectiveWindSpeed) || effectiveWindSpeed < 0) {
    return 0;
  }

  for (const threshold of BEAUFORT_THRESHOLDS) {
    if (effectiveWindSpeed < threshold.max) {
      return threshold.scale;
    }
  }

  return 12; // Hurricane
}

export const WindClassification = {
  calculateBeaufortScale,
} as const;
