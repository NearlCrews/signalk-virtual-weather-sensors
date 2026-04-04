/**
 * Wind Calculator for Marine Applications
 * Modern TypeScript implementation of vector calculations for apparent wind, wind chill, heat index, and dew point
 * Following standard meteorological formulas and marine navigation practices
 */

import { UNITS, VALIDATION_LIMITS } from '../constants/index.js';
import type { LogLevel, WindCalculationResult } from '../types/index.js';
import { calculateBeaufortScale as calculateBeaufortScaleUtil } from '../utils/conversions.js';

/**
 * Wind Calculator Service
 * Provides precise meteorological calculations for marine environments
 */
export class WindCalculator {
  private readonly logger: (
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>
  ) => void;

  constructor(
    logger: (
      level: LogLevel,
      message: string,
      metadata?: Record<string, unknown>
    ) => void = () => {}
  ) {
    this.logger = logger;
    this.logger('info', 'WindCalculator initialized');
  }

  /**
   * Calculate apparent wind speed using precise vector addition
   * @param trueWindSpeed True wind speed in m/s
   * @param vesselSpeed Vessel speed over ground in m/s
   * @param vesselHeading Vessel heading in radians
   * @param trueWindDirection True wind direction in radians
   * @returns Apparent wind speed in m/s
   */
  public calculateApparentWindSpeed(
    trueWindSpeed: number,
    vesselSpeed: number,
    vesselHeading: number,
    trueWindDirection: number
  ): number {
    try {
      // Validate inputs
      if (!this.validateWindInputs(trueWindSpeed, vesselSpeed, vesselHeading, trueWindDirection)) {
        this.logger('warn', 'Invalid wind calculation inputs', {
          trueWindSpeed,
          vesselSpeed,
          vesselHeading,
          trueWindDirection,
        });
        return trueWindSpeed || 0;
      }

      // Convert wind direction to vector components
      const trueWindX = trueWindSpeed * Math.cos(trueWindDirection);
      const trueWindY = trueWindSpeed * Math.sin(trueWindDirection);

      // Convert vessel velocity to vector components
      const vesselX = vesselSpeed * Math.cos(vesselHeading);
      const vesselY = vesselSpeed * Math.sin(vesselHeading);

      // Calculate apparent wind vector (true wind + vessel velocity)
      // Note: Vessel velocity adds to wind because we're moving through the air
      const apparentWindX = trueWindX + vesselX;
      const apparentWindY = trueWindY + vesselY;

      // Calculate apparent wind speed from vector components
      const apparentWindSpeed = Math.sqrt(apparentWindX ** 2 + apparentWindY ** 2);

      // Validate result
      if (!Number.isFinite(apparentWindSpeed) || apparentWindSpeed < 0) {
        this.logger('warn', 'Invalid apparent wind speed calculated', { apparentWindSpeed });
        return trueWindSpeed;
      }

      return apparentWindSpeed;
    } catch (error) {
      this.logger('error', 'Error calculating apparent wind speed', {
        error: error instanceof Error ? error.message : String(error),
        trueWindSpeed,
        vesselSpeed,
      });
      return trueWindSpeed || 0;
    }
  }

  /**
   * Calculate apparent wind angle relative to vessel heading
   * @param trueWindSpeed True wind speed in m/s
   * @param vesselSpeed Vessel speed over ground in m/s
   * @param vesselHeading Vessel heading in radians
   * @param trueWindDirection True wind direction in radians
   * @returns Apparent wind angle relative to bow in radians (-π to π)
   */
  public calculateApparentWindAngle(
    trueWindSpeed: number,
    vesselSpeed: number,
    vesselHeading: number,
    trueWindDirection: number
  ): number {
    try {
      // Validate inputs
      if (!this.validateWindInputs(trueWindSpeed, vesselSpeed, vesselHeading, trueWindDirection)) {
        this.logger('warn', 'Invalid wind angle calculation inputs');
        return trueWindDirection - vesselHeading;
      }

      // Convert wind direction to vector components
      const trueWindX = trueWindSpeed * Math.cos(trueWindDirection);
      const trueWindY = trueWindSpeed * Math.sin(trueWindDirection);

      // Convert vessel velocity to vector components
      const vesselX = vesselSpeed * Math.cos(vesselHeading);
      const vesselY = vesselSpeed * Math.sin(vesselHeading);

      // Calculate apparent wind vector (true wind + vessel velocity)
      const apparentWindX = trueWindX + vesselX;
      const apparentWindY = trueWindY + vesselY;

      // Calculate apparent wind direction
      const apparentWindDirection = Math.atan2(apparentWindY, apparentWindX);

      // Calculate angle relative to vessel heading
      let relativeAngle = apparentWindDirection - vesselHeading;

      // Normalize to -π to π range
      relativeAngle = this.normalizeAngle(relativeAngle);

      return relativeAngle;
    } catch (error) {
      this.logger('error', 'Error calculating apparent wind angle', {
        error: error instanceof Error ? error.message : String(error),
        trueWindDirection,
        vesselHeading,
      });
      return trueWindDirection - vesselHeading;
    }
  }

