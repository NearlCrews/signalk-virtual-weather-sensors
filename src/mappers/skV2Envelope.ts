/**
 * Shared SK v2 Weather API envelope helpers: wind-block assembly and outside-block
 * assembly. The wind builder is shared by every provider mapper so the m/s
 * conversion and the [0, 2pi) direction normalization live in one place. The
 * outside builder is shared so the conditional-spread pattern and absoluteHumidity
 * derivation live in one place. Speeds are m/s here; a provider whose source is
 * km/h converts before calling (see WeatherProviderMapper.buildWind).
 */
import type { WeatherData as SKWeatherData } from '@signalk/server-api';
import {
  calculateAbsoluteHumidity,
  degreesToRadians,
  normalizeAngle0To2Pi,
} from '../utils/conversions.js';

export type SKOutside = NonNullable<SKWeatherData['outside']>;
export type SKWind = NonNullable<SKWeatherData['wind']>;
export type SKSun = NonNullable<SKWeatherData['sun']>;

/** All-optional, all-SI inputs for the shared SK v2 `outside` block. */
export interface SkOutsideInputs {
  readonly temperatureK?: number | undefined;
  readonly dewPointK?: number | undefined;
  readonly feelsLikeK?: number | undefined;
  readonly pressurePa?: number | undefined;
  readonly rhRatio?: number | undefined;
  readonly visibilityM?: number | undefined;
  readonly cloudCover?: number | undefined;
  readonly uvIndex?: number | undefined;
  readonly precipitationVolumeM?: number | undefined;
}

/**
 * Build the SK v2 `outside` block from SI values, omitting absent fields and
 * deriving `absoluteHumidity` when both temperature and relative humidity are
 * present. Callers do their own provider-specific unit conversion and hand SI
 * values here, so the assembly and the humidity derivation live in one place.
 */
export function buildSkOutsideSI(v: SkOutsideInputs): SKOutside {
  return {
    ...(v.temperatureK !== undefined && { temperature: v.temperatureK }),
    ...(v.dewPointK !== undefined && { dewPointTemperature: v.dewPointK }),
    ...(v.feelsLikeK !== undefined && { feelsLikeTemperature: v.feelsLikeK }),
    ...(v.rhRatio !== undefined && {
      relativeHumidity: v.rhRatio,
      ...(v.temperatureK !== undefined && {
        absoluteHumidity: calculateAbsoluteHumidity(v.temperatureK, v.rhRatio),
      }),
    }),
    ...(v.pressurePa !== undefined && { pressure: v.pressurePa }),
    ...(v.visibilityM !== undefined && { horizontalVisibility: v.visibilityM }),
    ...(v.cloudCover !== undefined && { cloudCover: v.cloudCover }),
    ...(v.uvIndex !== undefined && { uvIndex: v.uvIndex }),
    ...(v.precipitationVolumeM !== undefined && { precipitationVolume: v.precipitationVolumeM }),
  };
}

/**
 * Build the SK v2 `sun` block from optional ISO sunrise and sunset strings,
 * omitting each field when it is absent and returning undefined when both are absent.
 */
export function buildSunBlock(
  sunrise: string | undefined,
  sunset: string | undefined
): SKSun | undefined {
  const sun: SKSun = {
    ...(typeof sunrise === 'string' && { sunrise }),
    ...(typeof sunset === 'string' && { sunset }),
  };
  return Object.keys(sun).length > 0 ? sun : undefined;
}

/** Build the SK v2 wind block from m/s speeds and a degree direction, omitting absent fields. */
export function buildWindFromMs(
  speedMs: number | null | undefined,
  directionDeg: number | null | undefined,
  gustMs: number | null | undefined
): SKWind | undefined {
  const wind: SKWind = {
    ...(typeof speedMs === 'number' && { speedTrue: speedMs }),
    ...(typeof directionDeg === 'number' && {
      directionTrue: normalizeAngle0To2Pi(degreesToRadians(directionDeg)),
    }),
    ...(typeof gustMs === 'number' && { gust: gustMs }),
  };
  return Object.keys(wind).length > 0 ? wind : undefined;
}
