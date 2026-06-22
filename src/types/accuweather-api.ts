/**
 * AccuWeather API response shapes for signalk-virtual-weather-sensors.
 * These types are a contract for what the plugin consumes, not a full mirror
 * of the AccuWeather schema.
 */

/** AccuWeather metric/imperial measurement pair */
type AcwMeasurement = { readonly Value: number; readonly Unit: string };
/** AccuWeather measurement that includes a phrase for "RealFeel" responses */
type AcwPhrasedMeasurement = AcwMeasurement & { readonly Phrase: string };
/** Bilingual measurement pair returned by AccuWeather */
type AcwMetricPair = { readonly Metric: AcwMeasurement; readonly Imperial: AcwMeasurement };

/**
 * AccuWeather API specific configuration
 */
export interface AccuWeatherConfig {
  readonly apiKey: string;
  readonly locationCacheTimeout: number;
  readonly requestTimeout: number;
  readonly retryAttempts: number;
  readonly retryDelay: number;
  /**
   * Rolling-24h API call cap used to self-gate forecast fetches. 0 (or omitted)
   * disables the cap. Mirrors PluginConfiguration.dailyApiQuota; index.ts passes
   * the configured value so the provider and the current-conditions loop share
   * one quota budget.
   */
  readonly dailyApiQuota?: number;
}

/**
 * AccuWeather API current conditions response.
 *
 * Only fields actually consumed by the plugin are typed: the type is a
 * contract for what the plugin uses, not a full mirror of the AccuWeather
 * schema. MobileLink and Link (web URLs) and IndoorRelativeHumidity (irrelevant
 * to a vessel) stay omitted on purpose.
 */
export interface AccuWeatherCurrentConditions {
  readonly LocalObservationDateTime: string;
  readonly EpochTime: number;
  /** Plain-English description of the current condition (e.g. "Partly cloudy"). */
  readonly WeatherText: string;
  /**
   * AccuWeather icon code (1..44) used to map severe-condition categories
   * (thunderstorms, ice, freezing rain, etc.) into Signal K notifications.
   */
  readonly WeatherIcon: number;

  // Core temperature data
  readonly Temperature: AcwMetricPair;

  // Enhanced temperature readings
  readonly RealFeelTemperature: {
    readonly Metric: AcwPhrasedMeasurement;
    readonly Imperial: AcwPhrasedMeasurement;
  };
  readonly RealFeelTemperatureShade: {
    readonly Metric: AcwPhrasedMeasurement;
    readonly Imperial: AcwPhrasedMeasurement;
  };
  readonly ApparentTemperature: AcwMetricPair;
  readonly WindChillTemperature: AcwMetricPair;
  readonly WetBulbTemperature: AcwMetricPair;
  readonly WetBulbGlobeTemperature: AcwMetricPair;
  readonly DewPoint: AcwMetricPair;

  // Humidity
  readonly RelativeHumidity: number;

  // Wind
  readonly Wind: {
    readonly Speed: AcwMetricPair;
    readonly Direction: {
      readonly Degrees: number;
      readonly Localized: string;
      readonly English: string;
    };
  };
  /** Optional: free-tier and partial responses may omit WindGust entirely. */
  readonly WindGust?: {
    readonly Speed: AcwMetricPair;
  };

  // Pressure
  readonly Pressure: AcwMetricPair;

  // Atmospheric conditions
  readonly UVIndex: number;
  readonly UVIndexFloat: number;
  readonly Visibility: AcwMetricPair;
  readonly CloudCover: number;
  readonly Ceiling: AcwMetricPair;

  // Temperature trends
  readonly Past24HourTemperatureDeparture: AcwMetricPair;

  // Precipitation: liquid-equivalent accumulation over the past hour.
  readonly Precip1hr: AcwMetricPair;

  // Optional condition detail: free-tier and partial responses may omit these.
  /** Barometric tendency. `Code` is "F" falling, "S" steady, "R" rising. */
  readonly PressureTendency?: {
    readonly Code: string;
  };
  /** Precipitation type ("Rain", "Snow", "Ice", "Mixed"); null when none. */
  readonly PrecipitationType?: string | null;
  /** Obstruction reducing visibility (e.g. "Fog"); empty string when none. */
  readonly ObstructionsToVisibility?: string;
}

/**
 * AccuWeather location search response
 */
export interface AccuWeatherLocation {
  readonly Key: string;
  readonly LocalizedName: string;
  readonly Country: {
    readonly ID: string;
    readonly LocalizedName: string;
  };
  readonly AdministrativeArea: {
    readonly ID: string;
    readonly LocalizedName: string;
  };
  readonly GeoPosition: {
    readonly Latitude: number;
    readonly Longitude: number;
  };
}

/**
 * AccuWeather 12-hour hourly forecast element (one per hour). Fetched with
 * `metric=true`, so each measurement is a flat `{ Value, Unit }` in metric units
 * (Celsius, km/h, km, mm); there is no Metric/Imperial pair as in current
 * conditions. Only fields the plugin maps are typed: this is a contract for what
 * we use, not a full mirror of the AccuWeather schema. Every field except
 * `DateTime` and `Temperature` is optional because the free tier and partial
 * responses omit blocks.
 */
export interface AccuWeatherHourlyForecast {
  readonly DateTime: string;
  readonly IconPhrase?: string;
  readonly HasPrecipitation?: boolean;
  readonly PrecipitationType?: string | null;
  readonly Temperature: AcwMeasurement;
  readonly RealFeelTemperature?: AcwMeasurement;
  readonly DewPoint?: AcwMeasurement;
  readonly Wind?: {
    readonly Speed: AcwMeasurement;
    readonly Direction: { readonly Degrees: number };
  };
  readonly WindGust?: { readonly Speed: AcwMeasurement };
  readonly RelativeHumidity?: number;
  readonly Visibility?: AcwMeasurement;
  readonly UVIndex?: number;
  readonly CloudCover?: number;
  readonly TotalLiquid?: AcwMeasurement;
}

/** Day or Night half of an AccuWeather daily forecast entry. */
export interface AccuWeatherDailyHalf {
  readonly IconPhrase?: string;
  readonly HasPrecipitation?: boolean;
  readonly PrecipitationType?: string | null;
  readonly Wind?: {
    readonly Speed: AcwMeasurement;
    readonly Direction: { readonly Degrees: number };
  };
  readonly WindGust?: { readonly Speed: AcwMeasurement };
  readonly TotalLiquid?: AcwMeasurement;
  readonly CloudCover?: number;
}

/** One day in an AccuWeather 5-day daily forecast. */
export interface AccuWeatherDailyForecast {
  readonly Date: string;
  readonly Temperature: { readonly Minimum: AcwMeasurement; readonly Maximum: AcwMeasurement };
  readonly Day?: AccuWeatherDailyHalf;
  readonly Night?: AccuWeatherDailyHalf;
  readonly Sun?: { readonly Rise?: string; readonly Set?: string };
  readonly AirAndPollen?: ReadonlyArray<{
    readonly Name: string;
    readonly Value: number;
    readonly Category: string;
  }>;
}

/** AccuWeather 5-day daily forecast response envelope. */
export interface AccuWeatherDailyForecastResponse {
  readonly Headline?: { readonly Text?: string };
  readonly DailyForecasts: ReadonlyArray<AccuWeatherDailyForecast>;
}
