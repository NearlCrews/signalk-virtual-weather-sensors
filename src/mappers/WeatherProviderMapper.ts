/**
 * Pure mappers from AccuWeather forecast responses to the Signal K v2 Weather
 * API `WeatherData` envelope. No I/O: fetching lives in AccuWeatherService, so
 * these stay trivially unit-testable. The SK `WeatherData` type is aliased
 * `SKWeatherData` to avoid colliding with the plugin's internal `WeatherData`.
 * Every optional field is conditionally spread so a missing upstream block is
 * omitted, never emitted as a real 0.
 */
import type { PrecipitationKind, WeatherData as SKWeatherData } from '@signalk/server-api';
import { UNITS } from '../constants/index.js';
import type {
  AccuWeatherDailyForecastResponse,
  AccuWeatherHourlyForecast,
} from '../types/index.js';
import {
  asOptionalNumber,
  calculateAbsoluteHumidity,
  celsiusToKelvin,
  degreesToRadians,
  kmhToMS,
  normalizeAngle0To2Pi,
  percentageToRatio,
} from '../utils/conversions.js';

/** AccuWeather PrecipitationType (lowercased) to the SK PrecipitationKind enum. */
const PRECIPITATION_KIND_BY_ACCUWEATHER: ReadonlyMap<string, PrecipitationKind> = new Map([
  ['rain', 'rain'],
  ['snow', 'snow'],
  ['ice', 'freezing rain'],
  ['mixed', 'mixed/ice'],
]);

function mapPrecipitationKind(type: string | null | undefined): PrecipitationKind | undefined {
  if (typeof type !== 'string') return undefined;
  return PRECIPITATION_KIND_BY_ACCUWEATHER.get(type.trim().toLowerCase());
}

type SKOutside = NonNullable<SKWeatherData['outside']>;
type SKWind = NonNullable<SKWeatherData['wind']>;

/** Build the wind block from a speed/direction/gust source, omitting absent fields. */
function buildWind(
  speedKmh: number | undefined,
  directionDegrees: number | undefined,
  gustKmh: number | undefined
): SKWind | undefined {
  const wind: SKWind = {
    ...(typeof speedKmh === 'number' && { speedTrue: kmhToMS(speedKmh) }),
    ...(typeof directionDegrees === 'number' && {
      directionTrue: normalizeAngle0To2Pi(degreesToRadians(directionDegrees)),
    }),
    ...(typeof gustKmh === 'number' && { gust: kmhToMS(gustKmh) }),
  };
  return Object.keys(wind).length > 0 ? wind : undefined;
}

/** Map the AccuWeather 12-hour hourly forecast to ascending-order point WeatherData. */
export function mapHourlyToForecasts(
  hours: ReadonlyArray<AccuWeatherHourlyForecast>
): SKWeatherData[] {
  return hours.map((hour) => {
    const temperature = celsiusToKelvin(hour.Temperature.Value);
    const dewPointC = asOptionalNumber(hour.DewPoint?.Value);
    const realFeelC = asOptionalNumber(hour.RealFeelTemperature?.Value);
    const humidityPct = asOptionalNumber(hour.RelativeHumidity);
    const rhRatio = humidityPct !== undefined ? percentageToRatio(humidityPct) : undefined;
    const visibilityKm = asOptionalNumber(hour.Visibility?.Value);
    const uvIndex = asOptionalNumber(hour.UVIndex);
    const cloudCoverPct = asOptionalNumber(hour.CloudCover);
    const precipitationMm = asOptionalNumber(hour.TotalLiquid?.Value);
    const precipitationType = hour.HasPrecipitation
      ? mapPrecipitationKind(hour.PrecipitationType)
      : undefined;

    const outside: SKOutside = {
      temperature,
      ...(dewPointC !== undefined && { dewPointTemperature: celsiusToKelvin(dewPointC) }),
      ...(realFeelC !== undefined && { feelsLikeTemperature: celsiusToKelvin(realFeelC) }),
      ...(rhRatio !== undefined && {
        relativeHumidity: rhRatio,
        absoluteHumidity: calculateAbsoluteHumidity(temperature, rhRatio),
      }),
      ...(visibilityKm !== undefined && {
        horizontalVisibility: visibilityKm * UNITS.LENGTH.KM_TO_M,
      }),
      ...(uvIndex !== undefined && { uvIndex }),
      ...(cloudCoverPct !== undefined && { cloudCover: percentageToRatio(cloudCoverPct) }),
      ...(precipitationMm !== undefined && {
        precipitationVolume: precipitationMm * UNITS.PRECIPITATION.MM_TO_M,
      }),
      ...(precipitationType !== undefined && { precipitationType }),
    };

    const wind = buildWind(
      hour.Wind?.Speed?.Value,
      hour.Wind?.Direction?.Degrees,
      hour.WindGust?.Speed?.Value
    );

    return {
      date: hour.DateTime,
      type: 'point',
      ...(typeof hour.IconPhrase === 'string' && { description: hour.IconPhrase }),
      outside,
      ...(wind !== undefined && { wind }),
    };
  });
}

type SKSun = NonNullable<SKWeatherData['sun']>;

/** Find the UV index value in a daily entry's AirAndPollen array, if present. */
function dailyUvIndex(
  airAndPollen: AccuWeatherDailyForecastResponse['DailyForecasts'][number]['AirAndPollen']
): number | undefined {
  const entry = airAndPollen?.find((item) => item.Name === 'UVIndex');
  return asOptionalNumber(entry?.Value);
}

/** Map the AccuWeather 5-day daily forecast to ascending-order daily WeatherData. */
export function mapDailyToForecasts(response: AccuWeatherDailyForecastResponse): SKWeatherData[] {
  return response.DailyForecasts.map((day) => {
    // One WeatherData entry per calendar date, summarized by the daytime half;
    // the Night half is intentionally not folded into the same daily record.
    const half = day.Day;
    const uvIndex = dailyUvIndex(day.AirAndPollen);
    const cloudCoverPct = asOptionalNumber(half?.CloudCover);
    const precipitationMm = asOptionalNumber(half?.TotalLiquid?.Value);
    const precipitationType = half?.HasPrecipitation
      ? mapPrecipitationKind(half.PrecipitationType)
      : undefined;

    const outside: SKOutside = {
      minTemperature: celsiusToKelvin(day.Temperature.Minimum.Value),
      maxTemperature: celsiusToKelvin(day.Temperature.Maximum.Value),
      ...(uvIndex !== undefined && { uvIndex }),
      ...(cloudCoverPct !== undefined && { cloudCover: percentageToRatio(cloudCoverPct) }),
      ...(precipitationMm !== undefined && {
        precipitationVolume: precipitationMm * UNITS.PRECIPITATION.MM_TO_M,
      }),
      ...(precipitationType !== undefined && { precipitationType }),
    };

    const wind = buildWind(
      half?.Wind?.Speed?.Value,
      half?.Wind?.Direction?.Degrees,
      half?.WindGust?.Speed?.Value
    );

    const sun: SKSun = {
      ...(typeof day.Sun?.Rise === 'string' && { sunrise: day.Sun.Rise }),
      ...(typeof day.Sun?.Set === 'string' && { sunset: day.Sun.Set }),
    };

    return {
      date: day.Date,
      type: 'daily',
      ...(typeof half?.IconPhrase === 'string' && { description: half.IconPhrase }),
      outside,
      ...(wind !== undefined && { wind }),
      ...(Object.keys(sun).length > 0 && { sun }),
    };
  });
}
