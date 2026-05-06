/**
 * NMEA2000 Path Mapper for Enhanced Weather Data
 * Maps comprehensive weather data to standardized NMEA2000 Signal K paths.
 */

import type { Context, Delta, Path, PathValue, Timestamp } from '@signalk/server-api';
import { SIGNALK_PATHS } from '../constants/index.js';
import type { Logger, WeatherData } from '../types/index.js';
import { NMEA2000Validator } from '../utils/validation.js';

const SELF_CONTEXT = 'vessels.self' as Context;

const asTimestamp = (ts: string): Timestamp => ts as Timestamp;

/** Build a Signal K PathValue, casting the plain string path to the branded Path type. */
const pv = (path: string, value: unknown): PathValue => ({
  path: path as Path,
  value: value as PathValue['value'],
});

/** Millimeters to meters (Signal K precipitation depth uses meters). */
const MM_TO_M = 1 / 1000;
/** Millimeters per hour to meters per second (Signal K precipitation rate uses m/s). */
const MMH_TO_MS = 1 / (1000 * 3600);

/**
 * NMEA2000 Path Mapper Service
 * Provides comprehensive mapping of weather data to NMEA2000-compatible Signal K paths
 */
export class NMEA2000PathMapper {
  private readonly logger: Logger;

  constructor(logger: Logger = () => {}) {
    this.logger = logger;
    this.logger('info', 'NMEA2000PathMapper initialized');
  }

  /**
   * Map comprehensive weather data to NMEA2000 Signal K paths
   * @param weatherData Enhanced weather data from AccuWeather
   * @returns Signal K delta message with complete NMEA2000 mappings
   */
  public mapToSignalKPaths(weatherData: WeatherData): Delta {
    const sanitizedData = NMEA2000Validator.sanitizeForNMEA2000(weatherData);
    const timestamp = asTimestamp(sanitizedData.timestamp || new Date().toISOString());
    const values: PathValue[] = [];

    this.addCoreEnvironmentalPaths(values, sanitizedData);
    this.addEnhancedTemperaturePaths(values, sanitizedData);
    this.addHumidityPaths(values, sanitizedData);
    this.addWindPaths(values, sanitizedData);
    this.addAtmosphericPaths(values, sanitizedData);
    this.addCalculatedPaths(values, sanitizedData);
    this.addPrecipitationPaths(values, sanitizedData);
    this.addSafetyPaths(values, sanitizedData);

    this.logger('debug', 'Enhanced NMEA2000 path mapping completed', {
      totalPaths: values.length,
      enhancedFields: this.countEnhancedFields(values),
    });

    return {
      context: SELF_CONTEXT,
      updates: [
        {
          timestamp,
          values,
        },
      ],
    };
  }

