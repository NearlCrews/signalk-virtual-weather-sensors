/**
 * Wind Calculator for Marine Applications
 * Vector calculations for apparent wind, wind chill, heat index, and dew point
 */

import { MAGNUS, VALIDATION_LIMITS } from '../constants/index.js';
import type { Logger, WindCalculationResult } from '../types/index.js';
import {
  celsiusToKelvin,
  clamp,
  fahrenheitToKelvin,
  kelvinToCelsius,
  kelvinToFahrenheit,
  msToKMH,
  normalizeAnglePiToPi,
} from '../utils/conversions.js';

/**
 * Conservative fallback offset (Kelvin) for dew point when inputs are
 * non-finite or the formula yields a non-physical result. Picked because
 * an air-dewpoint spread of ~5 K is a typical low-humidity proxy.
 */
const DEW_POINT_FALLBACK_K = 5;

/** Wind chill is only meaningful below this temperature (Environment Canada). */
const WIND_CHILL_MAX_TEMP_C = 10;
/** Wind chill is only meaningful above this wind speed (Environment Canada). */
const WIND_CHILL_MIN_SPEED_KMH = 4.8;
/** Heat index requires the temperature to be above this value (Rothfusz regression). */
const HEAT_INDEX_MIN_TEMP_F = 80;
/**
 * Heat index requires humidity to be above this value (percentage). NWS
 * publishes the heat index only when RH >= 40 because the Rothfusz fit was
 * calibrated against humid conditions; below the gate we return the raw
 * temperature instead of synthesizing a heat-index estimate.
 */
const HEAT_INDEX_MIN_HUMIDITY_PCT = 40;

export class WindCalculator {
  private readonly logger: Logger;

  constructor(logger: Logger = () => {}) {
    this.logger = logger;
    this.logger('info', 'WindCalculator initialized');
  }

  /**
   * Apparent wind speed via vector addition. Delegates to
   * {@link calculateWindAnalysis} so the four shared sin/cos calls are
   * computed exactly once per call.
   */
  public calculateApparentWindSpeed(
    trueWindSpeed: number,
    vesselSpeed: number,
    vesselHeading: number,
    trueWindDirection: number
  ): number {
    return this.calculateWindAnalysis(trueWindSpeed, vesselSpeed, vesselHeading, trueWindDirection)
      .apparentWindSpeed;
  }

  /**
   * Apparent wind angle relative to vessel heading, in radians (-π to π).
   * Delegates to {@link calculateWindAnalysis} for the same reason as
   * {@link calculateApparentWindSpeed}.
   */
  public calculateApparentWindAngle(
    trueWindSpeed: number,
    vesselSpeed: number,
    vesselHeading: number,
    trueWindDirection: number
  ): number {
    return this.calculateWindAnalysis(trueWindSpeed, vesselSpeed, vesselHeading, trueWindDirection)
      .apparentWindAngle;
  }

  /**
   * Calculate comprehensive wind analysis including validation. Computes the
   * shared trig terms once and derives both apparent speed and angle from them
   * to avoid duplicating four sin/cos calls every emission tick.
   */
  public calculateWindAnalysis(
    trueWindSpeed: number,
    vesselSpeed: number,
    vesselHeading: number,
    trueWindDirection: number
  ): WindCalculationResult {
    if (!this.validateWindInputs(trueWindSpeed, vesselSpeed, vesselHeading, trueWindDirection)) {
      this.logger('warn', 'Invalid wind calculation inputs', {
        trueWindSpeed,
        vesselSpeed,
        vesselHeading,
        trueWindDirection,
      });
      return {
        apparentWindSpeed: trueWindSpeed || 0,
        apparentWindAngle: 0,
        isValid: false,
        validationErrors: ['Invalid input parameters'],
      };
    }

    const cosWind = Math.cos(trueWindDirection);
    const sinWind = Math.sin(trueWindDirection);
    const cosHeading = Math.cos(vesselHeading);
    const sinHeading = Math.sin(vesselHeading);

    const apparentWindX = trueWindSpeed * cosWind + vesselSpeed * cosHeading;
    const apparentWindY = trueWindSpeed * sinWind + vesselSpeed * sinHeading;

    const apparentSpeed = Math.sqrt(apparentWindX * apparentWindX + apparentWindY * apparentWindY);
    const apparentAngle = this.normalizeAngle(
      Math.atan2(apparentWindY, apparentWindX) - vesselHeading
    );

    return {
      apparentWindSpeed: Number.isFinite(apparentSpeed) ? apparentSpeed : trueWindSpeed,
      apparentWindAngle: apparentAngle,
      isValid: true,
    };
  }

