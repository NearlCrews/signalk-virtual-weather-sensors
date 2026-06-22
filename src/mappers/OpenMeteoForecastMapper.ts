/**
 * Pure Open-Meteo forecast and observation block to SK v2 WeatherData mapping.
 *
 * The Open-Meteo forecast shape is COLUMNAR: each variable is a parallel array
 * indexed by position in `time`. All three functions iterate by index and guard
 * each element access with `?.[i]`. The internal WeatherData type is not
 * involved; these mappers go directly from the Open-Meteo response shapes to
 * the SK v2 `WeatherData` envelope.
 *
 * Units (Open-Meteo with `wind_speed_unit=ms`):
 *   wind speeds   m/s        (do NOT km/h-convert; AccuWeather conversion must not bleed here)
 *   visibility    meters     (do NOT multiply by KM_TO_M)
 *   pressure_msl  hPa        (millibarsToPA converts to Pa)
 *   temperatures  Celsius    (optionalCelsiusToKelvin)
 *   cloud_cover   percent    (optionalPercentageToRatio)
 *   precipitation mm         (* UNITS.PRECIPITATION.MM_TO_M)
 *   wind dir      degrees    (handled inside buildWindFromMs via degreesToRadians)
 */

import type { WeatherData as SKWeatherData } from '@signalk/server-api';
import { UNITS } from '../constants/index.js';
import type { OpenMeteoCurrentResponse, OpenMeteoForecastResponse } from '../types/index.js';
import {
  asOpenMeteoTimestamp,
  asOptionalNumber,
  calculateAbsoluteHumidity,
  millibarsToPA,
  optionalCelsiusToKelvin,
  optionalPercentageToRatio,
} from '../utils/conversions.js';
import { WMO_DESCRIPTIONS } from './OpenMeteoMapper.js';
import { buildWindFromMs, type SKOutside, type SKSun } from './skV2WindHelper.js';

/** Map the Open-Meteo hourly block to ascending-order `point` WeatherData entries. */
export function mapOpenMeteoHourlyToForecasts(
  response: OpenMeteoForecastResponse
): SKWeatherData[] {
  const h = response.hourly;
  const times = h?.time ?? [];
  return times.map((date, i) => {
    const temperatureK = optionalCelsiusToKelvin(h?.temperature_2m?.[i]);
    const dewPointK = optionalCelsiusToKelvin(h?.dew_point_2m?.[i]);
    const feelsLikeK = optionalCelsiusToKelvin(h?.apparent_temperature?.[i]);
    const rhRatio = optionalPercentageToRatio(h?.relative_humidity_2m?.[i]);
    const visibilityM = asOptionalNumber(h?.visibility?.[i]); // already meters
    const cloudCover = optionalPercentageToRatio(h?.cloud_cover?.[i]);
    const uvIndex = asOptionalNumber(h?.uv_index?.[i]);
    const precipitationMm = asOptionalNumber(h?.precipitation?.[i]);
    const weatherCode = asOptionalNumber(h?.weather_code?.[i]);
    const description = weatherCode !== undefined ? WMO_DESCRIPTIONS.get(weatherCode) : undefined;

    const outside: SKOutside = {
      ...(temperatureK !== undefined && { temperature: temperatureK }),
      ...(dewPointK !== undefined && { dewPointTemperature: dewPointK }),
      ...(feelsLikeK !== undefined && { feelsLikeTemperature: feelsLikeK }),
      ...(rhRatio !== undefined && {
        relativeHumidity: rhRatio,
        ...(temperatureK !== undefined && {
          absoluteHumidity: calculateAbsoluteHumidity(temperatureK, rhRatio),
        }),
      }),
      ...(visibilityM !== undefined && { horizontalVisibility: visibilityM }),
      ...(cloudCover !== undefined && { cloudCover }),
      ...(uvIndex !== undefined && { uvIndex }),
      ...(precipitationMm !== undefined && {
        precipitationVolume: precipitationMm * UNITS.PRECIPITATION.MM_TO_M,
      }),
    };
    const wind = buildWindFromMs(
      h?.wind_speed_10m?.[i],
      h?.wind_direction_10m?.[i],
      h?.wind_gusts_10m?.[i]
    );
    return {
      date,
      type: 'point',
      ...(description !== undefined && { description }),
      outside,
      ...(wind !== undefined && { wind }),
    };
  });
}

/**
 * Map the Open-Meteo daily block to ascending-order `daily` WeatherData entries.
 * Each entry has min/max temperature, optional UV index, optional precipitation,
 * optional wind summary, optional sun rise/set, and an optional WMO description.
 * No humidity is provided by the daily block, so `absoluteHumidity` is omitted.
 */
