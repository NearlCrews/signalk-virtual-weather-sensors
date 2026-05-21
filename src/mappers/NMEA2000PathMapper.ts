/**
 * NMEA2000 Path Mapper for Enhanced Weather Data
 * Maps comprehensive weather data to standardized NMEA2000 Signal K paths.
 */

import type { Delta, Meta, PathValue } from '@signalk/server-api';
import { NOTIFICATION_PATHS, SIGNALK_PATHS, UNITS } from '../constants/index.js';
import type { Logger, WeatherData } from '../types/index.js';
import { buildMetaDelta as buildSkMetaDelta, buildValuesDelta, me, pv } from '../utils/skDelta.js';
import { NMEA2000Validator } from '../utils/validation.js';

/**
 * Static meta block for paths outside the 1.8.2 vocabulary so the Admin UI
 * and Instrument Panel can render them with units and labels. Shipped once per
 * mapper instance via {@link NMEA2000PathMapper.buildMetaDelta}.
 */
const NON_CANONICAL_META: ReadonlyArray<Meta> = [
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.REAL_FEEL, {
    units: 'K',
    displayName: 'RealFeel',
    description:
      'AccuWeather RealFeel perceived temperature including solar load. Proprietary all-season index, distinct from the computed heat index on environment.outside.heatIndexTemperature.',
  }),
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
    description:
      'Past-hour average liquid-equivalent precipitation rate (from AccuWeather PrecipitationSummary.PastHour: a 1-hour accumulation expressed as an average rate).',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.TEMPERATURE_DEPARTURE_24H, {
    units: 'K',
    displayName: '24h temp departure',
    description:
      'Temperature DELTA (not absolute): current air temperature minus the temperature at the same hour 24 hours ago. Positive means warmer than yesterday. Reported in Kelvin because a 1 K delta equals a 1 C delta numerically; consumers must NOT apply a K-to-C subtraction.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.SPEED_GUST, {
    units: 'm/s',
    displayName: 'Wind gust speed',
    description:
      'Peak gust wind speed (ground-referenced). Sits under environment.weather.* because the 1.8.2 wind vocabulary does not define a gust leaf.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.GUST_FACTOR, {
    // No `units`: the value is a dimensionless multiplier that routinely
    // exceeds 1 (gust > sustained). `units: 'ratio'` would trip consumers
    // that clamp ratio paths to [0, 1] for percent-style rendering. Same
    // convention as `uvIndex`, `beaufortScale`, `heatStressIndex`.
    displayName: 'Wind gust factor',
    description:
      'Multiplier of peak gust over sustained wind speed (gust/sustained), always >= 1. Omitted when the upstream gust reading is not above the sustained wind speed. Plugin-derived; not in the 1.8.2 vocabulary.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.BEAUFORT_SCALE, {
    displayName: 'Beaufort scale',
    description:
      'Wind force category 0 (calm) to 12 (hurricane), derived from sustained wind speed. Plugin-derived; not in the 1.8.2 vocabulary.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.HEAT_STRESS_INDEX, {
    displayName: 'Heat stress index',
    description:
      'WBGT-derived heat-stress category on the US military WBGT flag cutoffs: 0 (<26.7 C), 1 (26.7..27.8 C), 2 (27.8..29.4 C), 3 (29.4..32.2 C), 4 (>=32.2 C).',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.WIND_SPEED_APPARENT, {
    units: 'm/s',
    displayName: 'Apparent wind speed',
    description:
      'Apparent wind speed calculated from AccuWeather ground-referenced wind and vessel motion. Plugin-derived; published off the canonical environment.wind leaves so it cannot displace a real anemometer feed.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.WIND_ANGLE_APPARENT, {
    units: 'rad',
    displayName: 'Apparent wind angle',
    description:
      'Apparent wind angle relative to the bow (-pi..pi, negative to port), calculated from AccuWeather wind and vessel motion. Plugin-derived; published off the canonical environment.wind leaves.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.DESCRIPTION, {
    displayName: 'Weather description',
    description: 'Plain-language summary of current conditions from AccuWeather (WeatherText).',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.PRESSURE_TENDENCY, {
    displayName: 'Pressure tendency',
    description:
      'Barometric trend over the past 3 hours: -1 falling, 0 steady, +1 rising. A falling barometer is a classic deteriorating-weather signal.',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.PRECIPITATION_TYPE, {
    displayName: 'Precipitation type',
    description: 'Precipitation type reported by AccuWeather (Rain, Snow, Ice, Mixed).',
  }),
  me(SIGNALK_PATHS.ENVIRONMENT.WEATHER.VISIBILITY_OBSTRUCTION, {
    displayName: 'Visibility obstruction',
    description: 'Obstruction reducing visibility (fog, haze, smoke) reported by AccuWeather.',
  }),
];

/**
 * Meta for each `notifications.environment.*` path the plugin emits. Lets
 * consumer UIs render the alert with a human label instead of the bare path,
 * and documents the threshold that activates each band so operators can map
 * SK notifications back to plugin behaviour without consulting the source.
 */
const NOTIFICATION_META: ReadonlyArray<Meta> = [
  me(NOTIFICATION_PATHS.WIND_GALE, {
    displayName: 'Wind, gale-force',
    description: 'Sustained Beaufort 8 or higher (gale): warn state.',
  }),
  me(NOTIFICATION_PATHS.WIND_STORM, {
    displayName: 'Wind, storm-force',
    description: 'Sustained Beaufort 10 or higher (storm): alarm state.',
  }),
  me(NOTIFICATION_PATHS.WIND_HURRICANE, {
    displayName: 'Wind, hurricane-force',
    description: 'Sustained Beaufort 12 (hurricane): emergency state.',
  }),
  me(NOTIFICATION_PATHS.VISIBILITY_LOW, {
    displayName: 'Visibility, reduced',
    description: "Visibility below 1 nautical mile (the plugin's restricted-visibility threshold).",
  }),
  me(NOTIFICATION_PATHS.VISIBILITY_VERY_LOW, {
    displayName: 'Visibility, very low',
    description: 'Visibility below 0.5 nautical miles: alarm state.',
  }),
  me(NOTIFICATION_PATHS.HEAT_CAUTION, {
    displayName: 'Heat stress, caution',
    description: 'WBGT-derived heat-stress index reaches caution band (HSI 2).',
  }),
  me(NOTIFICATION_PATHS.HEAT_HIGH, {
    displayName: 'Heat stress, high',
    description: 'WBGT-derived heat-stress index reaches high band (HSI 3): alarm state.',
  }),
  me(NOTIFICATION_PATHS.HEAT_EXTREME, {
    displayName: 'Heat stress, extreme',
    description: 'WBGT-derived heat-stress index reaches extreme band (HSI 4): emergency state.',
  }),
  me(NOTIFICATION_PATHS.COLD_CAUTION, {
    displayName: 'Cold exposure, caution',
    description: 'Wind chill below 0 C: warn state.',
  }),
  me(NOTIFICATION_PATHS.COLD_EXTREME, {
    displayName: 'Cold exposure, extreme',
    description: 'Wind chill below -20 C: alarm state.',
  }),
  me(NOTIFICATION_PATHS.WEATHER_SEVERE, {
    displayName: 'Severe weather',
    description:
      'Active when the current AccuWeather icon code maps to a hazard category (thunderstorm, ice, freezing rain, etc.).',
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
   *
   * Every numeric leaf this method emits is clamped or normalized upstream by
   * `NMEA2000Validator.sanitizeForNMEA2000`: temperatures into the NMEA2000
   * Kelvin window, apparent wind angle into the canonical (-pi, pi] convention,
   * speeds/visibility/ceilings into non-negative physical bounds, and derived
   * categorical indices (Beaufort, heat stress) into their defined ranges.
   * Adding a new emitted numeric field here requires a matching rule in the
   * sanitizer's NUMERIC_FIELD_RULES table. String leaves (description,
   * precipitationType, visibilityObstruction) carry no numeric range and pass
   * through the sanitizer untouched.
   */
  public mapToSignalKPaths(weatherData: WeatherData): Delta {
    const sanitizedData = NMEA2000Validator.sanitizeForNMEA2000(weatherData);
    const values: PathValue[] = [];

    this.addCoreEnvironmentalPaths(values, sanitizedData);
    this.addEnhancedTemperaturePaths(values, sanitizedData);
    this.addHumidityPaths(values, sanitizedData);
    this.addWindPaths(values, sanitizedData);
    this.addAtmosphericPaths(values, sanitizedData);
    this.addCalculatedPaths(values, sanitizedData);
    this.addPrecipitationPaths(values, sanitizedData);
    this.addSafetyPaths(values, sanitizedData);
    this.addConditionDetailPaths(values, sanitizedData);

    this.logger('debug', 'Enhanced NMEA2000 path mapping completed', {
      totalPaths: values.length,
    });

    // Carries the observation timestamp through to consumers; emission-time
    // restamping for re-broadcast happens at the plugin entry point.
    return buildValuesDelta(values, sanitizedData.timestamp);
  }

  /**
   * One-shot meta delta describing every non-canonical measurement path AND
   * every notifications.environment.* path this plugin emits. Caller is
   * responsible for sending it exactly once per mapper instance.
   */
  public buildMetaDelta(): Delta {
    return buildSkMetaDelta([...NON_CANONICAL_META, ...NOTIFICATION_META]);
  }

  private addCoreEnvironmentalPaths(values: PathValue[], data: WeatherData): void {
    values.push(
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.TEMPERATURE, data.temperature),
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRESSURE, data.pressure),
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.RELATIVE_HUMIDITY, data.humidity)
    );
  }

  /**
   * Condition-detail leaves decoded from AccuWeather: barometric tendency, the
   * plain-language description, precipitation type, and any visibility
   * obstruction. All producer-namespaced under environment.weather.*. Mirrors
   * `AccuWeatherService.extractConditionDetails` so the decode and emit sides
   * group the same fields.
   */
  private addConditionDetailPaths(values: PathValue[], data: WeatherData): void {
    if (data.pressureTendency !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.PRESSURE_TENDENCY, data.pressureTendency));
    }

    if (data.description !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.DESCRIPTION, data.description));
    }

    if (data.precipitationType !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.PRECIPITATION_TYPE, data.precipitationType));
    }

    if (data.visibilityObstruction !== undefined) {
      values.push(
        pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.VISIBILITY_OBSTRUCTION, data.visibilityObstruction)
      );
    }
  }

  private addEnhancedTemperaturePaths(values: PathValue[], data: WeatherData): void {
    // windChill is the theoretical (true-wind) wind chill. The apparent-wind
    // chill leaf gets the vessel-motion-corrected value when nav data allowed
    // it to be derived, falling back to the theoretical value otherwise (when
    // the vessel is not moving, apparent wind equals true wind).
    values.push(
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.DEW_POINT_TEMPERATURE, data.dewPoint),
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.THEORETICAL_WIND_CHILL_TEMPERATURE, data.windChill),
      pv(
        SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.APPARENT_WIND_CHILL_TEMPERATURE,
        data.apparentWindChill ?? data.windChill
      ),
      pv(SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.HEAT_INDEX_TEMPERATURE, data.heatIndex)
    );

    if (data.realFeel !== undefined) {
      values.push(pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.REAL_FEEL, data.realFeel));
    }

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
    // AccuWeather wind is ground-referenced: emit only speedOverGround and
    // directionTrue. speedTrue and the canonical apparent leaves are left
    // unset so they cannot clobber a real anemometer feed. Calculated apparent
    // wind goes on producer-namespaced environment.weather.* paths instead.
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
      values.push(
        pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.WIND_SPEED_APPARENT, data.apparentWindSpeed)
      );
    }

    if (data.apparentWindAngle !== undefined) {
      values.push(
        pv(SIGNALK_PATHS.ENVIRONMENT.WEATHER.WIND_ANGLE_APPARENT, data.apparentWindAngle)
      );
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
}