  private addCoreEnvironmentalPaths(values: PathValue[], data: WeatherData): void {
    values.push(
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.TEMPERATURE, data.temperature),
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRESSURE, data.pressure),
      // Signal K spec: ratio (0-1)
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.HUMIDITY, data.humidity)
    );
  }

  private addEnhancedTemperaturePaths(values: PathValue[], data: WeatherData): void {
    values.push(
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.DEW_POINT_TEMPERATURE, data.dewPoint),
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.WIND_CHILL_TEMPERATURE, data.windChill),
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.HEAT_INDEX_TEMPERATURE, data.heatIndex)
    );

    if (data.realFeelShade !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.REAL_FEEL_SHADE, data.realFeelShade));
    }

    if (data.wetBulbTemperature !== undefined) {
      values.push(
        pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.WET_BULB_TEMPERATURE, data.wetBulbTemperature)
      );
    }

    if (data.wetBulbGlobeTemperature !== undefined) {
      values.push(
        pv(
          SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.WET_BULB_GLOBE_TEMPERATURE,
          data.wetBulbGlobeTemperature
        )
      );
    }

    if (data.apparentTemperature !== undefined) {
      values.push(
        pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.APPARENT_TEMPERATURE, data.apparentTemperature)
      );
    }
  }

  private addHumidityPaths(values: PathValue[], data: WeatherData): void {
    if (data.absoluteHumidity !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.ABSOLUTE_HUMIDITY, data.absoluteHumidity));
    }
  }

  private addWindPaths(values: PathValue[], data: WeatherData): void {
    values.push(
      pv(SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_TRUE, data.windSpeed),
      pv(SIGNALK_PATHS.ENVIRONMENT.WIND.DIRECTION_TRUE, data.windDirection),
      // speedOverGround mirrors speedTrue for weather API data;
      // required by signalk-nmea2000-emitter-cannon's WIND_TRUE_GROUND PGN generator.
      pv(SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_OVER_GROUND, data.windSpeed)
    );

    if (data.windGustSpeed !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_GUST, data.windGustSpeed));
    }

    if (data.windGustFactor !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WIND.GUST_FACTOR, data.windGustFactor));
    }

    if (data.beaufortScale !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WIND.BEAUFORT_SCALE, data.beaufortScale));
    }

    if (data.apparentWindSpeed !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_APPARENT, data.apparentWindSpeed));
    }

    if (data.apparentWindAngle !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WIND.ANGLE_APPARENT, data.apparentWindAngle));
    }
  }

  private addAtmosphericPaths(values: PathValue[], data: WeatherData): void {
    if (data.uvIndex !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.UV_INDEX, data.uvIndex));
    }

    if (data.visibility !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.VISIBILITY, data.visibility));
    }

    if (data.cloudCover !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.CLOUD_COVER, data.cloudCover));
    }

    if (data.cloudCeiling !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.CLOUD_CEILING, data.cloudCeiling));
    }
  }

  private addCalculatedPaths(values: PathValue[], data: WeatherData): void {
    if (data.airDensityEnhanced !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.AIR_DENSITY, data.airDensityEnhanced));
    }
  }

  private addPrecipitationPaths(values: PathValue[], data: WeatherData): void {
    // Signal K expects precipitation depth in meters (source is mm).
    if (data.precipitationLastHour !== undefined) {
      values.push(
        pv(
          SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRECIPITATION_LAST_HOUR,
          data.precipitationLastHour * MM_TO_M
        )
      );
    }

    // Signal K expects precipitation rate in m/s (source is mm/h).
    if (data.precipitationCurrent !== undefined) {
      values.push(
        pv(
          SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRECIPITATION_CURRENT,
          data.precipitationCurrent * MMH_TO_MS
        )
      );
    }
  }

  private addSafetyPaths(values: PathValue[], data: WeatherData): void {
    if (data.heatStressIndex !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.HEAT_STRESS_INDEX, data.heatStressIndex));
    }

    if (data.temperatureDeparture24h !== undefined) {
      values.push(
        pv(
          SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.TEMPERATURE_DEPARTURE_24H,
          data.temperatureDeparture24h
        )
      );
    }
  }

  private countEnhancedFields(values: PathValue[]): number {
    let count = 0;
    for (const v of values) {
      if (ENHANCED_PATHS.has(v.path)) count++;
    }
    return count;
  }
}

/**
 * Set of Signal K paths that count as "enhanced" fields (beyond the core
 * temperature/pressure/humidity/wind set). Used by debug logging.
 */
const ENHANCED_PATHS: ReadonlySet<string> = new Set([
  SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.REAL_FEEL_SHADE,
  SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.WET_BULB_TEMPERATURE,
  SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.WET_BULB_GLOBE_TEMPERATURE,
  SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.APPARENT_TEMPERATURE,
  SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.UV_INDEX,
  SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.VISIBILITY,
  SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.CLOUD_COVER,
  SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.CLOUD_CEILING,
  SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.ABSOLUTE_HUMIDITY,
  SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.AIR_DENSITY,
  SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.HEAT_STRESS_INDEX,
  SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.TEMPERATURE_DEPARTURE_24H,
  SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRECIPITATION_LAST_HOUR,
  SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRECIPITATION_CURRENT,
  SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_GUST,
  SIGNALK_PATHS.ENVIRONMENT.WIND.GUST_FACTOR,
  SIGNALK_PATHS.ENVIRONMENT.WIND.BEAUFORT_SCALE,
  SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_APPARENT,
  SIGNALK_PATHS.ENVIRONMENT.WIND.ANGLE_APPARENT,
]);