  /**
   * Calculate comprehensive wind analysis including validation
   * @param trueWindSpeed True wind speed in m/s
   * @param vesselSpeed Vessel speed over ground in m/s
   * @param vesselHeading Vessel heading in radians
   * @param trueWindDirection True wind direction in radians
   * @returns Complete wind calculation result with validation
   */
  public calculateWindAnalysis(
    trueWindSpeed: number,
    vesselSpeed: number,
    vesselHeading: number,
    trueWindDirection: number
  ): WindCalculationResult {
    const validationErrors: string[] = [];

    // Validate all inputs
    if (!this.validateWindInputs(trueWindSpeed, vesselSpeed, vesselHeading, trueWindDirection)) {
      validationErrors.push('Invalid input parameters');
    }

    if (validationErrors.length > 0) {
      return {
        apparentWindSpeed: trueWindSpeed || 0,
        apparentWindAngle: 0,
        isValid: false,
        validationErrors,
      };
    }

    try {
      const apparentWindSpeed = this.calculateApparentWindSpeed(
        trueWindSpeed,
        vesselSpeed,
        vesselHeading,
        trueWindDirection
      );

      const apparentWindAngle = this.calculateApparentWindAngle(
        trueWindSpeed,
        vesselSpeed,
        vesselHeading,
        trueWindDirection
      );

      return {
        apparentWindSpeed,
        apparentWindAngle,
        isValid: true,
      };
    } catch (error) {
      this.logger('error', 'Wind analysis calculation failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        apparentWindSpeed: trueWindSpeed || 0,
        apparentWindAngle: 0,
        isValid: false,
        validationErrors: ['Calculation error'],
      };
    }
  }

  /**
   * Calculate wind chill temperature using the modern Environment Canada formula
   * @param temperatureK Air temperature in Kelvin
   * @param windSpeedMs Wind speed in m/s
   * @returns Wind chill temperature in Kelvin
   */
  public calculateWindChill(temperatureK: number, windSpeedMs: number): number {
    try {
      if (
        typeof temperatureK !== 'number' ||
        typeof windSpeedMs !== 'number' ||
        !Number.isFinite(temperatureK) ||
        !Number.isFinite(windSpeedMs)
      ) {
        this.logger('warn', 'Invalid wind chill inputs', { temperatureK, windSpeedMs });
        return 0;
      }

      // Convert to Celsius and km/h for calculation
      const tempC = temperatureK - UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
      const windKmh = windSpeedMs / UNITS.WIND_SPEED.KMH_TO_MS;

      // Wind chill is only meaningful for temperatures below 10°C and wind speeds above 4.8 km/h
      if (tempC >= 10 || windKmh < 4.8) {
        return temperatureK;
      }

      // Modern wind chill formula (Environment Canada / US National Weather Service)
      const windChill =
        13.12 + 0.6215 * tempC - 11.37 * windKmh ** 0.16 + 0.3965 * tempC * windKmh ** 0.16;

      const result = windChill + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;

      // Validate result
      if (!Number.isFinite(result)) {
        this.logger('warn', 'Invalid wind chill result', { windChill, result });
        return temperatureK;
      }

      return result;
    } catch (error) {
      this.logger('error', 'Error calculating wind chill', {
        error: error instanceof Error ? error.message : String(error),
        temperatureK,
        windSpeedMs,
      });
      return temperatureK;
    }
  }

