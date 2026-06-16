/**
 * Pure Open-Meteo Marine current-block to internal SI `MarineData` mapping.
 *
 * Every field is optional: the marine model returns nulls for inland points and
 * partial responses for sparse coverage, so the mapper emits only what is
 * present rather than throwing. Unit conversions: directions degrees to radians
 * (normalized to 0..2pi), sea surface temperature Celsius to Kelvin, and ocean
 * current km/h to m/s. Wave and swell directions are kept as the direction the
 * waves come FROM (true); the current direction is the set (toward, true).
 */

import type { MarineData, OpenMeteoMarineResponse } from '../types/index.js';
import {
  asOptionalNumber,
  celsiusToKelvin,
  degreesToRadians,
  kmhToMS,
  normalizeAngle0To2Pi,
} from '../utils/conversions.js';

/** Convert an optional degree bearing to radians normalized to [0, 2pi). */
function toRadians(value: unknown): number | undefined {
  const deg = asOptionalNumber(value);
  return deg !== undefined ? normalizeAngle0To2Pi(degreesToRadians(deg)) : undefined;
}

/** Map an Open-Meteo Marine current block to SI `MarineData`. Returns only present fields. */
export function mapOpenMeteoMarineToMarineData(response: OpenMeteoMarineResponse): MarineData {
  const current = response.current ?? {};

  const significantWaveHeight = asOptionalNumber(current.wave_height);
  const waveDirection = toRadians(current.wave_direction);
  const wavePeriod = asOptionalNumber(current.wave_period);
  const windWaveHeight = asOptionalNumber(current.wind_wave_height);
  const swellHeight = asOptionalNumber(current.swell_wave_height);
  const swellDirection = toRadians(current.swell_wave_direction);
  const swellPeriod = asOptionalNumber(current.swell_wave_period);

  const rawSst = asOptionalNumber(current.sea_surface_temperature);
  const seaSurfaceTemperature = rawSst !== undefined ? celsiusToKelvin(rawSst) : undefined;

  const rawCurrentKmh = asOptionalNumber(current.ocean_current_velocity);
  const surfaceCurrentSpeed = rawCurrentKmh !== undefined ? kmhToMS(rawCurrentKmh) : undefined;
  const surfaceCurrentDirection = toRadians(current.ocean_current_direction);

  return {
    timestamp: typeof current.time === 'string' ? current.time : '',
    ...(significantWaveHeight !== undefined && { significantWaveHeight }),
    ...(waveDirection !== undefined && { waveDirection }),
    ...(wavePeriod !== undefined && { wavePeriod }),
    ...(windWaveHeight !== undefined && { windWaveHeight }),
    ...(swellHeight !== undefined && { swellHeight }),
    ...(swellDirection !== undefined && { swellDirection }),
    ...(swellPeriod !== undefined && { swellPeriod }),
    ...(seaSurfaceTemperature !== undefined && { seaSurfaceTemperature }),
    ...(surfaceCurrentSpeed !== undefined && { surfaceCurrentSpeed }),
    ...(surfaceCurrentDirection !== undefined && { surfaceCurrentDirection }),
  };
}

/** True when a marine reading carries no usable sea-state fields (e.g. an inland point). */
export function isMarineDataEmpty(data: MarineData): boolean {
  return (
    data.significantWaveHeight === undefined &&
    data.swellHeight === undefined &&
    data.windWaveHeight === undefined &&
    data.seaSurfaceTemperature === undefined &&
    data.surfaceCurrentSpeed === undefined
  );
}
