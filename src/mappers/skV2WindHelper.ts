/**
 * Shared SK v2 Weather API envelope helpers. The wind-block assembly is shared
 * by every provider mapper so the m/s conversion and the [0, 2pi) direction
 * normalization live in one place. Speeds are m/s here; a provider whose source
 * is km/h converts before calling (see WeatherProviderMapper.buildWind).
 */
import type { WeatherData as SKWeatherData } from '@signalk/server-api';
import { degreesToRadians, normalizeAngle0To2Pi } from '../utils/conversions.js';

export type SKOutside = NonNullable<SKWeatherData['outside']>;
export type SKWind = NonNullable<SKWeatherData['wind']>;
export type SKSun = NonNullable<SKWeatherData['sun']>;

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