  /**
   * Calculate heat index (apparent temperature) using Rothfusz regression
   * @param temperatureK Air temperature in Kelvin
   * @param relativeHumidity Relative humidity as ratio (0-1)
   * @returns Heat index in Kelvin
   */
  public calculateHeatIndex(temperatureK: number, relativeHumidity: number): number {
    try {
      if (typeof temperatureK !== 'number' || typeof relativeHumidity !== 'number') {
        this.logger('warn', 'Invalid heat index inputs', { temperatureK, relativeHumidity });
        return temperatureK;
      }

      // Convert to Fahrenheit and percentage for calculation
      const tempF = ((temperatureK - UNITS.TEMPERATURE.CELSIUS_TO_KELVIN) * 9) / 5 + 32;
      const rhPercent = Math.max(0, Math.min(100, relativeHumidity * 100));

      // Heat index is only meaningful for temperatures above 80°F (26.7°C) and humidity above 40%
      if (tempF < 80 || rhPercent < 40) {
        return temperatureK;
      }

      // Rothfusz regression equation coefficients
      const c1 = -42.379;
      const c2 = 2.04901523;
      const c3 = 10.14333127;
      const c4 = -0.22475541;
      const c5 = -0.00683783;
      const c6 = -0.05481717;
      const c7 = 0.00122874;
      const c8 = 0.00085282;
      const c9 = -0.00000199;

      const t = tempF;
      const r = rhPercent;

      let heatIndex =
        c1 +
        c2 * t +
        c3 * r +
        c4 * t * r +
        c5 * t * t +
        c6 * r * r +
        c7 * t * t * r +
        c8 * t * r * r +
        c9 * t * t * r * r;

      // Apply adjustments for extreme conditions
      if (r < 13 && t >= 80 && t <= 112) {
        const adjustment = ((13 - r) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
        heatIndex -= adjustment;
      } else if (r > 85 && t >= 80 && t <= 87) {
        const adjustment = ((r - 85) / 10) * ((87 - t) / 5);
        heatIndex += adjustment;
      }

      // Convert back to Kelvin
      const result = ((heatIndex - 32) * 5) / 9 + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;

      // Validate result
      if (!Number.isFinite(result)) {
        this.logger('warn', 'Invalid heat index result', { heatIndex, result });
        return temperatureK;
      }

      return result;
    } catch (error) {
      this.logger('error', 'Error calculating heat index', {
        error: error instanceof Error ? error.message : String(error),
        temperatureK,
        relativeHumidity,
      });
      return temperatureK;
    }
  }

  /**
   * Calculate dew point temperature using Magnus formula
   * @param temperatureK Air temperature in Kelvin
   * @param relativeHumidity Relative humidity as ratio (0-1)
   * @returns Dew point temperature in Kelvin
   */
  public calculateDewPoint(temperatureK: number, relativeHumidity: number): number {
    try {
      if (typeof temperatureK !== 'number' || typeof relativeHumidity !== 'number') {
        this.logger('warn', 'Invalid dew point inputs', { temperatureK, relativeHumidity });
        return temperatureK - 5; // Reasonable default
      }

      const tempC = temperatureK - UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
      const rh = Math.max(0.01, Math.min(0.99, relativeHumidity)); // Clamp to valid range

      // Magnus formula constants (adjust for better accuracy)
      const a = 17.625;
      const b = 243.04;

      // Calculate gamma
      const gamma = (a * tempC) / (b + tempC) + Math.log(rh);

      // Calculate dew point
      const dewPointC = (b * gamma) / (a - gamma);
      const result = dewPointC + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;

      // Validate result (dew point should be <= air temperature)
      if (!Number.isFinite(result) || result > temperatureK) {
        this.logger('warn', 'Invalid dew point result', { dewPointC, result, temperatureK });
        return temperatureK - 5; // Reasonable default
      }

      return result;
    } catch (error) {
      this.logger('error', 'Error calculating dew point', {
        error: error instanceof Error ? error.message : String(error),
        temperatureK,
        relativeHumidity,
      });
      return temperatureK - 5; // Reasonable default
    }
  }

  /**
   * Calculate Beaufort wind scale from wind speed
   * Uses shared utility function for consistency across services
   * @param windSpeed Wind speed in m/s
   * @param gustSpeed Optional gust speed in m/s
   * @returns Beaufort scale (0-12)
   */
  public calculateBeaufortScale(windSpeed: number, gustSpeed?: number): number {
    return calculateBeaufortScaleUtil(windSpeed, gustSpeed);
  }

  /**
   * Calculate wind direction relative to vessel heading
   * @param windDirection Wind direction in radians (absolute)
   * @param vesselHeading Vessel heading in radians
   * @returns Relative wind direction in radians (-π to π)
   */
  public calculateRelativeWindDirection(windDirection: number, vesselHeading: number): number {
    try {
      const relativeDirection = windDirection - vesselHeading;
      return this.normalizeAngle(relativeDirection);
    } catch (error) {
      this.logger('error', 'Error calculating relative wind direction', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Calculate absolute wind direction (heading) from vessel heading and apparent wind angle
   * @param vesselHeading Vessel heading in radians (true)
   * @param apparentWindAngle Apparent wind angle in radians (relative to bow)
   * @returns Wind direction as absolute heading in radians (0-2π)
   */
  public calculateWindDirectionHeading(vesselHeading: number, apparentWindAngle: number): number {
    try {
      let windHeading = vesselHeading + apparentWindAngle;

      // Normalize to 0-2π range
      while (windHeading > Math.PI * 2) windHeading -= Math.PI * 2;
      while (windHeading < 0) windHeading += Math.PI * 2;

      return windHeading;
    } catch (error) {
      this.logger('error', 'Error calculating wind direction heading', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Calculate magnetic wind direction from true wind direction and magnetic variation
   * @param directionTrue True wind direction in radians
   * @param magneticVariation Magnetic variation in radians (positive = East)
   * @returns Magnetic wind direction in radians (0-2π)
   */
  public calculateWindDirectionMagnetic(directionTrue: number, magneticVariation: number): number {
    try {
      if (!Number.isFinite(directionTrue) || !Number.isFinite(magneticVariation)) {
        return directionTrue;
      }

      let directionMagnetic = directionTrue - magneticVariation;

      // Normalize to 0-2π range
      while (directionMagnetic < 0) directionMagnetic += Math.PI * 2;
      while (directionMagnetic > Math.PI * 2) directionMagnetic -= Math.PI * 2;

      return directionMagnetic;
    } catch (error) {
      this.logger('error', 'Error calculating magnetic wind direction', {
        error: error instanceof Error ? error.message : String(error),
      });
      return directionTrue;
    }
  }

  /**
   * Validate wind calculation inputs
   */
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

  /**
   * Normalize angle to -π to π range
   */
  public normalizeAngle(radians: number): number {
    let angle = radians;
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle <= -Math.PI) angle += 2 * Math.PI;
    // Handle edge case where angle is exactly PI or -PI
    if (angle === Math.PI) angle = -Math.PI;
    return angle;
  }

  /**
   * Convert wind speed units for display/logging
   */
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

  /**
   * Convert wind direction for display/logging
   */
  public convertWindDirection(
    radiansDirection: number,
    format: 'degrees' | 'compass'
  ): string | number {
    const degrees = radiansDirection * UNITS.ANGLE.RADIANS_TO_DEGREES;

    if (format === 'degrees') {
      return Math.round(degrees);
    }

    // Convert to compass direction
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

  /**
   * Get wind analysis summary for logging/debugging
   */
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
      trueWind: {
        speed: trueWindSpeed,
        direction: trueWindDirection,
      },
      vesselMotion: {
        speed: vesselSpeed,
        heading: vesselHeading,
      },
      apparentWind: {
        speed: analysis.apparentWindSpeed,
        angle: analysis.apparentWindAngle,
      },
      beaufortScale: this.calculateBeaufortScale(trueWindSpeed),
      isValid: analysis.isValid,
    };
  }
}
