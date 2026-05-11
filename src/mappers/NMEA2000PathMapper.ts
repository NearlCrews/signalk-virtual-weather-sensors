/**
 * NMEA2000 Path Mapper for Enhanced Weather Data
 * Maps comprehensive weather data to standardized NMEA2000 Signal K paths.
 */

import type {
  Context,
  Delta,
  Meta,
  MetaValue,
  Path,
  PathValue,
  SourceRef,
} from '@signalk/server-api';
import { PLUGIN, SIGNALK_PATHS, UNITS } from '../constants/index.js';
import type { Logger, WeatherData } from '../types/index.js';
import { asTimestamp } from '../utils/conversions.js';
import { NMEA2000Validator } from '../utils/validation.js';

const SELF_CONTEXT = 'vessels.self' as Context;
const ACCUWEATHER_SOURCE = PLUGIN.SOURCE_REF as SourceRef;

/** Build a Signal K PathValue, casting the plain string path to the branded Path type. */
const pv = (path: string, value: unknown): PathValue => ({
  path: path as Path,
  value: value as PathValue['value'],
});

/** Build a Signal K Meta entry, casting the plain string path to the branded Path type. */
const me = (path: string, value: MetaValue): Meta => ({ path: path as Path, value });

/**
 * Static meta block for paths outside the 1.8.2 vocabulary so the Admin UI
 * and Instrument Panel can render them with units and labels. Shipped once per
 * mapper instance via {@link NMEA2000PathMapper.buildMetaDelta}.
 */