export function mapOpenMeteoDailyToForecasts(response: OpenMeteoForecastResponse): SKWeatherData[] {
  const d = response.daily;
  const times = d?.time ?? [];
  return times.map((date, i) => {
    const minTemperatureK = optionalCelsiusToKelvin(d?.temperature_2m_min?.[i]);
    const maxTemperatureK = optionalCelsiusToKelvin(d?.temperature_2m_max?.[i]);
    const uvIndex = asOptionalNumber(d?.uv_index_max?.[i]);
    const precipitationMm = asOptionalNumber(d?.precipitation_sum?.[i]);
    const weatherCode = asOptionalNumber(d?.weather_code?.[i]);
    const description = weatherCode !== undefined ? WMO_DESCRIPTIONS.get(weatherCode) : undefined;

    const outside: SKOutside = {
      ...(minTemperatureK !== undefined && { minTemperature: minTemperatureK }),
      ...(maxTemperatureK !== undefined && { maxTemperature: maxTemperatureK }),
      ...(uvIndex !== undefined && { uvIndex }),
      ...(precipitationMm !== undefined && {
        precipitationVolume: precipitationMm * UNITS.PRECIPITATION.MM_TO_M,
      }),
    };

    const wind = buildWindFromMs(
      d?.wind_speed_10m_max?.[i],
      d?.wind_direction_10m_dominant?.[i],
      d?.wind_gusts_10m_max?.[i]
    );

    const sunriseStr = d?.sunrise?.[i];
    const sunsetStr = d?.sunset?.[i];
    const sun: SKSun = {
      ...(typeof sunriseStr === 'string' && { sunrise: sunriseStr }),
      ...(typeof sunsetStr === 'string' && { sunset: sunsetStr }),
    };

    return {
      date,
      type: 'daily',
      ...(description !== undefined && { description }),
      outside,
      ...(wind !== undefined && { wind }),
      ...(Object.keys(sun).length > 0 && { sun }),
    };
  });
}

/**
 * Map an Open-Meteo current block to a single `observation` WeatherData entry.
 * The observation carries pressure (from `pressure_msl`) in addition to
 * the fields shared with the hourly mapper. Every field is conditionally spread
 * so a missing field is omitted rather than emitted as zero. The required `date`
 * field is set via `asOpenMeteoTimestamp` (returns '' when absent, never undefined).
 */
export function mapOpenMeteoCurrentToObservation(
  response: OpenMeteoCurrentResponse
): SKWeatherData {
  const c = response.current;

  const temperatureK = optionalCelsiusToKelvin(c?.temperature_2m);
  const dewPointK = optionalCelsiusToKelvin(c?.dew_point_2m);
  const feelsLikeK = optionalCelsiusToKelvin(c?.apparent_temperature);
  const rhRatio = optionalPercentageToRatio(c?.relative_humidity_2m);
  const pressureMbar = asOptionalNumber(c?.pressure_msl);
  const visibilityM = asOptionalNumber(c?.visibility); // already meters
  const cloudCover = optionalPercentageToRatio(c?.cloud_cover);
  const uvIndex = asOptionalNumber(c?.uv_index);
  const precipitationMm = asOptionalNumber(c?.precipitation);
  const weatherCode = asOptionalNumber(c?.weather_code);
  const description = weatherCode !== undefined ? WMO_DESCRIPTIONS.get(weatherCode) : undefined;

  const outside: SKOutside = {
    ...(temperatureK !== undefined && { temperature: temperatureK }),
    ...(dewPointK !== undefined && { dewPointTemperature: dewPointK }),
    ...(feelsLikeK !== undefined && { feelsLikeTemperature: feelsLikeK }),
    ...(rhRatio !== undefined && {
      relativeHumidity: rhRatio,
      ...(temperatureK !== undefined && {
        absoluteHumidity: calculateAbsoluteHumidity(temperatureK, rhRatio),
      }),
    }),
    ...(pressureMbar !== undefined && { pressure: millibarsToPA(pressureMbar) }),
    ...(visibilityM !== undefined && { horizontalVisibility: visibilityM }),
    ...(cloudCover !== undefined && { cloudCover }),
    ...(uvIndex !== undefined && { uvIndex }),
    ...(precipitationMm !== undefined && {
      precipitationVolume: precipitationMm * UNITS.PRECIPITATION.MM_TO_M,
    }),
  };

  const wind = buildWindFromMs(c?.wind_speed_10m, c?.wind_direction_10m, c?.wind_gusts_10m);

  const date = asOpenMeteoTimestamp(c?.time);
  return {
    date,
    type: 'observation',
    ...(description !== undefined && { description }),
    outside,
    ...(wind !== undefined && { wind }),
  };
}
