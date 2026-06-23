/**
 * Pure Met.no Locationforecast 2.0 current-block to internal SI `WeatherData`
 * mapping.
 *
 * Parallels `OpenMeteoMapper` so the two keyless providers produce the same
 * `WeatherData` shape and everything downstream (mapper, notifier, PGN bridge)
 * stays provider-agnostic. Met.no gives fewer fields than AccuWeather: it has no
 * RealFeel, wet-bulb, pressure tendency, precipitation type, ceiling, visibility,
 * or 24h departure, so those leaves are left unset. Wind chill and heat index are
 * recomputed, and wet-bulb globe temperature is estimated so the heat-stress band
 * still functions.
 */

import { deriveBaseWeatherFields } from '../calculators/deriveWeatherFields.js';
import { ERROR_CODES } from '../constants/index.js';
import { metNoSevereCondition, metNoSymbolBase } from '../providers/met-no-severity.js';
import type {
  MetNoLocationforecastResponse,
  MetNoTimeseriesEntry,
  WeatherData,
} from '../types/index.js';
import {
  asOptionalNumber,
  calculateGustFactor,
  calculateHeatStressIndex,
  celsiusToKelvin,
  degreesToRadians,
  estimateWetBulbGlobeTemperature,
  millibarsToPA,
  normalizeAngle0To2Pi,
  normalizeIsoTimestamp,
  optionalPercentageToRatio,
  percentageToRatio,
} from '../utils/conversions.js';
import { requireNumber } from './mapperUtils.js';

/**
 * Met.no `symbol_code` base (suffix stripped) to plain-language description.
 * Parallels `WMO_DESCRIPTIONS` in `OpenMeteoMapper.ts` and populates
 * `environment.weather.description` and the severe-condition notification lead.
 * Exported so the forecast mapper (phase 2) can reuse it without a second copy.
 */
export const MET_NO_DESCRIPTIONS: ReadonlyMap<string, string> = new Map([
  ['clearsky', 'Clear sky'],
  ['fair', 'Fair'],
  ['partlycloudy', 'Partly cloudy'],
  ['cloudy', 'Cloudy'],
  ['fog', 'Fog'],
  ['lightrain', 'Light rain'],
  ['rain', 'Rain'],
  ['heavyrain', 'Heavy rain'],
  ['lightrainshowers', 'Light rain showers'],
  ['rainshowers', 'Rain showers'],
  ['heavyrainshowers', 'Heavy rain showers'],
  ['lightsleet', 'Light sleet'],
  ['sleet', 'Sleet'],
  ['heavysleet', 'Heavy sleet'],
  ['lightsleetshowers', 'Light sleet showers'],
  ['sleetshowers', 'Sleet showers'],
  ['heavysleetshowers', 'Heavy sleet showers'],
  ['lightsnow', 'Light snow'],
  ['snow', 'Snow'],
  ['heavysnow', 'Heavy snow'],
  ['lightsnowshowers', 'Light snow showers'],
  ['snowshowers', 'Snow showers'],
  ['heavysnowshowers', 'Heavy snow showers'],
  ['lightrainandthunder', 'Light rain and thunder'],
  ['rainandthunder', 'Rain and thunder'],
  ['heavyrainandthunder', 'Heavy rain and thunder'],
  ['lightrainshowersandthunder', 'Light rain showers and thunder'],
  ['rainshowersandthunder', 'Rain showers and thunder'],
  ['heavyrainshowersandthunder', 'Heavy rain showers and thunder'],
  ['lightsleetandthunder', 'Light sleet and thunder'],
  ['sleetandthunder', 'Sleet and thunder'],
  ['heavysleetandthunder', 'Heavy sleet and thunder'],
  ['lightsleetshowersandthunder', 'Light sleet showers and thunder'],
  ['sleetshowersandthunder', 'Sleet showers and thunder'],
  ['heavysleetshowersandthunder', 'Heavy sleet showers and thunder'],
  ['lightsnowandthunder', 'Light snow and thunder'],
  ['snowandthunder', 'Snow and thunder'],
  ['heavysnowandthunder', 'Heavy snow and thunder'],
  ['lightsnowshowersandthunder', 'Light snow showers and thunder'],
  ['snowshowersandthunder', 'Snow showers and thunder'],
  ['heavysnowshowersandthunder', 'Heavy snow showers and thunder'],
]);

type InstantDetails = NonNullable<NonNullable<MetNoTimeseriesEntry['data']>['instant']>['details'];
type Next1h = NonNullable<MetNoTimeseriesEntry['data']>['next_1_hours'];

