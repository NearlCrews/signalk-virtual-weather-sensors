import { MAGNUS, UNITS, VALIDATION_LIMITS } from '../constants/index.js';

/** Extract a string message from any thrown value: `Error.message` or `String(value)`. */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const TWO_PI = 2 * Math.PI;

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
 * Pressure conversion utilities
 */

/** Convert millibars to Pascals. */
export function millibarsToPA(millibars: number): number {
  if (!Number.isFinite(millibars)) return 0;
  return millibars * UNITS.PRESSURE.MILLIBAR_TO_PASCAL;
}

/** Convert km/h to m/s. */
export function kmhToMS(kmh: number): number {
  if (!Number.isFinite(kmh)) return 0;
  return kmh * UNITS.WIND_SPEED.KMH_TO_MS;
}

/** Convert m/s to km/h. */
export function msToKMH(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return ms / UNITS.WIND_SPEED.KMH_TO_MS;
}

/** Convert m/s to knots. */
export function msToKnots(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return ms / UNITS.WIND_SPEED.KNOTS_TO_MS;
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
 * Normalize angle to [0, 2π) range
 */
export function normalizeAngle0To2Pi(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  return ((radians % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * Normalize angle to (-π, π] range
 */
export function normalizeAnglePiToPi(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  const wrapped = (((radians + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI;
  // wrapped is in [0, 2π); shift to (-π, π]. Map exact 0 → π so behavior matches the
  // legacy while-loop form which never returned -π.
  return wrapped === 0 ? Math.PI : wrapped - Math.PI;
}

/**
 * Humidity conversion utilities
 */

/**
 * Clamp a value between min and max bounds. Non-finite input clamps to `min`.
 */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/** Convert percentage (0-100) to ratio (0-1). */
export function percentageToRatio(percentage: number): number {
  return clamp(percentage / 100, 0, 1);
}

/** Convert ratio (0-1) to percentage (0-100). */
export function ratioToPercentage(ratio: number): number {
  return clamp(ratio * 100, 0, 100);
}

/**
 * Check if a value is within specified bounds
 */
export function isWithinBounds(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/** Validate temperature value. */
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

/** Beaufort scale thresholds (wind speed in m/s). */
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
