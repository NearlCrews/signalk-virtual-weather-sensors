/**
 * Wind Calculator for Marine Applications
 * Vector calculations for apparent wind, wind chill, heat index, and dew point
 */

import { VALIDATION_LIMITS } from '../constants/index.js';
import type { Logger, WindCalculationResult } from '../types/index.js';
import {
  calculateBeaufortScale as calculateBeaufortScaleUtil,
  celsiusToKelvin,
  clamp,
  fahrenheitToKelvin,
  kelvinToCelsius,
  kelvinToFahrenheit,
  msToKMH,
  msToKnots,
  msToMPH,
  normalizeAngle0To2Pi,
  normalizeAnglePiToPi,
  radiansToDegrees,
} from '../utils/conversions.js';

const COMPASS_DIRECTIONS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const;

/** Wind chill is only meaningful below this temperature (Environment Canada). */
const WIND_CHILL_MAX_TEMP_C = 10;
/** Wind chill is only meaningful above this wind speed (Environment Canada). */
const WIND_CHILL_MIN_SPEED_KMH = 4.8;
/** Heat index requires the temperature to be above this value (Rothfusz regression). */
const HEAT_INDEX_MIN_TEMP_F = 80;
/** Heat index requires humidity to be above this value (percentage). */
const HEAT_INDEX_MIN_HUMIDITY_PCT = 40;

export class WindCalculator {
  private readonly logger: Logger;

  constructor(logger: Logger = () => {}) {
    this.logger = logger;
    this.logger('info', 'WindCalculator initialized');
  }

  /**
   * Calculate apparent wind speed using vector addition
   * @returns Apparent wind speed in m/s
   */
  public calculateApparentWindSpeed(
    trueWindSpeed: number,
    vesselSpeed: number,
    vesselHeading: number,
    trueWindDirection: number
  ): number {
    if (!this.validateWindInputs(trueWindSpeed, vesselSpeed, vesselHeading, trueWindDirection)) {
      this.logger('warn', 'Invalid wind calculation inputs', {
        trueWindSpeed,
        vesselSpeed,
        vesselHeading,
        trueWindDirection,
      });
      return trueWindSpeed || 0;
    }

    const apparentWindX =
      trueWindSpeed * Math.cos(trueWindDirection) + vesselSpeed * Math.cos(vesselHeading);
    const apparentWindY =
      trueWindSpeed * Math.sin(trueWindDirection) + vesselSpeed * Math.sin(vesselHeading);

    const apparentWindSpeed = Math.sqrt(apparentWindX ** 2 + apparentWindY ** 2);

    if (!Number.isFinite(apparentWindSpeed) || apparentWindSpeed < 0) {
      return trueWindSpeed;
    }

    return apparentWindSpeed;
  }