/**
 * Decode the optional Met.no instant fields and next_1_hours block, returning
 * only the keys that were present. Kept separate from the core transform so
 * neither grows the cognitive complexity the codebase caps.
 *
 * Unlike the Open-Meteo counterpart (which reads from columnar arrays), this
 * function reads from `instant.details` for the snapshot and `next_1_hours` for
 * precipitation and description: the two are structurally different and are not
 * interchangeable.
 */
function extractOptionalFields(
  details: NonNullable<InstantDetails>,
  next1h: Next1h,
  windSpeed: number
): Partial<WeatherData> {
  const cloudCover = optionalPercentageToRatio(details.cloud_area_fraction);
  const windGustSpeed = asOptionalNumber(details.wind_speed_of_gust);
  const windGustFactor = calculateGustFactor(windGustSpeed, windSpeed);
  const uvIndex = asOptionalNumber(details.ultraviolet_index_clear_sky);

  // mm, no conversion; WeatherData.precipitationLastHour is mm
  const precipitationLastHour = asOptionalNumber(next1h?.details?.precipitation_amount);

  const symbolCode = next1h?.summary?.symbol_code;
  const base = metNoSymbolBase(symbolCode);
  const description = base !== undefined ? MET_NO_DESCRIPTIONS.get(base) : undefined;
  const severeCondition = metNoSevereCondition(symbolCode);

  return {
    ...(cloudCover !== undefined && { cloudCover }),
    ...(windGustSpeed !== undefined && { windGustSpeed }),
    ...(windGustFactor !== undefined && { windGustFactor }),
    ...(uvIndex !== undefined && { uvIndex }),
    ...(precipitationLastHour !== undefined && { precipitationLastHour }),
    ...(description !== undefined && { description }),
    ...(severeCondition !== undefined && { severeCondition }),
  };
}

/**
 * Map the first entry of a Met.no Locationforecast 2.0 (`/complete`) response to
 * SI `WeatherData`. Throws a tagged `INVALID_WEATHER_DATA` error when the
 * timeseries is empty or a required `instant.details` field is missing. Wind
 * speeds are taken as m/s (Met.no always uses m/s for wind_speed and
 * wind_speed_of_gust on the /complete endpoint).
 */
export function mapMetNoCurrentToWeatherData(response: MetNoLocationforecastResponse): WeatherData {
  const entry = response.properties?.timeseries?.[0];
  if (!entry) {
    throw new Error(
      `${ERROR_CODES.DATA.INVALID_WEATHER_DATA}: Met.no response has empty timeseries`
    );
  }

  const details = entry.data?.instant?.details;
  if (!details || typeof details !== 'object') {
    throw new Error(
      `${ERROR_CODES.DATA.INVALID_WEATHER_DATA}: Met.no response missing instant.details`
    );
  }

  const temperature = celsiusToKelvin(
    requireNumber(details.air_temperature, 'air_temperature', 'Met.no')
  );
  const pressure = millibarsToPA(
    requireNumber(details.air_pressure_at_sea_level, 'air_pressure_at_sea_level', 'Met.no')
  );
  const humidity = percentageToRatio(
    requireNumber(details.relative_humidity, 'relative_humidity', 'Met.no')
  );
  const windSpeed = requireNumber(details.wind_speed, 'wind_speed', 'Met.no');
  const windDirection = normalizeAngle0To2Pi(
    degreesToRadians(requireNumber(details.wind_from_direction, 'wind_from_direction', 'Met.no'))
  );
  const dewPoint = celsiusToKelvin(
    requireNumber(details.dew_point_temperature, 'dew_point_temperature', 'Met.no')
  );

  // Met.no carries no wind chill: recompute from the true wind (as the
  // AccuWeather path does when WindChillTemperature is absent). Heat index is
  // always computed (NWS Rothfusz), matching the AccuWeather path.
  const { windChill, heatIndex, beaufortScale, absoluteHumidity, airDensityEnhanced } =
    deriveBaseWeatherFields(temperature, pressure, humidity, windSpeed);

  // Met.no provides no measured wet-bulb globe temperature: estimate it so
  // the heat-stress band still works. This is a shade estimate (see
  // estimateWetBulbGlobeTemperature), conservative under strong sun.
  const wetBulbGlobeTemperature = estimateWetBulbGlobeTemperature(temperature, humidity);
  const heatStressIndex = calculateHeatStressIndex(wetBulbGlobeTemperature);

  // Met.no emits ISO 8601 with a trailing Z, so the call is a passthrough.
  const timestamp = normalizeIsoTimestamp(entry.time);

  const next1h = entry.data?.next_1_hours;

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
    timestamp,
    ...extractOptionalFields(details, next1h, windSpeed),
  };
}
