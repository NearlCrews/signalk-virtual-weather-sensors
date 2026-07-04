/**
 * Pure AccuWeather current-conditions to internal SI `WeatherData` mapping.
 *
 * Parallels `mapOpenMeteoCurrentToWeatherData` in `OpenMeteoMapper.ts` so the
 * two providers produce the same `WeatherData` shape and everything downstream
 * (path mapper, notifier, PGN bridge) stays provider-agnostic. AccuWeather
 * carries more optional fields than Open-Meteo (RealFeel, wet-bulb, pressure
 * tendency, precipitation type, ceiling, visibility obstruction, 24h
 * departure), each decoded only when the response carries it. Wind chill falls
 * back to the Environment Canada formula when absent, and heat index is always
 * computed (NWS Rothfusz). This mapper handles CURRENT conditions only and
 * converts wind inline with `kmhToMS`; validation stays in the service, which
 * runs `validateWeatherData` on this mapper's output.
 *
 * Base-derived fields come from the shared `deriveBaseWeatherFields`, the same
 * assembly Open-Meteo and Met.no use; the one AccuWeather twist is that a
 * measured WindChillTemperature, when present, overrides the helper's
 * Environment Canada wind-chill formula.
 */

import { deriveBaseWeatherFields } from '../calculators/deriveWeatherFields.js';
import { ACCUWEATHER, UNITS } from '../constants/index.js';
import { accuWeatherSevereCondition } from '../providers/accuweather-severity.js';
import type { AccuWeatherCurrentConditions, WeatherData } from '../types/index.js';
import {
  asOptionalNumber,
  calculateGustFactor,
  calculateHeatStressIndex,
  celsiusToKelvin,
  degreesToRadians,
  kmhToMS,
  millibarsToPA,
  normalizeAngle0To2Pi,
  optionalCelsiusToKelvin,
  optionalPercentageToRatio,
  percentageToRatio,
  truncateToCodePoints,
} from '../utils/conversions.js';

/**
 * Strip control characters and truncate a string from the API to a safe length
 * for downstream consumers. Truncation walks code points (via `Array.from`)
 * so a surrogate-pair character (emoji, CJK supplementary) at the boundary
 * cannot leave a lone surrogate that breaks JSON-encoded downstream consumers.
 * The runtime `typeof` guard catches real-world API responses where a field
 * typed `string` arrives as null/undefined/number; the response schema is a
 * contract for what we use, not a guarantee the wire matches it.
 */
function capString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately stripping injection vectors
  const stripped = value.replace(/[\x00-\x1f\x7f]/g, '');
  return truncateToCodePoints(stripped, maxLength);
}

/**
 * Decode the optional enhanced-temperature fields, all in Kelvin. Free-tier
 * keys and partial responses omit some or all of these blocks, so each is
 * optional-chained; the result carries only the keys that were present.
 */
function extractEnhancedTemperatures(
  conditions: AccuWeatherCurrentConditions
): Partial<WeatherData> {
  const realFeel = optionalCelsiusToKelvin(conditions.RealFeelTemperature?.Metric?.Value);
  const realFeelShade = optionalCelsiusToKelvin(conditions.RealFeelTemperatureShade?.Metric?.Value);
  const wetBulbTemperature = optionalCelsiusToKelvin(conditions.WetBulbTemperature?.Metric?.Value);
  const wetBulbGlobeTemperature = optionalCelsiusToKelvin(
    conditions.WetBulbGlobeTemperature?.Metric?.Value
  );
  const apparentTemperature = optionalCelsiusToKelvin(
    conditions.ApparentTemperature?.Metric?.Value
  );
  return {
    ...(realFeel !== undefined && { realFeel }),
    ...(realFeelShade !== undefined && { realFeelShade }),
    ...(wetBulbTemperature !== undefined && { wetBulbTemperature }),
    ...(wetBulbGlobeTemperature !== undefined && { wetBulbGlobeTemperature }),
    ...(apparentTemperature !== undefined && { apparentTemperature }),
  };
}