  /**
   * Calculate wind chill using the Environment Canada formula
   * @returns Wind chill temperature in Kelvin
   */
  public calculateWindChill(temperatureK: number, windSpeedMs: number): number {
    if (!Number.isFinite(temperatureK) || !Number.isFinite(windSpeedMs)) {
      this.logger('warn', 'Invalid wind chill inputs', { temperatureK, windSpeedMs });
      return temperatureK || 0;
    }

    const tempC = kelvinToCelsius(temperatureK);
    const windKmh = msToKMH(windSpeedMs);

    if (tempC >= WIND_CHILL_MAX_TEMP_C || windKmh < WIND_CHILL_MIN_SPEED_KMH) {
      return temperatureK;
    }

    const windFactor = windKmh ** 0.16;
    const windChillC = 13.12 + 0.6215 * tempC + windFactor * (0.3965 * tempC - 11.37);
    const result = celsiusToKelvin(windChillC);

    return Number.isFinite(result) ? result : temperatureK;
  }

  /**
   * Calculate heat index using Rothfusz regression
   * @param relativeHumidity Relative humidity as ratio (0-1)
   * @returns Heat index in Kelvin
   */
  public calculateHeatIndex(temperatureK: number, relativeHumidity: number): number {
    if (!Number.isFinite(temperatureK) || !Number.isFinite(relativeHumidity)) {
      return temperatureK;
    }

    const tempF = kelvinToFahrenheit(temperatureK);
    const rhPercent = clamp(relativeHumidity * 100, 0, 100);

    if (tempF < HEAT_INDEX_MIN_TEMP_F || rhPercent < HEAT_INDEX_MIN_HUMIDITY_PCT) {
      return temperatureK;
    }

    const t = tempF;
    const r = rhPercent;

    let heatIndex =
      -42.379 +
      2.04901523 * t +
      10.14333127 * r +
      -0.22475541 * t * r +
      -0.00683783 * t * t +
      -0.05481717 * r * r +
      0.00122874 * t * t * r +
      0.00085282 * t * r * r +
      -0.00000199 * t * t * r * r;

    // High-humidity adjustment: only branch reachable from the public method,
    // since the HEAT_INDEX_MIN_HUMIDITY_PCT=40 gate above rules out the
    // companion low-humidity (r<13) Rothfusz correction the NWS publishes.
    // Keeping the low-humidity branch alongside would be dead code.
    if (r > 85 && t >= 80 && t <= 87) {
      heatIndex += ((r - 85) / 10) * ((87 - t) / 5);
    }

    const result = fahrenheitToKelvin(heatIndex);

    return Number.isFinite(result) ? result : temperatureK;
  }

  /**
   * Calculate dew point using the August-Roche-Magnus formula. Coefficients
   * `MAGNUS.A` and `MAGNUS.B` live in `constants/index.ts` so this function
   * and `conversions.calculateSaturationVaporPressure` share one source.
   * @param relativeHumidity Relative humidity as ratio (0-1)
   * @returns Dew point temperature in Kelvin
   */
  public calculateDewPoint(temperatureK: number, relativeHumidity: number): number {
    if (!Number.isFinite(temperatureK) || !Number.isFinite(relativeHumidity)) {
      return temperatureK - DEW_POINT_FALLBACK_K;
    }

    const tempC = kelvinToCelsius(temperatureK);
    const rh = clamp(relativeHumidity, 0.01, 0.99);
    const gamma = (MAGNUS.A * tempC) / (MAGNUS.B + tempC) + Math.log(rh);
    const dewPointC = (MAGNUS.B * gamma) / (MAGNUS.A - gamma);
    const result = celsiusToKelvin(dewPointC);

    if (!Number.isFinite(result) || result > temperatureK) {
      return temperatureK - DEW_POINT_FALLBACK_K;
    }

    return result;
  }

  private validateWindInputs(
    trueWindSpeed: number,
    vesselSpeed: number,
    vesselHeading: number,
    trueWindDirection: number
  ): boolean {
    return (
      typeof trueWindSpeed === 'number' &&
      Number.isFinite(trueWindSpeed) &&
      trueWindSpeed >= 0 &&
      trueWindSpeed <= VALIDATION_LIMITS.WIND_SPEED.MAX &&
      typeof vesselSpeed === 'number' &&
      Number.isFinite(vesselSpeed) &&
      vesselSpeed >= VALIDATION_LIMITS.VESSEL_SPEED.MIN &&
      vesselSpeed <= VALIDATION_LIMITS.VESSEL_SPEED.MAX &&
      typeof vesselHeading === 'number' &&
      Number.isFinite(vesselHeading) &&
      typeof trueWindDirection === 'number' &&
      Number.isFinite(trueWindDirection)
    );
  }

  public normalizeAngle(radians: number): number {
    return normalizeAnglePiToPi(radians);
  }
}
