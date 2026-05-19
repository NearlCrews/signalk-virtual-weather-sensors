import {
  API_KEY_MIN_LENGTH,
  BEAUFORT_LIMITS,
  CLOUD_CEILING_LIMITS_M,
  CONFIG_DEFAULTS,
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
  isValidHumidity,
  isValidPressure,
  isValidTemperature,
  isValidWindDirection,
  isValidWindSpeed,
  isWithinBounds,
  normalizeAngle0To2Pi,
  normalizeAnglePiToPi,
  TWO_PI,
} from './conversions.js';

/** Re-export so callers outside this module don't need to know it lives in the shared JS module. */
export { API_KEY_MIN_LENGTH };

/** NMEA2000 temperature bounds expressed in Kelvin (precomputed to avoid C↔K work on the hot path). */
const NMEA2000_TEMP_K_MIN = celsiusToKelvin(NMEA2000_LIMITS.TEMPERATURE_C.MIN);
const NMEA2000_TEMP_K_MAX = celsiusToKelvin(NMEA2000_LIMITS.TEMPERATURE_C.MAX);

/**
 * Top-level fields checked for presence on an AccuWeather current-conditions
 * response. Temperature, Pressure, and DewPoint are validated more deeply by
 * `validateMetricNumber` (presence plus a numeric `Metric.Value`), so they are
 * not duplicated here.
 */
