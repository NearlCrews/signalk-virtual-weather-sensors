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
 * estimated so the heat-stress band still functions.
 */

import { deriveBaseWeatherFields } from '../calculators/deriveWeatherFields.js';
import { ERROR_CODES } from '../constants/index.js';
import { openMeteoSevereCondition } from '../providers/open-meteo-severity.js';
import type { OpenMeteoCurrentResponse, WeatherData } from '../types/index.js';
import {
  asOptionalNumber,
  calculateGustFactor,
  calculateHeatStressIndex,
  celsiusToKelvin,
  degreesToRadians,
  estimateWetBulbGlobeTemperature,
  millibarsToPA,
  normalizeAngle0To2Pi,
  optionalPercentageToRatio,
  percentageToRatio,
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
  [99, 'Thunderstorm with heavy hail'],
]);

/**
 * Decode the optional Open-Meteo fields, returning only the keys that were
 * present. Kept separate from the core transform so neither grows the
 * cognitive complexity the codebase caps, mirroring AccuWeather's
 * `extractEnhancedConditions`.
 */
function extractOptionalFields(
  current: NonNullable<OpenMeteoCurrentResponse['current']>,
  windSpeed: number
): Partial<WeatherData> {
  const uvIndex = asOptionalNumber(current.uv_index);
  const visibility = asOptionalNumber(current.visibility);
  const cloudCover = optionalPercentageToRatio(current.cloud_cover);
  const windGustSpeed = asOptionalNumber(current.wind_gusts_10m);
  const windGustFactor = calculateGustFactor(windGustSpeed, windSpeed);
  const rawApparent = asOptionalNumber(current.apparent_temperature);
  const apparentTemperature = rawApparent !== undefined ? celsiusToKelvin(rawApparent) : undefined;
  const precipitationLastHour = asOptionalNumber(current.precipitation);
  const weatherCode = asOptionalNumber(current.weather_code);
  const severeCondition = openMeteoSevereCondition(weatherCode);
  const description = weatherCode !== undefined ? WMO_DESCRIPTIONS.get(weatherCode) : undefined;
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

  const temperature = celsiusToKelvin(
    requireNumber(current.temperature_2m, 'temperature_2m', 'Open-Meteo')
  );
  const pressure = millibarsToPA(requireNumber(current.pressure_msl, 'pressure_msl', 'Open-Meteo'));
  const humidity = percentageToRatio(
    requireNumber(current.relative_humidity_2m, 'relative_humidity_2m', 'Open-Meteo')
  );
  const windSpeed = requireNumber(current.wind_speed_10m, 'wind_speed_10m', 'Open-Meteo');
  const windDirection = normalizeAngle0To2Pi(
    degreesToRadians(requireNumber(current.wind_direction_10m, 'wind_direction_10m', 'Open-Meteo'))
  );
  const dewPoint = celsiusToKelvin(
    requireNumber(current.dew_point_2m, 'dew_point_2m', 'Open-Meteo')
  );

  // Open-Meteo carries no wind chill: recompute from the true wind (as the
  // AccuWeather path does when WindChillTemperature is absent). Heat index is
  // always computed (NWS Rothfusz), matching the AccuWeather path.
  const { windChill, heatIndex, beaufortScale, absoluteHumidity, airDensityEnhanced } =
    deriveBaseWeatherFields(temperature, pressure, humidity, windSpeed);

  // Open-Meteo provides no measured wet-bulb globe temperature: estimate it so
  // the heat-stress band still works. This is a shade estimate (see
  // estimateWetBulbGlobeTemperature), conservative under strong sun.
  const wetBulbGlobeTemperature = estimateWetBulbGlobeTemperature(temperature, humidity);
  const heatStressIndex = calculateHeatStressIndex(wetBulbGlobeTemperature);

  return {
    temperature,
    pressure,
    humidity,
    windSpeed,
    windDirection,
    dewPoint,
    windChill,
    heatIndex,
    beaufortScale,
    absoluteHumidity,
    airDensityEnhanced,
    wetBulbGlobeTemperature,
    heatStressIndex,
    timestamp: requireObservationTimestamp(current.time, 'Open-Meteo current conditions'),
    ...extractOptionalFields(current, windSpeed),
  };
}
