/**
 * Pure Open-Meteo current-block to internal SI `WeatherData` mapping.
 *
 * Parallels `AccuWeatherService.transformWeatherData` so the two providers
 * produce the same `WeatherData` shape and everything downstream (mapper,
 * notifier, PGN bridge) stays provider-agnostic. Open-Meteo gives fewer fields
 * than AccuWeather: it has no RealFeel, wet-bulb, pressure tendency,
 * precipitation type, ceiling, visibility obstruction, or 24h departure, so
 * those leaves are left unset. Wind chill and heat index are recomputed (as
 * AccuWeather already does for heat index), and wet-bulb globe temperature is
 * estimated so the heat-stress band still functions. Past-hour precipitation
 * sums the `minutely_15` companion block rather than reading the current block,
 * which reports only a 15-minute accumulation; see `pastHourPrecipitationMm`.
 */

import { buildKeylessBaseWeatherData } from '../calculators/deriveWeatherFields.js';
import { ERROR_CODES } from '../constants/index.js';
import { openMeteoSevereCondition } from '../providers/open-meteo-severity.js';
import type { OpenMeteoCurrentResponse, WeatherData } from '../types/index.js';
import {
  asOptionalNumber,
  calculateGustFactor,
  isoToEpochMs,
  optionalCelsiusToKelvin,
  optionalPercentageToRatio,
  requireObservationTimestamp,
} from '../utils/conversions.js';
import { requireNumber } from './mapperUtils.js';

/**
 * WMO weather-code (table 4677) to plain-language description, the Open-Meteo
 * analog of AccuWeather's `WeatherText`. Populates `environment.weather.description`
 * and the severe-condition notification lead.
 */
export const WMO_DESCRIPTIONS: ReadonlyMap<number, string> = new Map([
  [0, 'Clear sky'],
  [1, 'Mainly clear'],
  [2, 'Partly cloudy'],
  [3, 'Overcast'],
  [45, 'Fog'],
  [48, 'Depositing rime fog'],
  [51, 'Light drizzle'],
  [53, 'Moderate drizzle'],
  [55, 'Dense drizzle'],
  [56, 'Light freezing drizzle'],
  [57, 'Dense freezing drizzle'],
  [61, 'Slight rain'],
  [63, 'Moderate rain'],
  [65, 'Heavy rain'],
  [66, 'Light freezing rain'],
  [67, 'Heavy freezing rain'],
  [71, 'Slight snowfall'],
  [73, 'Moderate snowfall'],
  [75, 'Heavy snowfall'],
  [77, 'Snow grains'],
  [80, 'Slight rain showers'],
  [81, 'Moderate rain showers'],
  [82, 'Violent rain showers'],
  [85, 'Slight snow showers'],
  [86, 'Heavy snow showers'],
  [95, 'Thunderstorm'],
  [96, 'Thunderstorm with slight hail'],
  [97, 'Heavy thunderstorm'],
  [99, 'Thunderstorm with heavy hail'],
]);

/** Describe a WMO weather code, or undefined when the code is absent or unmapped. */
export function wmoDescription(code: number | undefined): string | undefined {
  return code !== undefined ? WMO_DESCRIPTIONS.get(code) : undefined;
}

/** Span of the past-hour accumulation, in milliseconds. */
const PAST_HOUR_MS = 60 * 60 * 1000;
/** `minutely_15` buckets that tile one hour. */
const BUCKETS_PER_HOUR = 4;
/** Open-Meteo reports precipitation to 0.01 mm; summing must not add float noise. */
const PRECIPITATION_SCALE = 100;

/**
 * Sum the past-hour precipitation depth in millimetres from the `minutely_15`
 * companion block, or `undefined` unless all four buckets are present.
 *
 * `current.precipitation` alone cannot be used for this. Open-Meteo documents
 * the current block's `interval` as "the duration in seconds used for
 * calculating backward-looking sums", and that interval is 900 s, so it is a
 * 15-minute depth, and scaling it up would invent a number rather than report
 * one. Each `minutely_15` bucket is the same kind of 15-minute sum ending at its
 * stamp, so the four stamped within the hour ending at the observation time
 * tile exactly the rolling past hour the path promises.
 *
 * Returning `undefined` leaves the path unset, which is the same choice
 * `mapMetNoCurrentToWeatherData` makes when no genuine past-hour depth exists.
 */
