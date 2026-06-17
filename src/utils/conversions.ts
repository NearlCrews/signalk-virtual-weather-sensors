import type { Timestamp } from '@signalk/server-api';
import { API_QUOTA, MAGNUS, UNITS, VALIDATION_LIMITS } from '../constants/index.js';

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

/**
 * Milliseconds elapsed from a stored epoch timestamp to now, clamped at zero so
 * a backward wall-clock or NTP jump cannot surface a negative age. Returns null
 * when `sinceMs` is null (nothing recorded yet). Shared by the service-level
 * data-age accessors so the clamp rationale lives in one place.
 */
export function elapsedSinceMs(sinceMs: number | null): number | null {
  return sinceMs === null ? null : Math.max(0, Date.now() - sinceMs);
}

/**
 * Narrow an arbitrary value to `number`, returning `undefined` for anything
 * non-numeric (missing, null, string). API response fields typed `number` are
 * known to arrive null on the free tier and partial responses, so callers use
 * this before spreading an optional field onto an output object.
 */
export function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** Return the value when it is a string, otherwise an empty string. */
export function asStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * True when rolling-window API usage has reached `ratio` of the daily quota cap.
 * A quota of 0, undefined, or any non-positive or non-finite value disables the
 * cap and always returns false. `ratio` defaults to the exhaustion threshold;
 * pass `API_QUOTA.WARN_RATIO` for the banner warning gate. Shared by
 * WeatherService (status banner and fetch pause) and AccuWeatherService
 * (forecast self-gating) so the cap logic cannot drift.
 */
export function isApiQuotaReached(
  used: number,
  quota: number | undefined,
  ratio: number = API_QUOTA.EXHAUST_RATIO
): boolean {
  if (quota == null || !Number.isFinite(quota) || quota <= 0) return false;
  return used / quota >= ratio;
}

/** Fahrenheit to Celsius. Behaviour, not data, so it lives here, not in `UNITS`. */
const fahrenheitToCelsius = (fahrenheit: number): number => ((fahrenheit - 32) * 5) / 9;
/** Celsius to Fahrenheit. */
const celsiusToFahrenheit = (celsius: number): number => (celsius * 9) / 5 + 32;

/**
 * Celsius to Kelvin. Non-finite input returns the 0°C-equivalent
 * (`CELSIUS_TO_KELVIN`), matching the 0°C-equivalent fallback the sibling
 * temperature converters use rather than flooring garbage to absolute zero.
 */
export function celsiusToKelvin(celsius: number): number {
  if (!Number.isFinite(celsius)) return UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
  return celsius + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
}

export function kelvinToCelsius(kelvin: number): number {
  if (!Number.isFinite(kelvin)) return 0;
  return kelvin - UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
}

export function kelvinToFahrenheit(kelvin: number): number {
  if (!Number.isFinite(kelvin)) return celsiusToFahrenheit(0);
  const celsius = kelvin - UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
  return celsiusToFahrenheit(celsius);
}

export function fahrenheitToKelvin(fahrenheit: number): number {
  if (!Number.isFinite(fahrenheit)) return UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
  const celsius = fahrenheitToCelsius(fahrenheit);
  return celsius + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
}

export function millibarsToPA(millibars: number): number {
  if (!Number.isFinite(millibars)) return 0;
  return millibars * UNITS.PRESSURE.MILLIBAR_TO_PASCAL;
}

/** Inverse of {@link millibarsToPA}. 1 hPa = 1 millibar, so this also yields hPa. */
export function pascalsToMillibars(pascals: number): number {
  if (!Number.isFinite(pascals)) return 0;
  return pascals / UNITS.PRESSURE.MILLIBAR_TO_PASCAL;
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

/** Normalize angle to (-π, π]. The lower bound -π is exclusive: ±π, and any odd multiple of π, map to +π. */
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

/**
 * Inclusive numeric range check that also rejects non-finite inputs. Building
 * block for the `isValid*` wrappers below.
 *
 * @internal Exported only so the conversions test suite can exercise the
 *           primitive directly. External callers should use the domain-specific
 *           `isValid*` wrappers.
 */
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

export function isValidVesselSpeed(speed: number): boolean {
  return isWithinBounds(
    speed,
    VALIDATION_LIMITS.VESSEL_SPEED.MIN,
    VALIDATION_LIMITS.VESSEL_SPEED.MAX
  );
}

/** Valid compass angle in radians [0, 2π]. Covers course, heading, and wind direction. */
export function isValidBearing(radians: number): boolean {
  return isWithinBounds(
    radians,
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
 * coefficients (`MAGNUS.A`, `MAGNUS.B`, `MAGNUS.C`) live in `constants/index.ts`.
 * @param temperatureK Temperature in Kelvin
 * @returns Saturation vapor pressure in Pascals
 *
 * @internal Exported only so the conversions test suite can exercise the
 *           helper directly. External callers reach this through the
 *           `calculateAbsoluteHumidity` and `calculateAirDensity` wrappers.
 */
export function calculateSaturationVaporPressure(temperatureK: number): number {
  if (!Number.isFinite(temperatureK)) return 0;
  const tempC = kelvinToCelsius(temperatureK);
  const saturationPressureHPa = MAGNUS.C * Math.exp((MAGNUS.A * tempC) / (MAGNUS.B + tempC));
  return saturationPressureHPa * UNITS.PRESSURE.MILLIBAR_TO_PASCAL;
}

/** Molar mass of water vapour divided by the universal gas constant (kg·K/J). */
const WATER_VAPOR_DENSITY_CONSTANT = 0.002166;

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

  const absoluteHumidity = (WATER_VAPOR_DENSITY_CONSTANT * vaporPressure) / temperatureK;

  return Math.max(0, absoluteHumidity);
}

/** Specific gas constant for dry air (J/kg·K). */
const DRY_AIR_GAS_CONSTANT = 287.058;
/** Specific gas constant for water vapour (J/kg·K). */
const WATER_VAPOUR_GAS_CONSTANT = 461.495;
/** Standard air density at sea level (15°C, 101.325 kPa), in kg/m³. */
const STANDARD_AIR_DENSITY = 1.225;

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
    return STANDARD_AIR_DENSITY;
  }

  const saturationPressure = calculateSaturationVaporPressure(temperatureK);
  const vaporPressure = relativeHumidity * saturationPressure;
  const dryAirPressure = pressurePa - vaporPressure;

  // Ideal gas law for a dry-air + water-vapour mixture:
  // ρ = p_d / (R_d · T) + p_v / (R_v · T)
  const density =
    dryAirPressure / (DRY_AIR_GAS_CONSTANT * temperatureK) +
    vaporPressure / (WATER_VAPOUR_GAS_CONSTANT * temperatureK);

  // Reject results outside the plausible range for Earth's atmosphere.
  if (!Number.isFinite(density) || density <= 0 || density > 2.0) {
    return STANDARD_AIR_DENSITY;
  }

  return density;
}