const NON_CANONICAL_META: ReadonlyArray<Meta> = [
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.REAL_FEEL_SHADE, {
    units: 'K',
    displayName: 'RealFeel (shade)',
    description:
      'AccuWeather RealFeel perceived temperature in shade (factors in wind and humidity, excludes solar gain).',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.WET_BULB_TEMPERATURE, {
    units: 'K',
    displayName: 'Wet bulb temperature',
    description:
      'Lowest temperature reachable by evaporative cooling at the current air temperature and humidity.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.WET_BULB_GLOBE_TEMPERATURE, {
    units: 'K',
    displayName: 'Wet bulb globe temp',
    description:
      'WBGT: composite heat-stress index combining wet bulb, dry bulb, and globe (radiant) temperatures. Source of environment.weather.heatStressIndex.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.APPARENT_TEMPERATURE, {
    units: 'K',
    displayName: 'Apparent temperature',
    description:
      'AccuWeather apparent (feels-like) temperature combining wind and humidity effects across the full thermal range.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.ABSOLUTE_HUMIDITY, {
    units: 'kg/m3',
    displayName: 'Absolute humidity',
    description:
      'Mass of water vapor per cubic meter of air (derived from temperature and relative humidity).',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.UV_INDEX, {
    displayName: 'UV index',
    description:
      'WHO solar UV scale: 0..2 low, 3..5 moderate, 6..7 high, 8..10 very high, 11+ extreme.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.VISIBILITY, {
    units: 'm',
    displayName: 'Visibility',
    description: 'Horizontal visibility distance reported by AccuWeather.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.CLOUD_COVER, {
    units: 'ratio',
    displayName: 'Cloud cover',
    description: 'Fraction of sky covered by clouds: 0 (clear) to 1 (overcast).',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.CLOUD_CEILING, {
    units: 'm',
    displayName: 'Cloud ceiling',
    description: 'Altitude of the lowest cloud layer covering more than half the sky.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.PRECIPITATION_LAST_HOUR, {
    units: 'm',
    displayName: 'Precipitation, last hour',
    description: 'Liquid-equivalent precipitation depth accumulated over the past hour.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.PRECIPITATION_CURRENT, {
    units: 'm/s',
    displayName: 'Precipitation rate',
    description: 'Current liquid-equivalent precipitation rate.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.TEMPERATURE_DEPARTURE_24H, {
    units: 'K',
    displayName: '24h temp departure',
    description:
      'Difference between current air temperature and the temperature at the same hour 24 hours ago (positive = warmer than yesterday).',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.SPEED_GUST, {
    units: 'm/s',
    displayName: 'Wind gust speed',
    description:
      'Peak gust wind speed (ground-referenced). Sits under environment.weather.* because the 1.8.2 wind vocabulary does not define a gust leaf.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.GUST_FACTOR, {
    units: 'ratio',
    displayName: 'Wind gust factor',
    description:
      'Ratio of peak gust to sustained wind speed (gust/sustained). Plugin-derived; not in the 1.8.2 vocabulary.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.BEAUFORT_SCALE, {
    displayName: 'Beaufort scale',
    description:
      'Wind force category 0 (calm) to 12 (hurricane), derived from sustained wind speed. Plugin-derived; not in the 1.8.2 vocabulary.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.HEAT_STRESS_INDEX, {
    displayName: 'Heat stress index',
    description:
      'WBGT-derived heat-stress category: 0 low (<27 C), 1 moderate (27..29 C), 2 high (29..31 C), 3 very high (31..33 C), 4 extreme (>=33 C). Standard military/marine WBGT bands.',
  }),
];

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
   * Map comprehensive weather data to a values-only Signal K delta. Meta for
   * non-canonical paths is emitted separately via {@link buildMetaDelta} so it
   * is shipped only when it changes (Signal K spec data_model.html).
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
      updates: [{ $source: ACCUWEATHER_SOURCE, timestamp, values }],
    };
  }

  /**
   * One-shot meta delta describing every non-canonical path this plugin
   * emits. Caller is responsible for sending it exactly once per mapper
   * instance.
   */
  public buildMetaDelta(): Delta {
    return {
      context: SELF_CONTEXT,
      updates: [
        {
          $source: ACCUWEATHER_SOURCE,
          timestamp: asTimestamp(new Date().toISOString()),
          meta: [...NON_CANONICAL_META],
        },
      ],
    };
  }

  private addCoreEnvironmentalPaths(values: PathValue[], data: WeatherData): void {
    values.push(
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.TEMPERATURE, data.temperature),
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRESSURE, data.pressure),
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.RELATIVE_HUMIDITY, data.humidity)
    );
  }

  private addEnhancedTemperaturePaths(values: PathValue[], data: WeatherData): void {
    values.push(
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.DEW_POINT_TEMPERATURE, data.dewPoint),
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.APPARENT_WIND_CHILL_TEMPERATURE, data.windChill),
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.HEAT_INDEX_TEMPERATURE, data.heatIndex)
    );

    if (data.realFeelShade !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.REAL_FEEL_SHADE, data.realFeelShade));
    }

    if (data.wetBulbTemperature !== undefined) {
      values.push(
        pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.WET_BULB_TEMPERATURE, data.wetBulbTemperature)
      );
    }

    if (data.wetBulbGlobeTemperature !== undefined) {
      values.push(
        pv(
          SIGNALK_PATHS.ENVIRONMENT.WEATHER.WET_BULB_GLOBE_TEMPERATURE,
          data.wetBulbGlobeTemperature
        )
      );
    }

    if (data.apparentTemperature !== undefined) {
      values.push(
        pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.APPARENT_TEMPERATURE, data.apparentTemperature)
      );
    }
  }

  private addHumidityPaths(values: PathValue[], data: WeatherData): void {
    if (data.absoluteHumidity !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.ABSOLUTE_HUMIDITY, data.absoluteHumidity));
    }
  }

  private addWindPaths(values: PathValue[], data: WeatherData): void {
    // AccuWeather wind is ground-referenced. We emit only to speedOverGround
    // and directionTrue. speedTrue (water-referenced) would diverge from this
    // value on any moving vessel and would clobber a real anemometer feed,
    // so we deliberately do not emit it. Consumers (or this plugin's apparent
    // wind calculator) derive water-referenced wind from speedOverGround.
    values.push(
      pv(SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_OVER_GROUND, data.windSpeed),
      pv(SIGNALK_PATHS.ENVIRONMENT.WIND.DIRECTION_TRUE, data.windDirection)
    );

    if (data.windGustSpeed !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.SPEED_GUST, data.windGustSpeed));
    }

    if (data.windGustFactor !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.GUST_FACTOR, data.windGustFactor));
    }

    if (data.beaufortScale !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.BEAUFORT_SCALE, data.beaufortScale));
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
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.UV_INDEX, data.uvIndex));
    }

    if (data.visibility !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.VISIBILITY, data.visibility));
    }

    if (data.cloudCover !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.CLOUD_COVER, data.cloudCover));
    }

    if (data.cloudCeiling !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.CLOUD_CEILING, data.cloudCeiling));
    }
  }

  private addCalculatedPaths(values: PathValue[], data: WeatherData): void {
    if (data.airDensityEnhanced !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.AIR_DENSITY, data.airDensityEnhanced));
    }
  }

  private addPrecipitationPaths(values: PathValue[], data: WeatherData): void {
    if (data.precipitationLastHour !== undefined) {
      values.push(
        pv(
          SIGNALK_PATHS.ENVIRONMENT.WEATHER.PRECIPITATION_LAST_HOUR,
          data.precipitationLastHour * UNITS.PRECIPITATION.MM_TO_M
        )
      );
    }

    if (data.precipitationCurrent !== undefined) {
      values.push(
        pv(
          SIGNALK_PATHS.ENVIRONMENT.WEATHER.PRECIPITATION_CURRENT,
          data.precipitationCurrent * UNITS.PRECIPITATION.MMH_TO_MS
        )
      );
    }
  }

  private addSafetyPaths(values: PathValue[], data: WeatherData): void {
    if (data.heatStressIndex !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.HEAT_STRESS_INDEX, data.heatStressIndex));
    }

    if (data.temperatureDeparture24h !== undefined) {
      values.push(
        pv(
          SIGNALK_PATHS.ENVIRONMENT.WEATHER.TEMPERATURE_DEPARTURE_24H,
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
  SIGNALK_PATHS.ENVIRONMENT.WEATHER.REAL_FEEL_SHADE,
  SIGNALK_PATHS.ENVIRONMENT.WEATHER.WET_BULB_TEMPERATURE,
  SIGNALK_PATHS.ENVIRONMENT.WEATHER.WET_BULB_GLOBE_TEMPERATURE,
  SIGNALK_PATHS.ENVIRONMENT.WEATHER.APPARENT_TEMPERATURE,
  SIGNALK_PATHS.ENVIRONMENT.WEATHER.UV_INDEX,
  SIGNALK_PATHS.ENVIRONMENT.WEATHER.VISIBILITY,
  SIGNALK_PATHS.ENVIRONMENT.WEATHER.CLOUD_COVER,
  SIGNALK_PATHS.ENVIRONMENT.WEATHER.CLOUD_CEILING,
  SIGNALK_PATHS.ENVIRONMENT.WEATHER.ABSOLUTE_HUMIDITY,
  SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.AIR_DENSITY,
  SIGNALK_PATHS.ENVIRONMENT.WEATHER.HEAT_STRESS_INDEX,
  SIGNALK_PATHS.ENVIRONMENT.WEATHER.TEMPERATURE_DEPARTURE_24H,
  SIGNALK_PATHS.ENVIRONMENT.WEATHER.PRECIPITATION_LAST_HOUR,
  SIGNALK_PATHS.ENVIRONMENT.WEATHER.PRECIPITATION_CURRENT,
  SIGNALK_PATHS.ENVIRONMENT.WEATHER.SPEED_GUST,
  SIGNALK_PATHS.ENVIRONMENT.WEATHER.GUST_FACTOR,
  SIGNALK_PATHS.ENVIRONMENT.WEATHER.BEAUFORT_SCALE,
  SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_APPARENT,
  SIGNALK_PATHS.ENVIRONMENT.WIND.ANGLE_APPARENT,
]);