/**
 * Decode the optional non-temperature enhanced fields (gust, visibility,
 * ceiling, precipitation, 24h departure, weather icon). Each block is
 * optional-chained; the result carries only the keys that were present.
 */
function extractEnhancedConditions(
  conditions: AccuWeatherCurrentConditions,
  windSpeed: number
): Partial<WeatherData> {
  const rawWindGustKmh = asOptionalNumber(conditions.WindGust?.Speed?.Metric?.Value);
  const windGustSpeed = rawWindGustKmh !== undefined ? kmhToMS(rawWindGustKmh) : undefined;
  const windGustFactor = calculateGustFactor(windGustSpeed, windSpeed);
  const rawVisibilityKm = asOptionalNumber(conditions.Visibility?.Metric?.Value);
  const visibility =
    rawVisibilityKm !== undefined ? rawVisibilityKm * UNITS.LENGTH.KM_TO_M : undefined;
  const cloudCeiling = asOptionalNumber(conditions.Ceiling?.Metric?.Value);
  const precipitationLastHour = asOptionalNumber(conditions.Precip1hr?.Metric?.Value);
  const temperatureDeparture24h = asOptionalNumber(
    conditions.Past24HourTemperatureDeparture?.Metric?.Value
  );
  const cloudCover = optionalPercentageToRatio(conditions.CloudCover);
  const uvIndex = asOptionalNumber(conditions.UVIndexFloat);
  const weatherIcon = asOptionalNumber(conditions.WeatherIcon);
  return {
    ...(windGustSpeed !== undefined && { windGustSpeed }),
    ...(windGustFactor !== undefined && { windGustFactor }),
    ...(uvIndex !== undefined && { uvIndex }),
    ...(cloudCover !== undefined && { cloudCover }),
    ...(visibility !== undefined && { visibility }),
    ...(cloudCeiling !== undefined && { cloudCeiling }),
    ...(precipitationLastHour !== undefined && { precipitationLastHour }),
    ...(temperatureDeparture24h !== undefined && { temperatureDeparture24h }),
    ...(weatherIcon !== undefined && { weatherIcon }),
  };
}

/**
 * AccuWeather PressureTendency.Code to a numeric trend: falling/steady/rising.
 * Decodes the same F/S/R alphabet as TENDENCY_KIND_BY_CODE in
 * WeatherProviderMapper.ts (which targets the SK v2 TendencyKind strings);
 * a new AccuWeather code must be added to both tables.
 */
const PRESSURE_TENDENCY_CODES: ReadonlyMap<string, number> = new Map([
  ['F', -1],
  ['S', 0],
  ['R', 1],
]);

/** Strip control characters and bound an optional API label; undefined when absent or empty. */
function optionalLabel(value: unknown): string | undefined {
  const capped = capString(value, ACCUWEATHER.MAX_LABEL_LENGTH);
  return capped.length > 0 ? capped : undefined;
}

/**
 * Decode optional condition-detail fields: barometric tendency (numeric
 * trend), precipitation type, and visibility obstruction. Each field is
 * omitted from the result when the API response does not carry it.
 */
function extractConditionDetails(conditions: AccuWeatherCurrentConditions): Partial<WeatherData> {
  const tendencyCode = conditions.PressureTendency?.Code;
  const pressureTendency =
    typeof tendencyCode === 'string'
      ? PRESSURE_TENDENCY_CODES.get(tendencyCode.trim().toUpperCase())
      : undefined;
  const precipitationType = optionalLabel(conditions.PrecipitationType);
  const visibilityObstruction = optionalLabel(conditions.ObstructionsToVisibility);
  return {
    ...(pressureTendency !== undefined && { pressureTendency }),
    ...(precipitationType !== undefined && { precipitationType }),
    ...(visibilityObstruction !== undefined && { visibilityObstruction }),
  };
}

