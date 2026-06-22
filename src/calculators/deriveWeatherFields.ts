/**
 * Shared recompute of the WeatherData fields that are pure functions of the base
 * measurements (temperature, pressure, humidity, and sustained wind). The two
 * provider mappers and the merge engine all derive these the same way, so the
 * assembly lives here once. WBGT and heatStressIndex are NOT here: their source
 * differs by caller (a mapper estimates WBGT, the merge selects it), so each
 * caller computes those with the shared conversions helpers directly.
 */
import {
  calculateAbsoluteHumidity,
  calculateAirDensity,
  calculateBeaufortScale,
} from '../utils/conversions.js';
import { WindCalculator } from './WindCalculator.js';

const sharedWindCalculator = new WindCalculator();

export interface DerivedBaseFields {
  readonly windChill: number;
  readonly heatIndex: number;
  readonly beaufortScale: number;
  readonly absoluteHumidity: number;
  readonly airDensityEnhanced: number;
}

/** Recompute the base-derived fields from the SI base measurements. */
export function deriveBaseWeatherFields(
  temperatureK: number,
  pressurePa: number,
  humidity: number,
  windSpeedMs: number
): DerivedBaseFields {
  return {
    windChill: sharedWindCalculator.calculateWindChill(temperatureK, windSpeedMs),
    heatIndex: sharedWindCalculator.calculateHeatIndex(temperatureK, humidity),
    beaufortScale: calculateBeaufortScale(windSpeedMs),
    absoluteHumidity: calculateAbsoluteHumidity(temperatureK, humidity),
    airDensityEnhanced: calculateAirDensity(temperatureK, pressurePa, humidity),
  };
}