/**
 * Truncate a string to at most `maxCodePoints` Unicode code points. Walks code
 * points (via Array.from) so a surrogate pair at the boundary is never split
 * into a lone surrogate that would break a JSON-encoded downstream consumer.
 */
export function truncateToCodePoints(value: string, maxCodePoints: number): string {
  // UTF-16 length is an upper bound on code-point count, so a short string can
  // skip the code-point array allocation entirely.
  if (value.length <= maxCodePoints) return value;
  const points = Array.from(value);
  return points.length <= maxCodePoints ? value : points.slice(0, maxCodePoints).join('');
}

/**
 * Beaufort scale ceiling speeds in m/s, indexed by Beaufort number (0..11).
 * `windSpeed < BEAUFORT_THRESHOLDS[i]` activates scale `i`; anything above the
 * last ceiling is hurricane (12).
 */
const BEAUFORT_THRESHOLDS: ReadonlyArray<number> = [
  0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7,
];

/** Calculate the Beaufort wind force (0..12) from sustained wind speed in m/s. */
export function calculateBeaufortScale(windSpeed: number): number {
  if (!Number.isFinite(windSpeed) || windSpeed < 0) {
    return 0;
  }

  for (let i = 0; i < BEAUFORT_THRESHOLDS.length; i++) {
    if (windSpeed < (BEAUFORT_THRESHOLDS[i] as number)) {
      return i;
    }
  }

  return 12;
}

/**
 * US military WBGT flag cutoffs in Celsius (green, yellow, red, black). A
 * precautionary bias on a crew-safety index favours these standard flag values
 * over looser bands that would activate each warning roughly 0.5 to 1.5 C late.
 */
const WBGT_FLAG_CUTOFFS_C = {
  GREEN: 26.7,
  YELLOW: 27.8,
  RED: 29.4,
  BLACK: 32.2,
} as const;

/**
 * Heat-stress index (0 low to 4 extreme) from wet-bulb globe temperature in
 * Kelvin, banded on the WBGT military flags. Shared by every provider so the
 * heat-stress notification band behaves identically regardless of source.
 */
export function calculateHeatStressIndex(wetBulbGlobeTemperatureK: number): number {
  const wbgtC = kelvinToCelsius(wetBulbGlobeTemperatureK);
  if (wbgtC < WBGT_FLAG_CUTOFFS_C.GREEN) return 0;
  if (wbgtC < WBGT_FLAG_CUTOFFS_C.YELLOW) return 1;
  if (wbgtC < WBGT_FLAG_CUTOFFS_C.RED) return 2;
  if (wbgtC < WBGT_FLAG_CUTOFFS_C.BLACK) return 3;
  return 4;
}

/**
 * Estimate wet-bulb globe temperature (Kelvin) from air temperature and
 * relative humidity using the Australian Bureau of Meteorology simplified shade
 * approximation. Providers that do not supply a measured WBGT (Open-Meteo) use
 * this so the heat-stress band still functions. It is a SHADE estimate with no
 * direct-solar or wind term, so it reads conservatively low relative to a full
 * outdoor WBGT under strong sun.
 *
 *   WBGT = 0.567·Ta + 0.393·e + 3.94   (Ta in C, e = vapour pressure in hPa)
 *   e = RH · 6.105 · exp(17.27·Ta / (237.7 + Ta))   (RH as ratio 0..1)
 *
 * Reference: Australian Bureau of Meteorology, "Thermal Comfort observations".
 */
export function estimateWetBulbGlobeTemperature(
  temperatureK: number,
  relativeHumidity: number
): number {
  const ta = kelvinToCelsius(temperatureK);
  const vapourPressure = relativeHumidity * 6.105 * Math.exp((17.27 * ta) / (237.7 + ta));
  const wbgtC = 0.567 * ta + 0.393 * vapourPressure + 3.94;
  return celsiusToKelvin(wbgtC);
}