export function pastHourPrecipitationMm(
  response: OpenMeteoCurrentResponse,
  observationTime: unknown
): number | undefined {
  const times = response.minutely_15?.time;
  const values = response.minutely_15?.precipitation;
  if (times === undefined || values === undefined) return undefined;

  const endMs = isoToEpochMs(observationTime);
  if (!Number.isFinite(endMs)) return undefined;
  const startMs = endMs - PAST_HOUR_MS;

  let total = 0;
  let buckets = 0;
  for (let i = 0; i < times.length; i++) {
    const stampMs = isoToEpochMs(times[i]);
    if (!(stampMs > startMs && stampMs <= endMs)) continue;
    const depth = asOptionalNumber(values[i]);
    if (depth === undefined) return undefined;
    total += depth;
    buckets++;
  }
  return buckets === BUCKETS_PER_HOUR
    ? Math.round(total * PRECIPITATION_SCALE) / PRECIPITATION_SCALE
    : undefined;
}

/**
 * Decode the optional Open-Meteo fields, returning only the keys that were
 * present. Kept separate from the core transform so neither grows the
 * cognitive complexity the codebase caps, mirroring AccuWeather's
 * `extractEnhancedConditions`.
 */
function extractOptionalFields(
  response: OpenMeteoCurrentResponse,
  current: NonNullable<OpenMeteoCurrentResponse['current']>,
  windSpeed: number
): Partial<WeatherData> {
  const uvIndex = asOptionalNumber(current.uv_index);
  const visibility = asOptionalNumber(current.visibility);
  const cloudCover = optionalPercentageToRatio(current.cloud_cover);
  const windGustSpeed = asOptionalNumber(current.wind_gusts_10m);
  const windGustFactor = calculateGustFactor(windGustSpeed, windSpeed);
  const apparentTemperature = optionalCelsiusToKelvin(current.apparent_temperature);
  const precipitationLastHour = pastHourPrecipitationMm(response, current.time);
  const weatherCode = asOptionalNumber(current.weather_code);
  const severeCondition = openMeteoSevereCondition(weatherCode);
  const description = wmoDescription(weatherCode);
  return {
    ...(description !== undefined && { description }),
    ...(uvIndex !== undefined && { uvIndex }),
    ...(visibility !== undefined && { visibility }),
    ...(cloudCover !== undefined && { cloudCover }),
    ...(windGustSpeed !== undefined && { windGustSpeed }),
    ...(windGustFactor !== undefined && { windGustFactor }),
    ...(apparentTemperature !== undefined && { apparentTemperature }),
    ...(precipitationLastHour !== undefined && { precipitationLastHour }),
    ...(severeCondition !== undefined && { severeCondition }),
  };
}

/**
 * Map an Open-Meteo current-block response to SI `WeatherData`. Throws a tagged
 * `INVALID_WEATHER_DATA` error when the `current` block or a required field is
 * missing. Wind speeds are taken as m/s (the service requests
 * `wind_speed_unit=ms`).
 */
export function mapOpenMeteoCurrentToWeatherData(response: OpenMeteoCurrentResponse): WeatherData {
  const current = response.current;
  if (!current || typeof current !== 'object') {
    throw new Error(
      `${ERROR_CODES.DATA.INVALID_WEATHER_DATA}: Open-Meteo response missing current block`
    );
  }

  const windSpeed = requireNumber(current.wind_speed_10m, 'wind_speed_10m', 'Open-Meteo');
  return {
    ...buildKeylessBaseWeatherData({
      temperatureC: requireNumber(current.temperature_2m, 'temperature_2m', 'Open-Meteo'),
      pressureHpa: requireNumber(current.pressure_msl, 'pressure_msl', 'Open-Meteo'),
      humidityPercent: requireNumber(
        current.relative_humidity_2m,
        'relative_humidity_2m',
        'Open-Meteo'
      ),
      windSpeedMs: windSpeed,
      windFromDeg: requireNumber(current.wind_direction_10m, 'wind_direction_10m', 'Open-Meteo'),
      dewPointC: requireNumber(current.dew_point_2m, 'dew_point_2m', 'Open-Meteo'),
      timestamp: requireObservationTimestamp(current.time, 'Open-Meteo current conditions'),
    }),
    ...extractOptionalFields(response, current, windSpeed),
  };
}
