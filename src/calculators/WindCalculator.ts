/**
 * Wind Calculator for Marine Applications
 * Vector calculations for apparent wind, wind chill, heat index, and dew point
 */

import { UNITS, VALIDATION_LIMITS } from '../constants/index.js';
import type { Logger, WindCalculationResult } from '../types/index.js';
import { calculateBeaufortScale as calculateBeaufortScaleUtil } from '../utils/conversions.js';

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
   * Calculate comprehensive wind analysis including validation
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

    return {
      apparentWindSpeed: this.calculateApparentWindSpeed(
        trueWindSpeed,
        vesselSpeed,
        vesselHeading,
        trueWindDirection
      ),
      apparentWindAngle: this.calculateApparentWindAngle(
        trueWindSpeed,
        vesselSpeed,
        vesselHeading,
        trueWindDirection
      ),
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
      return 0;
    }

    const tempC = temperatureK - UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
    const windKmh = windSpeedMs / UNITS.WIND_SPEED.KMH_TO_MS;

    // Wind chill only meaningful below 10°C and above 4.8 km/h
    if (tempC >= 10 || windKmh < 4.8) {
      return temperatureK;
    }

    const windChill =
      13.12 + 0.6215 * tempC - 11.37 * windKmh ** 0.16 + 0.3965 * tempC * windKmh ** 0.16;

    const result = windChill + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;

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

    const tempF = ((temperatureK - UNITS.TEMPERATURE.CELSIUS_TO_KELVIN) * 9) / 5 + 32;
    const rhPercent = Math.max(0, Math.min(100, relativeHumidity * 100));

    // Heat index only meaningful above 80°F and 40% humidity
    if (tempF < 80 || rhPercent < 40) {
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

    const result = ((heatIndex - 32) * 5) / 9 + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;

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

    const tempC = temperatureK - UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
    const rh = Math.max(0.01, Math.min(0.99, relativeHumidity));

    const a = 17.625;
    const b = 243.04;
    const gamma = (a * tempC) / (b + tempC) + Math.log(rh);
    const dewPointC = (b * gamma) / (a - gamma);
    const result = dewPointC + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;

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
    let windHeading = vesselHeading + apparentWindAngle;
    while (windHeading > Math.PI * 2) windHeading -= Math.PI * 2;
    while (windHeading < 0) windHeading += Math.PI * 2;
    return windHeading;
  }

  /**
   * Calculate magnetic wind direction from true direction and variation
   * @returns Magnetic wind direction in radians (0-2π)
   */
  public calculateWindDirectionMagnetic(directionTrue: number, magneticVariation: number): number {
    if (!Number.isFinite(directionTrue) || !Number.isFinite(magneticVariation)) {
      return directionTrue;
    }

    let directionMagnetic = directionTrue - magneticVariation;
    while (directionMagnetic < 0) directionMagnetic += Math.PI * 2;
    while (directionMagnetic > Math.PI * 2) directionMagnetic -= Math.PI * 2;
    return directionMagnetic;
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
    let angle = radians;
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle <= -Math.PI) angle += 2 * Math.PI;
    if (angle === Math.PI) angle = -Math.PI;
    return angle;
  }

  public convertWindSpeed(speedMs: number, targetUnit: 'kmh' | 'knots' | 'mph'): number {
    switch (targetUnit) {
      case 'kmh':
        return speedMs / UNITS.WIND_SPEED.KMH_TO_MS;
      case 'knots':
        return speedMs / UNITS.WIND_SPEED.KNOTS_TO_MS;
      case 'mph':
        return speedMs / UNITS.WIND_SPEED.MPH_TO_MS;
      default:
        return speedMs;
    }
  }

  public convertWindDirection(
    radiansDirection: number,
    format: 'degrees' | 'compass'
  ): string | number {
    const degrees = radiansDirection * UNITS.ANGLE.RADIANS_TO_DEGREES;

    if (format === 'degrees') {
      return Math.round(degrees);
    }

    const compassDirections = [
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
    ];
    const index = Math.round(degrees / 22.5) % 16;
    return compassDirections[index] || 'N';
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
