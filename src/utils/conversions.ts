import type { Timestamp } from '@signalk/server-api';
import { MAGNUS, UNITS, VALIDATION_LIMITS } from '../constants/index.js';

/** Extract a string message from any thrown value: `Error.message` or `String(value)`. */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Cast a plain ISO 8601 string to the branded `@signalk/server-api` Timestamp type. */
export const asTimestamp = (ts: string): Timestamp => ts as Timestamp;

/** 2π precomputed: shared by angle normalizers and the NMEA2000 sanitizer. */
export const TWO_PI = 2 * Math.PI;

/** Floor-divide a millisecond duration to whole minutes. */
export function msToWholeMinutes(ms: number): number {
  return Math.floor(ms / 60_000);
}

export function celsiusToKelvin(celsius: number): number {
  if (!Number.isFinite(celsius)) return 0;
  return celsius + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
}

export function kelvinToCelsius(kelvin: number): number {
  if (!Number.isFinite(kelvin)) return 0;
  return kelvin - UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
}

export function kelvinToFahrenheit(kelvin: number): number {
  if (!Number.isFinite(kelvin)) return 32;
  const celsius = kelvin - UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
  return UNITS.TEMPERATURE.CELSIUS_TO_FAHRENHEIT(celsius);
}

export function fahrenheitToKelvin(fahrenheit: number): number {
  if (!Number.isFinite(fahrenheit)) return UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
  const celsius = UNITS.TEMPERATURE.FAHRENHEIT_TO_CELSIUS(fahrenheit);
  return celsius + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
}

export function millibarsToPA(millibars: number): number {
  if (!Number.isFinite(millibars)) return 0;
  return millibars * UNITS.PRESSURE.MILLIBAR_TO_PASCAL;
}

export function kmhToMS(kmh: number): number {
  if (!Number.isFinite(kmh)) return 0;
  return kmh * UNITS.WIND_SPEED.KMH_TO_MS;
}

export function msToKMH(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return ms / UNITS.WIND_SPEED.KMH_TO_MS;
}

export function msToKnots(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return ms / UNITS.WIND_SPEED.KNOTS_TO_MS;
}

export function degreesToRadians(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return degrees * UNITS.ANGLE.DEGREES_TO_RADIANS;
}

export function radiansToDegrees(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  return radians * UNITS.ANGLE.RADIANS_TO_DEGREES;
}

/** Normalize angle to [0, 2π) range. */
export function normalizeAngle0To2Pi(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  return ((radians % TWO_PI) + TWO_PI) % TWO_PI;
}

/** Normalize angle to (-π, π] range. Exact 0 maps to π to match the legacy while-loop behaviour. */
export function normalizeAnglePiToPi(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  const wrapped = (((radians + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI;
  return wrapped === 0 ? Math.PI : wrapped - Math.PI;
}

/** Clamp a value between min and max bounds. Non-finite input clamps to `min`. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function percentageToRatio(percentage: number): number {
  return clamp(percentage / 100, 0, 1);
}

export function ratioToPercentage(ratio: number): number {
  return clamp(ratio * 100, 0, 100);
}

export function isWithinBounds(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

export function isValidTemperature(temperature: number): boolean {
  return isWithinBounds(
    temperature,
    VALIDATION_LIMITS.TEMPERATURE.MIN,
    VALIDATION_LIMITS.TEMPERATURE.MAX
  );
}

export function isValidPressure(pressure: number): boolean {
  return isWithinBounds(pressure, VALIDATION_LIMITS.PRESSURE.MIN, VALIDATION_LIMITS.PRESSURE.MAX);
}

export function isValidHumidity(humidity: number): boolean {
  return isWithinBounds(humidity, VALIDATION_LIMITS.HUMIDITY.MIN, VALIDATION_LIMITS.HUMIDITY.MAX);
}

export function isValidWindSpeed(windSpeed: number): boolean {
  return isWithinBounds(
    windSpeed,
    VALIDATION_LIMITS.WIND_SPEED.MIN,
    VALIDATION_LIMITS.WIND_SPEED.MAX
  );
}

export function isValidWindDirection(windDirection: number): boolean {
  return isWithinBounds(
    windDirection,
    VALIDATION_LIMITS.WIND_DIRECTION.MIN,
    VALIDATION_LIMITS.WIND_DIRECTION.MAX
  );
}

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
 * Advanced atmospheric calculations
 */

/**
 * Saturation vapour pressure via the August-Roche-Magnus formula. The Magnus
 * coefficients (`MAGNUS.A`, `MAGNUS.B`, `MAGNUS.C`) live in `constants/index.ts`
 * so `WindCalculator.calculateDewPoint` and this function share the same
 * physical constants.
 * @param temperatureK Temperature in Kelvin
 * @returns Saturation vapor pressure in Pascals
 */
export function calculateSaturationVaporPressure(temperatureK: number): number {
  if (!Number.isFinite(temperatureK)) return 0;
  const tempC = temperatureK - UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
  const saturationPressureHPa = MAGNUS.C * Math.exp((MAGNUS.A * tempC) / (MAGNUS.B + tempC));
  return saturationPressureHPa * 100;
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
 * Beaufort scale ceiling speeds in m/s, indexed by Beaufort number (0..11).
 * `effectiveWindSpeed < BEAUFORT_THRESHOLDS[i]` activates scale `i`; anything
 * above the last ceiling is hurricane (12).
 */
const BEAUFORT_THRESHOLDS: ReadonlyArray<number> = [
  0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7,
];

/**
 * Calculate Beaufort wind scale from sustained wind speed, taking the higher
 * of sustained and gust when both are provided.
 */
export function calculateBeaufortScale(windSpeed: number, gustSpeed?: number): number {
  const effectiveWindSpeed = gustSpeed !== undefined ? Math.max(windSpeed, gustSpeed) : windSpeed;

  if (!Number.isFinite(effectiveWindSpeed) || effectiveWindSpeed < 0) {
    return 0;
  }

  for (let i = 0; i < BEAUFORT_THRESHOLDS.length; i++) {
    if (effectiveWindSpeed < (BEAUFORT_THRESHOLDS[i] as number)) {
      return i;
    }
  }

  return 12;
}
