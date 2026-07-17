/**
 * Pure mappers from AccuWeather forecast responses to the Signal K v2 Weather
 * API `WeatherData` envelope. No I/O: fetching lives in AccuWeatherService, so
 * these stay trivially unit-testable. The SK `WeatherData` type is aliased
 * `SKWeatherData` to avoid colliding with the plugin's internal `WeatherData`.
 * Every optional field is conditionally spread so a missing upstream block is
 * omitted, never emitted as a real 0.
 */
import type {
  PrecipitationKind,
  WeatherData as SKWeatherData,
  TendencyKind,
} from '@signalk/server-api';
import { UNITS } from '../constants/index.js';
import type {
  AccuWeatherCurrentConditions,
  AccuWeatherDailyForecastResponse,
  AccuWeatherHourlyForecast,
} from '../types/index.js';
import {
  asOptionalNumber,
  kmhToMS,
  millibarsToPA,
  optionalCelsiusToKelvin,
  optionalPercentageToRatio,
  requireIsoTimestamp,
  requireObservationTimestamp,
} from '../utils/conversions.js';
import {
  buildSkOutsideSI,
  buildSunBlock,
  buildWindFromMs,
  type SKOutside,
  type SKWind,
} from './skV2Envelope.js';

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

/**
 * AccuWeather PressureTendency.Code (F/S/R) to the SK TendencyKind enum.
 * Decodes the same alphabet as PRESSURE_TENDENCY_CODES in AccuWeatherMapper.ts
 * (which targets the internal numeric trend); a new AccuWeather code must be
 * added to both tables.
 */
const TENDENCY_KIND_BY_CODE: ReadonlyMap<string, TendencyKind> = new Map([
  ['F', 'decreasing'],
  ['S', 'steady'],
  ['R', 'increasing'],
]);

function mapTendencyKind(code: string | undefined): TendencyKind | undefined {
  if (typeof code !== 'string') return undefined;
  return TENDENCY_KIND_BY_CODE.get(code.trim().toUpperCase());
}

/** Cloud-cover and precipitation fields shared by the hourly forecast and daily-half shapes. */
interface CloudPrecipSource {
  readonly HasPrecipitation?: boolean;
  readonly PrecipitationType?: string | null;
  readonly CloudCover?: number;
  readonly TotalLiquid?: { readonly Value: number };
}

/** Build the cloud-cover and precipitation portion of an SKOutside, shared by the hourly and daily mappers. */
function buildCloudAndPrecip(source: CloudPrecipSource | undefined): Partial<SKOutside> {
  const cloudCover = optionalPercentageToRatio(source?.CloudCover);
  const precipitationMm = asOptionalNumber(source?.TotalLiquid?.Value);
  const precipitationType = source?.HasPrecipitation
    ? mapPrecipitationKind(source.PrecipitationType)
    : undefined;
  return {
    ...(cloudCover !== undefined && { cloudCover }),
    ...(precipitationMm !== undefined && {
      precipitationVolume: precipitationMm * UNITS.PRECIPITATION.MM_TO_M,
    }),
    ...(precipitationType !== undefined && { precipitationType }),
  };
}

/** Build the wind block from a km/h speed/direction/gust source, omitting absent fields. */
// Params accept null because callers pass raw upstream values (e.g.
// `hour.Wind?.Speed?.Value`) that can be JSON null, not just undefined; the
// `typeof === 'number'` guards inside buildWindFromMs correctly exclude both.
function buildWind(
  speedKmh: number | null | undefined,
  directionDegrees: number | null | undefined,
  gustKmh: number | null | undefined
): SKWind | undefined {
  return buildWindFromMs(
    typeof speedKmh === 'number' ? kmhToMS(speedKmh) : speedKmh,
    directionDegrees,
    typeof gustKmh === 'number' ? kmhToMS(gustKmh) : gustKmh
  );
}