/**
 * Map an AccuWeather current-conditions record to internal SI `WeatherData`.
 * Pure: it allocates no per-call calculator and runs no validation. The
 * service runs `validateWeatherData` on the returned value.
 */
export function mapAccuWeatherCurrentToWeatherData(
  conditions: AccuWeatherCurrentConditions
): WeatherData {
  const temperature = celsiusToKelvin(conditions.Temperature.Metric.Value);
  const pressure = millibarsToPA(conditions.Pressure.Metric.Value);
  const humidity = percentageToRatio(conditions.RelativeHumidity);
  const windSpeed = kmhToMS(conditions.Wind.Speed.Metric.Value);
  // Wind.Direction.Degrees is azimuth from true north per the WMO surface-wind
  // observation convention (Guide to Meteorological Instruments WMO-No. 8).
  // AccuWeather's docs say "from north" without a qualifier because that is
  // the universal meteorological default; using magnetic would require every
  // consumer to know the local magnetic declination. Mapping to the canonical
  // environment.wind.directionTrue path is therefore correct.
  // Normalize into [0, 2π): an exact 360° reading would otherwise land on 2π,
  // which the NMEA2000 half-open range check rejects.
  const windDirection = normalizeAngle0To2Pi(degreesToRadians(conditions.Wind.Direction.Degrees));
  const dewPoint = celsiusToKelvin(conditions.DewPoint.Metric.Value);
  // Shared base derivation (wind chill, heat index, Beaufort, absolute
  // humidity, air density), the same assembly every provider mapper uses.
  // Heat index is computed (NWS Rothfusz), not AccuWeather RealFeel: RealFeel
  // can fall below air temperature, so it cannot occupy the canonical
  // heatIndexTemperature leaf. RealFeel ships on environment.weather.realFeel.
  const derived = deriveBaseWeatherFields(temperature, pressure, humidity, windSpeed);
  // WindChillTemperature is optional on partial / lower-tier responses: prefer
  // the measured value and fall back to the helper's Environment Canada
  // formula so a missing block degrades gracefully.
  const rawWindChillC = conditions.WindChillTemperature?.Metric?.Value;
  const windChill =
    typeof rawWindChillC === 'number' ? celsiusToKelvin(rawWindChillC) : derived.windChill;

  const enhancedTemps = extractEnhancedTemperatures(conditions);
  const enhancedConditions = extractEnhancedConditions(conditions, windSpeed);
  const conditionDetails = extractConditionDetails(conditions);
  const heatStressIndex =
    enhancedTemps.wetBulbGlobeTemperature !== undefined
      ? calculateHeatStressIndex(enhancedTemps.wetBulbGlobeTemperature)
      : undefined;
  // Normalize the AccuWeather icon code into a provider-agnostic severe
  // condition here, at the provider boundary, so the notifier never decodes
  // an AccuWeather-specific value.
  const severeCondition = accuWeatherSevereCondition(enhancedConditions.weatherIcon);

  return {
    temperature,
    pressure,
    humidity,
    windSpeed,
    windDirection,
    dewPoint,
    // Spread the shared derivation, then override wind chill with the measured
    // value when AccuWeather supplied one.
    ...derived,
    windChill,
    // `description` carries the AccuWeather phrase; `weatherIcon` (decoded
    // into enhancedConditions) carries the icon code for severe-condition
    // classification.
    description: capString(conditions.WeatherText, ACCUWEATHER.MAX_DESCRIPTION_LENGTH),
    timestamp: capString(conditions.LocalObservationDateTime, ACCUWEATHER.MAX_LABEL_LENGTH),
    // Optional fields decoded above: spread last so only present keys land.
    ...enhancedTemps,
    ...enhancedConditions,
    ...conditionDetails,
    ...(heatStressIndex !== undefined && { heatStressIndex }),
    ...(severeCondition !== undefined && { severeCondition }),
  };
}