  /**
   * Calculate apparent wind angle relative to vessel heading
   * @returns Apparent wind angle relative to bow in radians (-π to π)
   */
  public calculateApparentWindAngle(
    trueWindSpeed: number,
    vesselSpeed: number,
    vesselHeading: number,
    trueWindDirection: number
  ): number {
    if (!this.validateWindInputs(trueWindSpeed, vesselSpeed, vesselHeading, trueWindDirection)) {
      this.logger('warn', 'Invalid wind angle calculation inputs');
      return trueWindDirection - vesselHeading;
    }

    const apparentWindX =
      trueWindSpeed * Math.cos(trueWindDirection) + vesselSpeed * Math.cos(vesselHeading);
    const apparentWindY =
      trueWindSpeed * Math.sin(trueWindDirection) + vesselSpeed * Math.sin(vesselHeading);

    const apparentWindDirection = Math.atan2(apparentWindY, apparentWindX);

    return this.normalizeAngle(apparentWindDirection - vesselHeading);
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

    // Adjustments for extreme conditions
    if (r < 13 && t >= 80 && t <= 112) {
      heatIndex -= ((13 - r) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
    } else if (r > 85 && t >= 80 && t <= 87) {
      heatIndex += ((r - 85) / 10) * ((87 - t) / 5);
    }

    const result = fahrenheitToKelvin(heatIndex);

    return Number.isFinite(result) ? result : temperatureK;
  }

  /**
   * Calculate dew point using Magnus formula
   * @param relativeHumidity Relative humidity as ratio (0-1)
   * @returns Dew point temperature in Kelvin
   */
  public calculateDewPoint(temperatureK: number, relativeHumidity: number): number {
    if (!Number.isFinite(temperatureK) || !Number.isFinite(relativeHumidity)) {
      return temperatureK - 5;
    }

    const tempC = kelvinToCelsius(temperatureK);
    const rh = clamp(relativeHumidity, 0.01, 0.99);

    const a = 17.625;
    const b = 243.04;
    const gamma = (a * tempC) / (b + tempC) + Math.log(rh);
    const dewPointC = (b * gamma) / (a - gamma);
    const result = celsiusToKelvin(dewPointC);

    if (!Number.isFinite(result) || result > temperatureK) {
      return temperatureK - 5;
    }

    return result;
  }

  public calculateBeaufortScale(windSpeed: number, gustSpeed?: number): number {
    return calculateBeaufortScaleUtil(windSpeed, gustSpeed);
  }

  /**
   * Calculate wind direction relative to vessel heading
   * @returns Relative wind direction in radians (-π to π)
   */
  public calculateRelativeWindDirection(windDirection: number, vesselHeading: number): number {
    return this.normalizeAngle(windDirection - vesselHeading);
  }

  /**
   * Calculate absolute wind direction from vessel heading and apparent wind angle
   * @returns Wind direction as absolute heading in radians (0-2π)
   */
  public calculateWindDirectionHeading(vesselHeading: number, apparentWindAngle: number): number {
    return normalizeAngle0To2Pi(vesselHeading + apparentWindAngle);
  }

  /**
   * Calculate magnetic wind direction from true direction and variation
   * @returns Magnetic wind direction in radians (0-2π)
   */
  public calculateWindDirectionMagnetic(directionTrue: number, magneticVariation: number): number {
    if (!Number.isFinite(directionTrue) || !Number.isFinite(magneticVariation)) {
      return directionTrue;
    }
    return normalizeAngle0To2Pi(directionTrue - magneticVariation);
  }

  public validateWindInputs(
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

  public convertWindSpeed(speedMs: number, targetUnit: 'kmh' | 'knots' | 'mph'): number {
    switch (targetUnit) {
      case 'kmh':
        return msToKMH(speedMs);
      case 'knots':
        return msToKnots(speedMs);
      case 'mph':
        return msToMPH(speedMs);
      default:
        return speedMs;
    }
  }

  public convertWindDirection(
    radiansDirection: number,
    format: 'degrees' | 'compass'
  ): string | number {
    const degrees = radiansToDegrees(radiansDirection);

    if (format === 'degrees') {
      return Math.round(degrees);
    }

    // Plain `% 16` returns negative values for port-tack apparent angles, which
    // would index out of the table. The double-modulo wraps them back into 0-15.
    const index = ((Math.round(degrees / 22.5) % 16) + 16) % 16;
    return COMPASS_DIRECTIONS[index] ?? 'N';
  }

  public getWindSummary(
    trueWindSpeed: number,
    vesselSpeed: number,
    vesselHeading: number,
    trueWindDirection: number
  ): {
    trueWind: { speed: number; direction: number };
    vesselMotion: { speed: number; heading: number };
    apparentWind: { speed: number; angle: number };
    beaufortScale: number;
    isValid: boolean;
  } {
    const analysis = this.calculateWindAnalysis(
      trueWindSpeed,
      vesselSpeed,
      vesselHeading,
      trueWindDirection
    );

    return {
      trueWind: { speed: trueWindSpeed, direction: trueWindDirection },
      vesselMotion: { speed: vesselSpeed, heading: vesselHeading },
      apparentWind: { speed: analysis.apparentWindSpeed, angle: analysis.apparentWindAngle },
      beaufortScale: this.calculateBeaufortScale(trueWindSpeed),
      isValid: analysis.isValid,
    };
  }
}
