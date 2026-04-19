/**
 * NMEA2000 Path Mapper for Enhanced Weather Data
 * Maps comprehensive weather data to standardized NMEA2000 Signal K paths.
 */

import { SIGNALK_PATHS } from '../constants/index.js';
import type { Logger, SignalKDelta, WeatherData } from '../types/index.js';
import { NMEA2000Validator } from '../utils/validation.js';

interface PathValue {
  readonly path: string;
  readonly value: unknown;
}

/**
 * NMEA2000 Path Mapper Service
 * Provides comprehensive mapping of weather data to NMEA2000-compatible Signal K paths
 */
export class NMEA2000PathMapper {
  private readonly logger: Logger;

  constructor(logger: Logger = () => {}) {
    this.logger = logger;
    this.logger('info', 'NMEA2000PathMapper initialized with enhanced emitter-cannon alignment');
  }

  /**
   * Map comprehensive weather data to NMEA2000 Signal K paths
   * @param weatherData Enhanced weather data from AccuWeather
   * @returns Signal K delta message with complete NMEA2000 mappings
   */
  public mapToSignalKPaths(weatherData: WeatherData): SignalKDelta {
    const sanitizedData = NMEA2000Validator.sanitizeForNMEA2000(weatherData);
    const timestamp = sanitizedData.timestamp || new Date().toISOString();
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
      context: 'vessels.self',
      updates: [
        {
          timestamp,
          values,
        },
      ],
    };
  }

  /**
   * Add core environmental measurement paths (PGN 130311, 130312 base)
   */
  private addCoreEnvironmentalPaths(values: PathValue[], data: WeatherData): void {
    values.push(
      { path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.TEMPERATURE, value: data.temperature },
      { path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRESSURE, value: data.pressure },
      // Signal K spec: ratio (0-1)
      { path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.HUMIDITY, value: data.humidity }
    );
  }

  /**
   * Add enhanced temperature readings (multiple PGN 130312 instances)
   */
  private addEnhancedTemperaturePaths(values: PathValue[], data: WeatherData): void {
    values.push(
      { path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.DEW_POINT_TEMPERATURE, value: data.dewPoint },
      {
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.WIND_CHILL_TEMPERATURE,
        value: data.windChill,
      },
      {
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.HEAT_INDEX_TEMPERATURE,
        value: data.heatIndex,
      }
    );

    if (data.realFeelShade !== undefined) {
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.REAL_FEEL_SHADE,
        value: data.realFeelShade,
      });
    }

    if (data.wetBulbTemperature !== undefined) {
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.WET_BULB_TEMPERATURE,
        value: data.wetBulbTemperature,
      });
    }

    if (data.wetBulbGlobeTemperature !== undefined) {
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.WET_BULB_GLOBE_TEMPERATURE,
        value: data.wetBulbGlobeTemperature,
      });
    }

    if (data.apparentTemperature !== undefined) {
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.APPARENT_TEMPERATURE,
        value: data.apparentTemperature,
      });
    }
  }

  /**
   * Add humidity measurements (PGN 130313 instances)
   */
  private addHumidityPaths(values: PathValue[], data: WeatherData): void {
    if (data.absoluteHumidity !== undefined) {
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.ABSOLUTE_HUMIDITY,
        value: data.absoluteHumidity,
      });
    }
  }

  /**
   * Add comprehensive wind data (enhanced PGN 130306)
   */
  private addWindPaths(values: PathValue[], data: WeatherData): void {
    values.push(
      { path: SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_TRUE, value: data.windSpeed },
      { path: SIGNALK_PATHS.ENVIRONMENT.WIND.DIRECTION_TRUE, value: data.windDirection },
      // speedOverGround mirrors speedTrue for weather API data
      // Required by emitter-cannon WIND_TRUE_GROUND PGN generator
      { path: SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_OVER_GROUND, value: data.windSpeed }
    );

    if (data.windGustSpeed !== undefined) {
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_GUST,
        value: data.windGustSpeed,
      });
    }

    if (data.windGustFactor !== undefined) {
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.WIND.GUST_FACTOR,
        value: data.windGustFactor,
      });
    }

    if (data.beaufortScale !== undefined) {
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.WIND.BEAUFORT_SCALE,
        value: data.beaufortScale,
      });
    }

    if (data.apparentWindSpeed !== undefined) {
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_APPARENT,
        value: data.apparentWindSpeed,
      });
    }

    if (data.apparentWindAngle !== undefined) {
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.WIND.ANGLE_APPARENT,
        value: data.apparentWindAngle,
      });
    }
  }

  /**
   * Add atmospheric conditions and visibility data
   */
  private addAtmosphericPaths(values: PathValue[], data: WeatherData): void {
    if (data.uvIndex !== undefined) {
      values.push({ path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.UV_INDEX, value: data.uvIndex });
    }

    if (data.visibility !== undefined) {
      values.push({ path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.VISIBILITY, value: data.visibility });
    }

    if (data.cloudCover !== undefined) {
      values.push({ path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.CLOUD_COVER, value: data.cloudCover });
    }

    if (data.cloudCeiling !== undefined) {
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.CLOUD_CEILING,
        value: data.cloudCeiling,
      });
    }
  }

  /**
   * Add calculated atmospheric properties
   */
  private addCalculatedPaths(values: PathValue[], data: WeatherData): void {
    if (data.airDensityEnhanced !== undefined) {
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.AIR_DENSITY,
        value: data.airDensityEnhanced,
      });
    }
  }

  /**
   * Add precipitation data paths
   */
  private addPrecipitationPaths(values: PathValue[], data: WeatherData): void {
    // Signal K expects precipitation depth in meters (source is mm).
    if (data.precipitationLastHour !== undefined) {
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRECIPITATION_LAST_HOUR,
        value: data.precipitationLastHour / 1000,
      });
    }

    // Signal K expects precipitation rate in m/s (source is mm/h).
    if (data.precipitationCurrent !== undefined) {
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRECIPITATION_CURRENT,
        value: data.precipitationCurrent / (1000 * 3600),
      });
    }
  }

  /**
   * Add marine safety and comfort indices
   */
  private addSafetyPaths(values: PathValue[], data: WeatherData): void {
    if (data.heatStressIndex !== undefined) {
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.HEAT_STRESS_INDEX,
        value: data.heatStressIndex,
      });
    }

    if (data.temperatureDeparture24h !== undefined) {
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.TEMPERATURE_DEPARTURE_24H,
        value: data.temperatureDeparture24h,
      });
    }
  }

  private countEnhancedFields(values: PathValue[]): number {
    const enhancedPaths = [
      'realFeelShade',
      'wetBulbTemperature',
      'wetBulbGlobeTemperature',
      'windGust',
      'uvIndex',
      'visibility',
      'cloudCover',
      'beaufortScale',
      'absoluteHumidity',
      'airDensity',
      'heatStress',
    ];

    return values.filter((v) => enhancedPaths.some((enhanced) => v.path.includes(enhanced))).length;
  }
}
