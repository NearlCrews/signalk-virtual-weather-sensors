/**
 * Shared recompute of the WeatherData fields that are pure functions of the base
 * measurements (temperature, pressure, humidity, and sustained wind). The
 * provider mappers and the merge engine all derive these the same way, so the
 * assembly lives here once. WBGT and heatStressIndex are NOT in
 * `deriveBaseWeatherFields`: their source differs by caller (a keyless mapper
 * estimates WBGT, AccuWeather measures it, the merge selects it), so the
 * keyless estimate lives in `buildKeylessBaseWeatherData` below.
 */
import type { WeatherData } from '../types/index.js';
import {
  calculateAbsoluteHumidity,
  calculateAirDensity,
  calculateBeaufortScale,
  calculateHeatStressIndex,
  celsiusToKelvin,
  degreesToRadians,
  estimateWetBulbGlobeTemperature,
  millibarsToPA,
  normalizeAngle0To2Pi,
  percentageToRatio,
} from '../utils/conversions.js';
import { WindCalculator } from './WindCalculator.js';

// Deliberately constructed with the default no-op logger: every caller feeds
// values already validated by its own mapper or the merge engine, so the
// calculator's invalid-input warnings cannot fire here in practice, and a
// module-level singleton cannot receive a per-plugin logger anyway.
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

/** The six required readings, in the units both keyless APIs report them. */
export interface KeylessBaseReadings {
  readonly temperatureC: number;
  readonly pressureHpa: number;
  readonly humidityPercent: number;
  readonly windSpeedMs: number;
  /** Direction the wind blows FROM, degrees true. */
  readonly windFromDeg: number;
  readonly dewPointC: number;
  /** Validated RFC 3339 observation time. */
  readonly timestamp: string;
}

/**
 * Build the required `WeatherData` fields from a keyless provider's readings.
 * Open-Meteo and Met.no carry no wind chill and no measured wet-bulb globe
 * temperature, so wind chill and heat index are recomputed from the true wind
 * (as the AccuWeather path does when its own value is absent) and WBGT is
 * estimated so the heat-stress band still works. The estimate is a shade
 * formula (see `estimateWetBulbGlobeTemperature`), so it reads low in strong sun.
 */
export function buildKeylessBaseWeatherData(readings: KeylessBaseReadings): WeatherData {
  const temperature = celsiusToKelvin(readings.temperatureC);
  const pressure = millibarsToPA(readings.pressureHpa);
  const humidity = percentageToRatio(readings.humidityPercent);
  const windSpeed = readings.windSpeedMs;
  const wetBulbGlobeTemperature = estimateWetBulbGlobeTemperature(temperature, humidity);
  return {
    temperature,
    pressure,
    humidity,
    windSpeed,
    windDirection: normalizeAngle0To2Pi(degreesToRadians(readings.windFromDeg)),
    dewPoint: celsiusToKelvin(readings.dewPointC),
    ...deriveBaseWeatherFields(temperature, pressure, humidity, windSpeed),
    wetBulbGlobeTemperature,
    heatStressIndex: calculateHeatStressIndex(wetBulbGlobeTemperature),
    timestamp: readings.timestamp,
  };
}