/** Map the AccuWeather 12-hour hourly forecast to ascending-order point WeatherData. */
export function mapHourlyToForecasts(
  hours: ReadonlyArray<AccuWeatherHourlyForecast>
): SKWeatherData[] {
  return hours.map((hour) => {
    const temperatureK = optionalCelsiusToKelvin(hour.Temperature?.Value);
    const dewPointK = optionalCelsiusToKelvin(hour.DewPoint?.Value);
    const feelsLikeK = optionalCelsiusToKelvin(hour.RealFeelTemperature?.Value);
    const rhRatio = optionalPercentageToRatio(hour.RelativeHumidity);
    const visibilityKm = asOptionalNumber(hour.Visibility?.Value);
    const uvIndex = asOptionalNumber(hour.UVIndex);

    const outside: SKOutside = {
      ...buildSkOutsideSI({
        temperatureK,
        dewPointK,
        feelsLikeK,
        rhRatio,
        visibilityM: visibilityKm !== undefined ? visibilityKm * UNITS.LENGTH.KM_TO_M : undefined,
        uvIndex,
      }),
      ...buildCloudAndPrecip(hour),
    };

    const wind = buildWind(
      hour.Wind?.Speed?.Value,
      hour.Wind?.Direction?.Degrees,
      hour.WindGust?.Speed?.Value
    );

    return {
      date: requireIsoTimestamp(hour.DateTime, 'AccuWeather hourly forecast'),
      type: 'point',
      ...(typeof hour.IconPhrase === 'string' && { description: hour.IconPhrase }),
      outside,
      ...(wind !== undefined && { wind }),
    };
  });
}

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
    const minTemperatureK = optionalCelsiusToKelvin(day.Temperature?.Minimum?.Value);
    const maxTemperatureK = optionalCelsiusToKelvin(day.Temperature?.Maximum?.Value);

    const outside: SKOutside = {
      ...(minTemperatureK !== undefined && { minTemperature: minTemperatureK }),
      ...(maxTemperatureK !== undefined && { maxTemperature: maxTemperatureK }),
      ...(uvIndex !== undefined && { uvIndex }),
      ...buildCloudAndPrecip(half),
    };

    const wind = buildWind(
      half?.Wind?.Speed?.Value,
      half?.Wind?.Direction?.Degrees,
      half?.WindGust?.Speed?.Value
    );

    const sun = buildSunBlock(
      typeof day.Sun?.Rise === 'string' ? day.Sun.Rise : undefined,
      typeof day.Sun?.Set === 'string' ? day.Sun.Set : undefined
    );

    return {
      date: requireIsoTimestamp(day.Date, 'AccuWeather daily forecast'),
      type: 'daily',
      ...(typeof half?.IconPhrase === 'string' && { description: half.IconPhrase }),
      outside,
      ...(wind !== undefined && { wind }),
      ...(sun !== undefined && { sun }),
    };
  });
}

/**
 * Map AccuWeather current conditions to a single `observation` WeatherData for
 * the v2 Weather API observations endpoint. Current conditions use Metric/
 * Imperial pairs (unlike the flat forecast shapes), and they carry pressure and
 * pressure tendency that the forecast endpoints do not. Wind is mapped to the
 * v2 envelope's `wind.speedTrue` like the forecast mappers. The shared
 * buildSkOutsideSI assembles the common fields; the AccuWeather-exclusive
 * pressureTendency and precipitationType are spread on top, mirroring how
 * mapHourlyToForecasts layers buildCloudAndPrecip over the shared builder.
 */
export function mapCurrentToObservation(c: AccuWeatherCurrentConditions): SKWeatherData {
  const pressureMbar = asOptionalNumber(c.Pressure?.Metric?.Value);
  const visibilityKm = asOptionalNumber(c.Visibility?.Metric?.Value);
  const precipitationMm = asOptionalNumber(c.Precip1hr?.Metric?.Value);
  const precipitationType = mapPrecipitationKind(c.PrecipitationType);
  const pressureTendency = mapTendencyKind(c.PressureTendency?.Code);

  const outside: SKOutside = {
    ...buildSkOutsideSI({
      temperatureK: optionalCelsiusToKelvin(c.Temperature?.Metric?.Value),
      dewPointK: optionalCelsiusToKelvin(c.DewPoint?.Metric?.Value),
      feelsLikeK: optionalCelsiusToKelvin(c.RealFeelTemperature?.Metric?.Value),
      rhRatio: optionalPercentageToRatio(c.RelativeHumidity),
      pressurePa: pressureMbar !== undefined ? millibarsToPA(pressureMbar) : undefined,
      visibilityM: visibilityKm !== undefined ? visibilityKm * UNITS.LENGTH.KM_TO_M : undefined,
      cloudCover: optionalPercentageToRatio(c.CloudCover),
      uvIndex: asOptionalNumber(c.UVIndexFloat),
      precipitationVolumeM:
        precipitationMm !== undefined ? precipitationMm * UNITS.PRECIPITATION.MM_TO_M : undefined,
    }),
    ...(pressureTendency !== undefined && { pressureTendency }),
    ...(precipitationType !== undefined && { precipitationType }),
  };

  const wind = buildWind(
    c.Wind?.Speed?.Metric?.Value,
    c.Wind?.Direction?.Degrees,
    c.WindGust?.Speed?.Metric?.Value
  );

  return {
    date: requireObservationTimestamp(c.LocalObservationDateTime, 'AccuWeather observation'),
    type: 'observation',
    ...(typeof c.WeatherText === 'string' && { description: c.WeatherText }),
    outside,
    ...(wind !== undefined && { wind }),
  };
}