const REQUIRED_ACCUWEATHER_FIELDS: ReadonlyArray<string> = [
  'LocalObservationDateTime',
  'RelativeHumidity',
  'Wind',
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
 * Push a "required and must be a finite number" error for a missing or
 * non-finite numeric field, and narrow the value to `number` when present.
 */
function requireFiniteField(
  value: number | undefined,
  name: string,
  errors: string[]
): value is number {
  if (value === undefined || !Number.isFinite(value)) {
    errors.push(`${name} is required and must be a finite number`);
    return false;
  }
  return true;
}

function validateTemperatureField(
  data: Partial<WeatherData>,
  errors: string[],
  warnings: string[]
): void {
  if (!requireFiniteField(data.temperature, 'Temperature', errors)) return;

  if (!isValidTemperature(data.temperature)) {
    warnings.push(
      `Temperature ${data.temperature}K is outside expected range (${VALIDATION_LIMITS.TEMPERATURE.MIN}-${VALIDATION_LIMITS.TEMPERATURE.MAX}K)`
    );
  }
}

function validatePressureField(
  data: Partial<WeatherData>,
  errors: string[],
  warnings: string[]
): void {
  if (!requireFiniteField(data.pressure, 'Pressure', errors)) return;

  if (!isValidPressure(data.pressure)) {
    warnings.push(
      `Pressure ${data.pressure}Pa is outside expected range (${VALIDATION_LIMITS.PRESSURE.MIN}-${VALIDATION_LIMITS.PRESSURE.MAX}Pa)`
    );
  }
}

function validateHumidityField(data: Partial<WeatherData>, errors: string[]): void {
  if (!requireFiniteField(data.humidity, 'Humidity', errors)) return;

  if (!isValidHumidity(data.humidity)) {
    errors.push(
      `Humidity ${data.humidity} must be between ${VALIDATION_LIMITS.HUMIDITY.MIN} and ${VALIDATION_LIMITS.HUMIDITY.MAX}`
    );
  }
}

function validateWindFields(
  data: Partial<WeatherData>,
  errors: string[],
  warnings: string[]
): void {
  if (
    requireFiniteField(data.windSpeed, 'Wind speed', errors) &&
    !isValidWindSpeed(data.windSpeed)
  ) {
    warnings.push(
      `Wind speed ${data.windSpeed}m/s is outside expected range (${VALIDATION_LIMITS.WIND_SPEED.MIN}-${VALIDATION_LIMITS.WIND_SPEED.MAX}m/s)`
    );
  }

  if (
    requireFiniteField(data.windDirection, 'Wind direction', errors) &&
    !isValidWindDirection(data.windDirection)
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
 * Range rule for one numeric config field. A sub-`min` value is a hard error;
 * an above-`max` value is a warning, not an error: the admin UI schema in
 * `index.ts` already enforces the tighter bounds, and `sanitizeConfiguration`
 * clamps the runtime value, so the warning is advisory tolerance for
 * hand-edited plugin config.
 */
interface NumericConfigRule {
  readonly key: 'updateFrequency' | 'emissionInterval' | 'dailyApiQuota';
  readonly notFiniteError: string;
  readonly min: number;
  readonly belowMinError: string;
  readonly max: number;
  readonly aboveMaxWarning: string;
}

const NUMERIC_CONFIG_RULES: ReadonlyArray<NumericConfigRule> = [
  {
    key: 'updateFrequency',
    notFiniteError: 'Update frequency must be a finite number',
    min: 1,
    belowMinError: 'Update frequency must be at least 1 minute',
    max: 60,
    aboveMaxWarning: 'Update frequency over 60 minutes may result in stale data',
  },
  {
    key: 'emissionInterval',
    notFiniteError: 'Emission interval must be a finite number',
    min: 1,
    belowMinError: 'Emission interval must be at least 1 second',
    max: 60,
    aboveMaxWarning: 'Emission interval over 60 seconds may not be suitable for real-time NMEA2000',
  },
  {
    key: 'dailyApiQuota',
    notFiniteError: 'Daily API quota must be a finite number',
    min: 0,
    belowMinError: 'Daily API quota must be 0 or greater (0 disables the cap)',
    max: DEFAULT_CONFIG.DAILY_API_QUOTA_MAX,
    aboveMaxWarning: `Daily API quota over ${DEFAULT_CONFIG.DAILY_API_QUOTA_MAX} is unusual; clamping to ${DEFAULT_CONFIG.DAILY_API_QUOTA_MAX}`,
  },
];

function validateNumericConfigField(
  config: Partial<PluginConfiguration>,
  rule: NumericConfigRule,
  errors: string[],
  warnings: string[]
): void {
  const value = config[rule.key];
  if (value === undefined) return;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(rule.notFiniteError);
    return;
  }

  if (value < rule.min) {
    errors.push(rule.belowMinError);
  } else if (value > rule.max) {
    warnings.push(rule.aboveMaxWarning);
  }
}

/**
 * Validate complete plugin configuration
 */
export function validateConfiguration(config: Partial<PluginConfiguration>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  validateApiKey(config, errors, warnings);
  for (const rule of NUMERIC_CONFIG_RULES) {
    validateNumericConfigField(config, rule, errors, warnings);
  }

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
 * Sanitize and normalize configuration with defaults. All numeric fields use
 * `??` (not `||`) so an explicit 0 (the documented "no cap" sentinel for
 * `dailyApiQuota`) survives the coercion. The lower-bound clamp catches any
 * invalid sub-min value that slips past the validator.
 */
export function sanitizeConfiguration(config: Partial<PluginConfiguration>): PluginConfiguration {
  return {
    accuWeatherApiKey: config.accuWeatherApiKey?.trim() || '',
    updateFrequency: clamp(
      config.updateFrequency ?? DEFAULT_CONFIG.UPDATE_FREQUENCY,
      CONFIG_DEFAULTS.UPDATE_FREQUENCY_MIN,
      CONFIG_DEFAULTS.UPDATE_FREQUENCY_MAX
    ),
    emissionInterval: clamp(
      config.emissionInterval ?? DEFAULT_CONFIG.EMISSION_INTERVAL,
      CONFIG_DEFAULTS.EMISSION_INTERVAL_MIN,
      CONFIG_DEFAULTS.EMISSION_INTERVAL_MAX
    ),
    dailyApiQuota: clamp(
      config.dailyApiQuota ?? DEFAULT_CONFIG.DAILY_API_QUOTA,
      CONFIG_DEFAULTS.DAILY_API_QUOTA_MIN,
      CONFIG_DEFAULTS.DAILY_API_QUOTA_MAX
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
 * Validate that `container[key]` exists with a numeric `Metric.Value`.
 * `transformWeatherData` dereferences these without guarding, so a missing or
 * malformed block must fail validation here rather than throw downstream.
 * `label` prefixes the error message (e.g. `Wind.Speed`).
 */
function validateMetricNumber(
  container: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[]
): void {
  const block = container[key];
  if (!block || typeof block !== 'object') {
    errors.push(`${label} is required`);
    return;
  }

  const metric = (block as Record<string, unknown>).Metric;
  if (!metric || typeof metric !== 'object') {
    errors.push(`${label}.Metric is required`);
    return;
  }

  if (typeof (metric as Record<string, unknown>).Value !== 'number') {
    errors.push(`${label}.Metric.Value must be a number`);
  }
}

/**
 * Validate the Wind block: speed needs a numeric `Metric.Value`, direction
 * needs numeric `Degrees`. `transformWeatherData` dereferences both without
 * guarding, so a malformed block must fail validation rather than throw.
 */
function validateWindStructure(data: Record<string, unknown>, errors: string[]): void {
  if (!data.Wind || typeof data.Wind !== 'object') return;

  const wind = data.Wind as Record<string, unknown>;
  validateMetricNumber(wind, 'Speed', 'Wind.Speed', errors);

  const direction = wind.Direction;
  if (!direction || typeof direction !== 'object') {
    errors.push('Wind.Direction is required');
  } else if (typeof (direction as Record<string, unknown>).Degrees !== 'number') {
    errors.push('Wind.Direction.Degrees must be a number');
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
  validateMetricNumber(data, 'Temperature', 'Temperature', errors);
  validateMetricNumber(data, 'Pressure', 'Pressure', errors);
  validateMetricNumber(data, 'DewPoint', 'DewPoint', errors);
  validateWindStructure(data, errors);
  if ('RelativeHumidity' in data && typeof data.RelativeHumidity !== 'number') {
    errors.push('RelativeHumidity must be a number');
  }

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
 * Numeric WeatherData fields that the mapper emits. Excludes any field whose
 * sanitization is non-numeric (angles handled separately).
 */
type SanitizableNumericKey = {
  [K in keyof WeatherData]-?: WeatherData[K] extends number | undefined ? K : never;
}[keyof WeatherData];

const TEMP_K_BOUNDS = [NMEA2000_TEMP_K_MIN, NMEA2000_TEMP_K_MAX] as const;
const WIND_SPEED_BOUNDS = [0, NMEA2000_LIMITS.WIND_SPEED_MAX_MS] as const;
const HUMIDITY_BOUNDS = [VALIDATION_LIMITS.HUMIDITY.MIN, VALIDATION_LIMITS.HUMIDITY.MAX] as const;

/**
 * Single source of truth for every numeric leaf the mapper can emit. Adding a
 * new emitted field means appending one row here; both the fast-path range
 * check and the clamping pass walk this table so they cannot drift.
 *
 * Angles (`windDirection`, `apparentWindAngle`) are NOT in this table because
 * they need wrap-around normalization, not clamping. They are handled inline
 * by `isWithinNMEA2000Ranges` and `sanitizeForNMEA2000` (via
 * `normalizeAngle0To2Pi` / `normalizeAnglePiToPi`).
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
  ['realFeel', ...TEMP_K_BOUNDS],
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
  // Derived values computed by this plugin from already-validated inputs.
  // Bounds are wide enough to never clamp a meteorologically plausible value
  // but tight enough to catch obvious numerical garbage (NaN propagation,
  // upstream-poisoned inputs that slipped past earlier validation).
  ['absoluteHumidity', 0, 0.1], // kg/m³; saturated air at 50 C is ~0.083
  ['airDensityEnhanced', 0.5, 2.0], // kg/m³; standard sea-level 1.225
  ['windGustFactor', 0, 10], // dimensionless; typical 1.0..2.0, hurricane spikes can reach 3..4
  ['temperatureDeparture24h', -50, 50], // K (as delta); ±50 covers any Earth-realistic 24h change
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
 * port-negative convention for `environment.weather.windAngleApparent`.
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
  sanitizeForNMEA2000,
} as const;
