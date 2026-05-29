/**
 * AccuWeather API Service
 * Modern TypeScript implementation with comprehensive error handling and enhanced field extraction
 */

import { WindCalculator } from '../calculators/WindCalculator.js';
import {
  ACCUWEATHER,
  DEFAULT_CONFIG,
  ERROR_CODES,
  FORECAST_CACHE,
  PLUGIN,
  UNITS,
} from '../constants/index.js';
import type {
  AccuWeatherConfig,
  AccuWeatherCurrentConditions,
  AccuWeatherDailyForecastResponse,
  AccuWeatherHourlyForecast,
  AccuWeatherLocation,
  GeoLocation,
  Logger,
  WeatherData,
} from '../types/index.js';
import {
  asOptionalNumber,
  calculateAbsoluteHumidity,
  calculateAirDensity,
  calculateBeaufortScale,
  celsiusToKelvin,
  degreesToRadians,
  isApiQuotaReached,
  isValidCoordinates,
  isValidHumidity,
  isValidPressure,
  isValidTemperature,
  isValidWindSpeed,
  kelvinToCelsius,
  kmhToMS,
  millibarsToPA,
  normalizeAngle0To2Pi,
  percentageToRatio,
  toErrorMessage,
  truncateToCodePoints,
} from '../utils/conversions.js';
import { validateAccuWeatherResponse } from '../utils/validation.js';

/**
 * Shared WindCalculator used for the computed heat index and the wind-chill
 * fallback. Stateless apart from its logger, so one module-level instance is
 * reused instead of constructing one per weather transform.
 */
const sharedWindCalculator = new WindCalculator();

/** Maximum allowed response body size in bytes (1 MiB) */
const MAX_RESPONSE_BYTES = 1_048_576;

/** Validation pattern for AccuWeather location keys (URL path segment). */
const LOCATION_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Strip control characters and truncate a string from the API to a safe length
 * for downstream consumers. Truncation walks code points (via `Array.from`)
 * so a surrogate-pair character (emoji, CJK supplementary) at the boundary
 * cannot leave a lone surrogate that breaks JSON-encoded downstream consumers.
 * The runtime `typeof` guard catches real-world API responses where a field
 * typed `string` arrives as null/undefined/number; the response schema is a
 * contract for what we use, not a guarantee the wire matches it.
 */
function capString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately stripping injection vectors
  const stripped = value.replace(/[\x00-\x1f\x7f]/g, '');
  return truncateToCodePoints(stripped, maxLength);
}

/**
 * Lowercased retryable error code substrings, computed once at module load
 * so isRetryableError doesn't recompute on every retry classification.
 */
const RETRYABLE_ERROR_SUBSTRINGS: ReadonlySet<string> = new Set([
  ERROR_CODES.NETWORK.API_RATE_LIMIT.toLowerCase(),
  ERROR_CODES.NETWORK.NETWORK_ERROR.toLowerCase(),
  'timeout',
  'econnreset',
  'enotfound',
]);

/**
 * AccuWeather API client for weather data operations
 * Provides type-safe interface to AccuWeather REST API with caching and error handling
 */
/** Maximum number of entries in location cache before pruning */
const MAX_CACHE_SIZE = 100;

/** How often the location cache prune sweep runs (5 minutes). */
const CACHE_PRUNE_INTERVAL_MS = 5 * 60 * 1000;

/** Upper bound on Retry-After delays we honor, regardless of header value. */
const MAX_RETRY_AFTER_MS = 60_000;

/** Number of hourly buckets in the rolling 24h request window. */
const REQUEST_WINDOW_HOURS = 24;
/** Hour expressed in milliseconds, used by the rolling window rotation. */
const HOUR_MS = 60 * 60 * 1000;

/**
 * Heat-stress index from wet-bulb globe temperature, banded on the US military
 * WBGT flag cutoffs (green 26.7, yellow 27.8, red 29.4, black 32.2 C). A
 * precautionary bias on a crew-safety index favours these standard flag
 * values over looser bands that would activate each warning roughly 0.5 to
 * 1.5 C late.
 */
function calculateHeatStressIndex(wetBulbGlobeTemperatureK: number): number {
  const wbgtC = kelvinToCelsius(wetBulbGlobeTemperatureK);
  if (wbgtC < 26.7) return 0;
  if (wbgtC < 27.8) return 1;
  if (wbgtC < 29.4) return 2;
  if (wbgtC < 32.2) return 3;
  return 4;
}

/**
 * Decode the optional enhanced-temperature fields, all in Kelvin. Free-tier
 * keys and partial responses omit some or all of these blocks, so each is
 * optional-chained; the result carries only the keys that were present.
 */
function extractEnhancedTemperatures(
  conditions: AccuWeatherCurrentConditions
): Partial<WeatherData> {
  const toKelvin = (celsius: number | undefined): number | undefined =>
    typeof celsius === 'number' ? celsiusToKelvin(celsius) : undefined;
  const realFeel = toKelvin(conditions.RealFeelTemperature?.Metric?.Value);
  const realFeelShade = toKelvin(conditions.RealFeelTemperatureShade?.Metric?.Value);
  const wetBulbTemperature = toKelvin(conditions.WetBulbTemperature?.Metric?.Value);
  const wetBulbGlobeTemperature = toKelvin(conditions.WetBulbGlobeTemperature?.Metric?.Value);
  const apparentTemperature = toKelvin(conditions.ApparentTemperature?.Metric?.Value);
  return {
    ...(realFeel !== undefined && { realFeel }),
    ...(realFeelShade !== undefined && { realFeelShade }),
    ...(wetBulbTemperature !== undefined && { wetBulbTemperature }),
    ...(wetBulbGlobeTemperature !== undefined && { wetBulbGlobeTemperature }),
    ...(apparentTemperature !== undefined && { apparentTemperature }),
  };
}

/**
 * Decode the optional non-temperature enhanced fields (gust, visibility,
 * ceiling, precipitation, 24h departure, weather icon). Each block is
 * optional-chained; the result carries only the keys that were present.
 */
function extractEnhancedConditions(
  conditions: AccuWeatherCurrentConditions,
  windSpeed: number
): Partial<WeatherData> {
  const rawWindGustKmh = asOptionalNumber(conditions.WindGust?.Speed?.Metric?.Value);
  const windGustSpeed = rawWindGustKmh !== undefined ? kmhToMS(rawWindGustKmh) : undefined;
  // Omitted unless the gust reading is at least the sustained speed: a factor
  // below 1 is not a gust factor, it is stale or inconsistent upstream data.
  const windGustFactor =
    windGustSpeed !== undefined && windSpeed > 0 && windGustSpeed >= windSpeed
      ? windGustSpeed / windSpeed
      : undefined;
  const rawVisibilityKm = asOptionalNumber(conditions.Visibility?.Metric?.Value);
  const visibility =
    rawVisibilityKm !== undefined ? rawVisibilityKm * UNITS.LENGTH.KM_TO_M : undefined;
  const cloudCeiling = asOptionalNumber(conditions.Ceiling?.Metric?.Value);
  const precipitationLastHour = asOptionalNumber(conditions.Precip1hr?.Metric?.Value);
  const temperatureDeparture24h = asOptionalNumber(
    conditions.Past24HourTemperatureDeparture?.Metric?.Value
  );
  // Missing CloudCover must stay absent: percentageToRatio(undefined) would
  // read as a real "clear sky" 0.
  const rawCloudCover = asOptionalNumber(conditions.CloudCover);
  const cloudCover = rawCloudCover !== undefined ? percentageToRatio(rawCloudCover) : undefined;
  const uvIndex = asOptionalNumber(conditions.UVIndexFloat);
  const weatherIcon = asOptionalNumber(conditions.WeatherIcon);
  return {
    ...(windGustSpeed !== undefined && { windGustSpeed }),
    ...(windGustFactor !== undefined && { windGustFactor }),
    ...(uvIndex !== undefined && { uvIndex }),
    ...(cloudCover !== undefined && { cloudCover }),
    ...(visibility !== undefined && { visibility }),
    ...(cloudCeiling !== undefined && { cloudCeiling }),
    ...(precipitationLastHour !== undefined && { precipitationLastHour }),
    ...(temperatureDeparture24h !== undefined && { temperatureDeparture24h }),
    ...(weatherIcon !== undefined && { weatherIcon }),
  };
}

/** AccuWeather PressureTendency.Code to a numeric trend: falling/steady/rising. */
const PRESSURE_TENDENCY_CODES: ReadonlyMap<string, number> = new Map([
  ['F', -1],
  ['S', 0],
  ['R', 1],
]);

/** Strip control characters and bound an optional API label; undefined when absent or empty. */
function optionalLabel(value: unknown): string | undefined {
  const capped = capString(value, ACCUWEATHER.MAX_LABEL_LENGTH);
  return capped.length > 0 ? capped : undefined;
}

/**
 * Decode optional condition-detail fields: barometric tendency (numeric
 * trend), precipitation type, and visibility obstruction. Each field is
 * omitted from the result when the API response does not carry it.
 */
function extractConditionDetails(conditions: AccuWeatherCurrentConditions): Partial<WeatherData> {
  const tendencyCode = conditions.PressureTendency?.Code;
  const pressureTendency =
    typeof tendencyCode === 'string'
      ? PRESSURE_TENDENCY_CODES.get(tendencyCode.trim().toUpperCase())
      : undefined;
  const precipitationType = optionalLabel(conditions.PrecipitationType);
  const visibilityObstruction = optionalLabel(conditions.ObstructionsToVisibility);
  return {
    ...(pressureTendency !== undefined && { pressureTendency }),
    ...(precipitationType !== undefined && { precipitationType }),
    ...(visibilityObstruction !== undefined && { visibilityObstruction }),
  };
}

export class AccuWeatherService {
  private readonly config: AccuWeatherConfig;
  private readonly logger: Logger;
  private locationCache = new Map<string, { location: AccuWeatherLocation; timestamp: number }>();
  private lastCachePrune = Date.now();
  /**
   * Cumulative count of HTTP fetch attempts made by makeApiRequest, including
   * retries. Surfaced via getRequestCount() / getCacheStats() so the status
   * banner can show operators how chatty the plugin is being with the upstream
   * API. Increments on the fetch path (every minute or two at most), not the
   * 5-second emission tick, so this is not a hot-path concern.
   */
  private requestCount = 0;
  /**
   * Circular buffer of per-hour request counts spanning the last 24 hours.
   * `requestWindow[i]` holds the count for the hour offset `i` from
   * `requestWindowBaseHour` (midnight-aligned to 1970 epoch hour). On each
   * request we rotate forward by the elapsed hours, zeroing skipped buckets,
   * which keeps memory at exactly 24 numbers regardless of uptime.
   */
  private requestWindow: number[] = new Array(REQUEST_WINDOW_HOURS).fill(0);
  /**
   * Epoch-hour index of the LAST bucket (`requestWindow[REQUEST_WINDOW_HOURS - 1]`),
   * i.e. the current-hour slot. On rotation we shift the array left by the
   * number of elapsed hours and update this index.
   */
  private requestWindowCurrentHour = Math.floor(Date.now() / HOUR_MS);
  /**
   * On-demand forecast cache, keyed by `${kind}:${locationKey}`. Holds the raw
   * forecast response and an absolute expiry. Separate from locationCache
   * because forecasts have their own per-kind TTLs and are pulled by external
   * Weather API consumers rather than the plugin's own fetch timer.
   */
  private forecastCache = new Map<string, { data: unknown; expiresAt: number }>();

  constructor(apiKey: string, logger: Logger = () => {}, config?: Partial<AccuWeatherConfig>) {
    // Validate before any field assignment so a throw cannot leave the instance
    // in a partially-constructed state. Callers always discard the reference on
    // throw today, but the invariant is cheaper to keep than to defend.
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new Error(
        `${ERROR_CODES.CONFIGURATION.INVALID_API_KEY}: AccuWeather API key is required`
      );
    }

    this.config = {
      apiKey,
      locationCacheTimeout: DEFAULT_CONFIG.LOCATION_CACHE_TIMEOUT,
      requestTimeout: DEFAULT_CONFIG.REQUEST_TIMEOUT,
      retryAttempts: DEFAULT_CONFIG.RETRY_ATTEMPTS,
      retryDelay: DEFAULT_CONFIG.RETRY_DELAY,
      ...config,
    };

    this.logger = logger;

    this.logger('info', 'AccuWeatherService initialized', {
      hasApiKey: !!apiKey,
      cacheTimeout: this.config.locationCacheTimeout,
      requestTimeout: this.config.requestTimeout,
    });
  }

  /**
   * Probe the configured API key by issuing exactly one location-search call.
   * Returns when the call succeeds; throws the underlying error otherwise.
   * Used by the admin-UI panel's `/api/test-key` endpoint so the test costs
   * half what a full `fetchCurrentWeather` would (no currentconditions hop).
   */
  public async verifyApiKey(location: GeoLocation): Promise<AccuWeatherLocation> {
    this.validateLocation(location);
    return this.searchLocation(location);
  }

  /**
   * Fetch current weather data for specified coordinates
   * @param location Geographic coordinates
   * @returns Promise resolving to processed weather data
   */
  public async fetchCurrentWeather(location: GeoLocation): Promise<WeatherData> {
    this.validateLocation(location);

    try {
      const locationKey = await this.getLocationKey(location);
      const currentConditions = await this.getCurrentConditions(locationKey);

      const firstCondition = currentConditions[0];
      if (!firstCondition) {
        throw new Error(
          `${ERROR_CODES.DATA.INVALID_WEATHER_DATA}: No weather conditions data available`
        );
      }

      const weatherData = this.transformWeatherData(firstCondition);

      this.logger('info', 'Enhanced weather data retrieved successfully', {
        location: `${location.latitude},${location.longitude}`,
        temperature: weatherData.temperature,
        windSpeed: weatherData.windSpeed,
        windGustSpeed: weatherData.windGustSpeed,
        uvIndex: weatherData.uvIndex,
        visibility: weatherData.visibility,
      });

      return weatherData;
    } catch (error) {
      this.logger('error', 'Failed to fetch weather data', {
        location: `${location.latitude},${location.longitude}`,
        error: toErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Fetch the 12-hour hourly forecast for a position. Reuses the cached
   * location key, the rolling request window, and the on-demand forecast cache.
   * On a warm forecast cache this costs zero upstream calls.
   */
  public async getHourlyForecast(location: GeoLocation): Promise<AccuWeatherHourlyForecast[]> {
    this.validateLocation(location);
    // Snapshot the quota verdict once, before this call's own location lookup
    // spends a request. A cold call below the cap is then not gated by the
    // request it is about to make, and a call already over the cap is gated
    // before it can trigger a fresh (request-spending) location search.
    const quotaExhausted = this.isQuotaExhausted();
    const locationKey = await this.resolveLocationKeyForForecast(location, quotaExhausted);
    return this.cachedForecastFetch(
      `hourly:${locationKey}`,
      FORECAST_CACHE.HOURLY_TTL_MS,
      quotaExhausted,
      () => this.fetchHourlyForecast(locationKey)
    );
  }

  /**
   * Fetch the 5-day daily forecast for a position. Same caching and quota
   * behaviour as getHourlyForecast.
   */
  public async getDailyForecast(location: GeoLocation): Promise<AccuWeatherDailyForecastResponse> {
    this.validateLocation(location);
    const quotaExhausted = this.isQuotaExhausted();
    const locationKey = await this.resolveLocationKeyForForecast(location, quotaExhausted);
    return this.cachedForecastFetch(
      `daily:${locationKey}`,
      FORECAST_CACHE.DAILY_TTL_MS,
      quotaExhausted,
      () => this.fetchDailyForecast(locationKey)
    );
  }

  /**
   * Resolve the location key for a forecast call, respecting the daily quota.
   * Below the cap it does the normal cached-or-fetched lookup. At the cap it
   * refuses to spend a request on a fresh location search: it falls back to a
   * cache-only lookup so a previously seen location can still serve a stale
   * forecast, and throws a tagged rate-limit error when no cached key exists
   * (a fresh location cannot have a cached forecast either).
   * @private
   */
  private async resolveLocationKeyForForecast(
    location: GeoLocation,
    quotaExhausted: boolean
  ): Promise<string> {
    if (!quotaExhausted) {
      return this.getLocationKey(location);
    }
    const cachedKey = this.getCachedLocationKey(location);
    if (cachedKey === undefined) {
      throw this.quotaReachedError();
    }
    this.logger('debug', 'Quota reached, resolving forecast from cached location only');
    return cachedKey;
  }

  /**
   * The tagged rate-limit error thrown when the daily quota is reached and no
   * cached forecast can serve the request. Shared by the location-key resolver
   * and the cache wrapper so the message stays identical.
   * @private
   */
  private quotaReachedError(): Error {
    return new Error(
      `${ERROR_CODES.NETWORK.API_RATE_LIMIT}: AccuWeather daily quota reached, no cached forecast available`
    );
  }

  /** Stable location-cache key for a coordinate, rounded to 4 decimal places. @private */
  private locationCacheKey(location: GeoLocation): string {
    return `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
  }

  /**
   * Read a location key from the location cache without issuing a network
   * lookup. Returns undefined when no entry exists for the coordinates;
   * expiry is ignored because a stale key is still the right key for the same
   * coordinates and the quota path only needs it to find a cached forecast.
   * @private
   */
  private getCachedLocationKey(location: GeoLocation): string | undefined {
    return this.locationCache.get(this.locationCacheKey(location))?.location.Key;
  }

  /**
   * Cache wrapper for forecast fetches. Returns a fresh cache hit with zero
   * upstream calls. On a miss it gates on the daily quota: if the quota was
   * reached at call entry and a stale entry exists it serves the stale entry
   * (so a dashboard still shows data), otherwise it throws a tagged rate-limit
   * error. Below the quota it fetches, stores with an absolute expiry, and
   * prunes. The quota verdict is the one snapshotted at method entry so a cold
   * call below the cap is not gated by its own location-lookup request.
   * @private
   */
  private async cachedForecastFetch<T>(
    cacheKey: string,
    ttlMs: number,
    quotaExhausted: boolean,
    fetcher: () => Promise<T>
  ): Promise<T> {
    const now = Date.now();
    const cached = this.forecastCache.get(cacheKey);
    if (cached && now < cached.expiresAt) {
      this.logger('debug', 'Using cached forecast', { cacheKey });
      return cached.data as T;
    }

    if (quotaExhausted) {
      if (cached) {
        this.logger('warn', 'Quota reached, serving stale forecast', { cacheKey });
        return cached.data as T;
      }
      throw this.quotaReachedError();
    }

    const data = await fetcher();
    this.forecastCache.set(cacheKey, { data, expiresAt: now + ttlMs });
    this.pruneForecastCache(now);
    return data;
  }

  /** True when the configured rolling-24h quota has been reached. @private */
  private isQuotaExhausted(): boolean {
    return isApiQuotaReached(this.getRequestCountLast24h(), this.config.dailyApiQuota);
  }

  /**
   * Drop expired forecast entries, and if still over MAX_CACHE_SIZE drop the
   * soonest-to-expire ones. Forecast entries number at most a few per location,
   * so this is cheap and runs on the fetch path, not the emission tick.
   * @private
   */
  private pruneForecastCache(now: number): void {
    for (const [key, entry] of this.forecastCache.entries()) {
      if (now >= entry.expiresAt) {
        this.forecastCache.delete(key);
      }
    }
    if (this.forecastCache.size > MAX_CACHE_SIZE) {
      const entries = Array.from(this.forecastCache.entries()).sort(
        (a, b) => a[1].expiresAt - b[1].expiresAt
      );
      const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
      for (const [key] of toRemove) {
        this.forecastCache.delete(key);
      }
    }
  }

  /**
   * Build an endpoint URL with the `apikey`, `language`, and `details` query
   * params every AccuWeather endpoint this plugin calls shares. Callers append
   * endpoint-specific params (`metric` on forecasts, `q` on location search).
   * @private
   */
  private buildApiUrl(path: string): URL {
    const url = new URL(`${ACCUWEATHER.BASE_URL}${path}`);
    url.searchParams.set('apikey', this.config.apiKey);
    url.searchParams.set('language', ACCUWEATHER.DEFAULT_LANGUAGE);
    url.searchParams.set('details', 'true');
    return url;
  }

  /**
   * Build an endpoint URL keyed by a location key, guarding the key against the
   * URL-path pattern (defense-in-depth, the cache could theoretically drift).
   * Shared by the current-conditions and forecast hops.
   * @private
   */
  private buildLocationKeyUrl(endpoint: string, locationKey: string): URL {
    if (!LOCATION_KEY_PATTERN.test(locationKey)) {
      throw new Error(
        `${ERROR_CODES.NETWORK.API_INVALID_RESPONSE}: refusing to use malformed location key in URL path`
      );
    }
    return this.buildApiUrl(`${endpoint}/${locationKey}`);
  }

  /**
   * Build a metric forecast URL for a location key. `metric` is forecast-
   * specific, so it is added on top of the shared location-key builder rather
   * than baked into it.
   * @private
   */
  private buildForecastUrl(endpoint: string, locationKey: string): URL {
    const url = this.buildLocationKeyUrl(endpoint, locationKey);
    url.searchParams.set('metric', 'true');
    return url;
  }

  /** Fetch and shape the raw 12-hour hourly forecast array. @private */
  private async fetchHourlyForecast(locationKey: string): Promise<AccuWeatherHourlyForecast[]> {
    const url = this.buildForecastUrl(ACCUWEATHER.ENDPOINTS.FORECAST_HOURLY_12HOUR, locationKey);
    const data = await this.makeApiRequest<AccuWeatherHourlyForecast[]>(url);
    if (!Array.isArray(data)) {
      throw new Error(
        `${ERROR_CODES.DATA.INVALID_WEATHER_DATA}: No hourly forecast data available`
      );
    }
    return data;
  }

  /** Fetch and shape the raw 5-day daily forecast response. @private */
  private async fetchDailyForecast(locationKey: string): Promise<AccuWeatherDailyForecastResponse> {
    const url = this.buildForecastUrl(ACCUWEATHER.ENDPOINTS.FORECAST_DAILY_5DAY, locationKey);
    const data = await this.makeApiRequest<AccuWeatherDailyForecastResponse>(url);
    if (!data || typeof data !== 'object' || !Array.isArray(data.DailyForecasts)) {
      throw new Error(`${ERROR_CODES.DATA.INVALID_WEATHER_DATA}: No daily forecast data available`);
    }
    return data;
  }

  /**
   * Transform AccuWeather API response to enhanced internal weather data format
   * @private
   */
  private transformWeatherData(conditions: AccuWeatherCurrentConditions): WeatherData {
    const temperature = celsiusToKelvin(conditions.Temperature.Metric.Value);
    const pressure = millibarsToPA(conditions.Pressure.Metric.Value);
    const humidity = percentageToRatio(conditions.RelativeHumidity);
    const windSpeed = kmhToMS(conditions.Wind.Speed.Metric.Value);
    // Wind.Direction.Degrees is azimuth from true north per the WMO surface-wind
    // observation convention (Guide to Meteorological Instruments WMO-No. 8).
    // AccuWeather's docs say "from north" without a qualifier because that is
    // the universal meteorological default; using magnetic would require every
    // consumer to know the local magnetic declination. Mapping to the canonical
    // environment.wind.directionTrue path is therefore correct.
    // Normalize into [0, 2π): an exact 360° reading would otherwise land on 2π,
    // which the NMEA2000 half-open range check rejects.
    const windDirection = normalizeAngle0To2Pi(degreesToRadians(conditions.Wind.Direction.Degrees));
    const dewPoint = celsiusToKelvin(conditions.DewPoint.Metric.Value);
    // WindChillTemperature is optional on partial / lower-tier responses: fall
    // back to the Environment Canada formula so a missing block degrades the
    // value gracefully instead of throwing and aborting the whole fetch.
    const rawWindChillC = conditions.WindChillTemperature?.Metric?.Value;
    const windChill =
      typeof rawWindChillC === 'number'
        ? celsiusToKelvin(rawWindChillC)
        : sharedWindCalculator.calculateWindChill(temperature, windSpeed);
    // Heat index is computed (NWS Rothfusz), not AccuWeather RealFeel: RealFeel
    // can fall below air temperature, so it cannot occupy the canonical
    // heatIndexTemperature leaf. RealFeel ships on environment.weather.realFeel.
    const heatIndex = sharedWindCalculator.calculateHeatIndex(temperature, humidity);

    const enhancedTemps = extractEnhancedTemperatures(conditions);
    const enhancedConditions = extractEnhancedConditions(conditions, windSpeed);
    const conditionDetails = extractConditionDetails(conditions);
    const heatStressIndex =
      enhancedTemps.wetBulbGlobeTemperature !== undefined
        ? calculateHeatStressIndex(enhancedTemps.wetBulbGlobeTemperature)
        : undefined;

    // Beaufort is a sustained-wind scale (WMO): a gust must not inflate it.
    const beaufortScale = calculateBeaufortScale(windSpeed);
    const absoluteHumidity = calculateAbsoluteHumidity(temperature, humidity);
    const airDensityEnhanced = calculateAirDensity(temperature, pressure, humidity);

    const weatherData: WeatherData = {
      temperature,
      pressure,
      humidity,
      windSpeed,
      windDirection,
      dewPoint,
      windChill,
      heatIndex,
      beaufortScale,
      absoluteHumidity,
      airDensityEnhanced,
      // `description` carries the AccuWeather phrase; `weatherIcon` (decoded
      // into enhancedConditions) carries the icon code for severe-condition
      // classification.
      description: capString(conditions.WeatherText, ACCUWEATHER.MAX_DESCRIPTION_LENGTH),
      timestamp: capString(conditions.LocalObservationDateTime, ACCUWEATHER.MAX_LABEL_LENGTH),
      // Optional fields decoded above: spread last so only present keys land.
      ...enhancedTemps,
      ...enhancedConditions,
      ...conditionDetails,
      ...(heatStressIndex !== undefined && { heatStressIndex }),
    };

    // Validate transformed data
    this.validateWeatherData(weatherData);

    return weatherData;
  }

  /**
   * Prune expired and excess entries from location cache
   * @private
   */
  private pruneLocationCache(): void {
    const now = Date.now();

    if (now - this.lastCachePrune < CACHE_PRUNE_INTERVAL_MS) {
      return;
    }

    this.lastCachePrune = now;
    let pruned = 0;

    // Remove expired entries. Same TTL as the read-path freshness check in
    // getLocationKey so an entry is never pruned while still served as fresh,
    // nor served stale while still in the map.
    const maxAgeMs = this.config.locationCacheTimeout * 1000;
    for (const [key, entry] of this.locationCache.entries()) {
      if (now - entry.timestamp > maxAgeMs) {
        this.locationCache.delete(key);
        pruned++;
      }
    }

    // If still over max size, remove oldest entries
    if (this.locationCache.size > MAX_CACHE_SIZE) {
      const entries = Array.from(this.locationCache.entries()).sort(
        (a, b) => a[1].timestamp - b[1].timestamp
      );

      const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
      for (const [key] of toRemove) {
        this.locationCache.delete(key);
        pruned++;
      }
    }

    if (pruned > 0) {
      this.logger('debug', 'Location cache pruned', {
        prunedEntries: pruned,
        remainingEntries: this.locationCache.size,
      });
    }
  }

  /**
   * Get location key for coordinates with caching
   * @private
   */
  private async getLocationKey(location: GeoLocation): Promise<string> {
    // Prune cache periodically to prevent memory leak
    this.pruneLocationCache();

    const cacheKey = this.locationCacheKey(location);
    const now = Date.now();

    const cached = this.locationCache.get(cacheKey);
    if (cached && now - cached.timestamp < this.config.locationCacheTimeout * 1000) {
      this.logger('debug', 'Using cached location key', { cacheKey });
      return cached.location.Key;
    }

    const locationData = await this.searchLocation(location);

    this.locationCache.set(cacheKey, {
      location: locationData,
      timestamp: now,
    });

    this.logger('debug', 'Location key retrieved and cached', {
      cacheKey,
      locationKey: locationData.Key,
      locationName: locationData.LocalizedName,
      cacheSize: this.locationCache.size,
    });

    return locationData.Key;
  }

  /**
   * Search for location by coordinates
   * @private
   */
  private async searchLocation(location: GeoLocation): Promise<AccuWeatherLocation> {
    const url = this.buildApiUrl(ACCUWEATHER.ENDPOINTS.LOCATION_SEARCH);
    url.searchParams.set('q', `${location.latitude},${location.longitude}`);

    const data = await this.makeApiRequest<AccuWeatherLocation>(url);

    if (!data || typeof data !== 'object') {
      throw new Error(
        `${ERROR_CODES.DATA.INVALID_WEATHER_DATA}: No location found for coordinates`
      );
    }

    const locationKey = (data as { Key?: unknown }).Key;
    if (typeof locationKey !== 'string' || !LOCATION_KEY_PATTERN.test(locationKey)) {
      throw new Error(
        `${ERROR_CODES.NETWORK.API_INVALID_RESPONSE}: AccuWeather location key has unexpected format`
      );
    }

    return data;
  }

  /**
   * Get current weather conditions for location key
   * @private
   */
  private async getCurrentConditions(locationKey: string): Promise<AccuWeatherCurrentConditions[]> {
    // buildLocationKeyUrl guards the key against the URL-path pattern (defense-
    // in-depth: searchLocation already validates, but the cache could
    // theoretically be poisoned if its invariants ever drift).
    const url = this.buildLocationKeyUrl(ACCUWEATHER.ENDPOINTS.CURRENT_CONDITIONS, locationKey);

    const data = await this.makeApiRequest<AccuWeatherCurrentConditions[]>(url);

    if (!data || !Array.isArray(data) || data.length === 0) {
      throw new Error(
        `${ERROR_CODES.DATA.INVALID_WEATHER_DATA}: No current conditions data available`
      );
    }

    const validation = validateAccuWeatherResponse(data);
    if (!validation.isValid) {
      throw new Error(
        `${ERROR_CODES.NETWORK.API_INVALID_RESPONSE}: AccuWeather response failed validation - ${validation.errors.join('; ')}`
      );
    }

    return data;
  }

  /**
   * Make API request with retry logic and error handling
   * @private
   */
  private async makeApiRequest<T>(url: URL, attempt = 1): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeout);

    try {
      this.logger('debug', 'Making API request', {
        url: this.sanitizeUrlForLogging(url),
        attempt,
        maxAttempts: this.config.retryAttempts,
      });

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': `${PLUGIN.NAME}/${PLUGIN.VERSION}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Counted after the response lands so timeouts and network errors do
      // not consume quota (AccuWeather's own quota only charges for requests
      // that reach their service). Error responses (401, 403, 429, 503)
      // still count because they came back from AccuWeather. Off the
      // emission hot path: at most once per fetch, default cadence 30 minutes.
      this.requestCount++;
      this.recordRequestInWindow();

      if (!response.ok) {
        await this.handleApiError(response, attempt);
      }

      return await this.readBoundedJson<T>(response);
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof Error && error.name === 'AbortError') {
        if (attempt < this.config.retryAttempts) {
          this.logger('warn', 'Request timeout, retrying', {
            attempt,
            url: this.sanitizeUrlForLogging(url),
          });
          await this.delay(this.config.retryDelay * attempt);
          return this.makeApiRequest<T>(url, attempt + 1);
        }
        throw new Error(
          `${ERROR_CODES.NETWORK.API_TIMEOUT}: Request timeout after ${this.config.retryAttempts} attempts`
        );
      }

      if (attempt < this.config.retryAttempts && this.isRetryableError(error)) {
        const retryAfterMs = (error as { retryAfterMs?: number | null }).retryAfterMs;
        const delayMs = retryAfterMs ?? this.config.retryDelay * attempt;
        this.logger('warn', 'Retryable error, attempting retry', {
          attempt,
          delayMs,
          honoredRetryAfter: retryAfterMs != null,
          error: toErrorMessage(error),
        });
        await this.delay(delayMs);
        return this.makeApiRequest<T>(url, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Read a Response body as JSON with a maximum byte cap.
   * Prevents a malicious or runaway upstream from forcing us to buffer huge
   * payloads in memory before the JSON parser ever sees them.
   * @private
   */
  private async readBoundedJson<T>(response: Response): Promise<T> {
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
      const declared = Number.parseInt(contentLength, 10);
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        throw new Error(
          `${ERROR_CODES.NETWORK.RESPONSE_TOO_LARGE}: AccuWeather response is ${declared} bytes (max ${MAX_RESPONSE_BYTES})`
        );
      }
    }

    // Always read as text with a length check: Content-Length may be missing
    // (chunked encoding) or lie about the body size.
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new Error(
        `${ERROR_CODES.NETWORK.RESPONSE_TOO_LARGE}: AccuWeather response is ${text.length} bytes (max ${MAX_RESPONSE_BYTES})`
      );
    }

    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new Error(
        `${ERROR_CODES.NETWORK.API_INVALID_RESPONSE}: failed to parse AccuWeather response as JSON - ${toErrorMessage(
          error
        )}`
      );
    }
  }

  /**
   * Parse Retry-After header value to milliseconds
   * @private
   */
  private parseRetryAfter(response: Response): number | null {
    const retryAfter = response.headers.get('Retry-After');
    if (!retryAfter) return null;

    // Try parsing as seconds (integer)
    const seconds = Number.parseInt(retryAfter, 10);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }

    // Try parsing as HTTP date
    const retryDate = new Date(retryAfter);
    if (!Number.isNaN(retryDate.getTime())) {
      const delayMs = retryDate.getTime() - Date.now();
      if (delayMs > 0) {
        return Math.min(delayMs, MAX_RETRY_AFTER_MS);
      }
    }

    return null;
  }

  /**
   * Handle API error responses by classifying the status and throwing a
   * tagged error. Backoff is owned by the caller (`makeApiRequest`'s retry
   * loop) so this method must not sleep. Sleeping here previously caused
   * 2× backoff per retry attempt.
   * @private
   */
  private async handleApiError(response: Response, attempt: number): Promise<never> {
    const statusCode = response.status;
    const retryAfterMs = this.parseRetryAfter(response);

    let message = response.statusText;
    try {
      // Bound the error body too: a malicious 429/503 with an oversized body
      // would otherwise bypass the 1 MiB cap that protects success paths.
      const errorData = await this.readBoundedJson<{ message?: string }>(response);
      message = errorData.message || response.statusText;
    } catch (parseError) {
      // Surface malformed error bodies by default so operators see upstream
      // misbehaviour without needing to enable debug logging.
      this.logger('warn', 'API error response was not JSON, falling back to statusText', {
        status: response.status,
        parseError: toErrorMessage(parseError),
      });
    }

    switch (statusCode) {
      case 401:
        throw new Error(`${ERROR_CODES.NETWORK.API_UNAUTHORIZED}: Invalid API key - ${message}`);
      case 403:
        // 403 Forbidden is distinct from 429 Rate Limit: wrong plan, expired key, IP blocked
        throw new Error(`${ERROR_CODES.NETWORK.API_FORBIDDEN}: API access forbidden - ${message}`);
      case 404:
        throw new Error(
          `${ERROR_CODES.DATA.INVALID_WEATHER_DATA}: Location not found - ${message}`
        );
      case 429:
        if (attempt < this.config.retryAttempts) {
          this.logger('warn', 'Rate limited by API, will retry', {
            attempt,
            retryAfterMs,
            retryAfterHeader: !!retryAfterMs,
          });
          throw Object.assign(
            new Error(`${ERROR_CODES.NETWORK.API_RATE_LIMIT}: Rate limited, retrying - ${message}`),
            { retryAfterMs }
          );
        }
        throw new Error(`${ERROR_CODES.NETWORK.API_RATE_LIMIT}: Rate limit exceeded - ${message}`);
      case 503:
        if (attempt < this.config.retryAttempts) {
          this.logger('warn', 'Service unavailable, will retry', {
            attempt,
            retryAfterMs,
            retryAfterHeader: !!retryAfterMs,
          });
          throw Object.assign(
            new Error(
              `${ERROR_CODES.NETWORK.NETWORK_ERROR}: Service temporarily unavailable, retrying - ${message}`
            ),
            { retryAfterMs }
          );
        }
        throw new Error(`${ERROR_CODES.NETWORK.NETWORK_ERROR}: Service unavailable - ${message}`);
      default:
        throw new Error(
          `${ERROR_CODES.NETWORK.NETWORK_ERROR}: API request failed (${statusCode}) - ${message}`
        );
    }
  }

  /**
   * Validate location coordinates
   * @private
   */
  private validateLocation(location: GeoLocation): void {
    if (!location || typeof location !== 'object') {
      throw new Error(`${ERROR_CODES.CONFIGURATION.INVALID_COORDINATES}: Invalid location object`);
    }
    if (typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
      throw new Error(
        `${ERROR_CODES.CONFIGURATION.INVALID_COORDINATES}: Coordinates must be numbers`
      );
    }
    if (!isValidCoordinates(location.latitude, location.longitude)) {
      throw new Error(
        `${ERROR_CODES.CONFIGURATION.INVALID_COORDINATES}: Coordinates out of range (lat ${location.latitude}, lon ${location.longitude})`
      );
    }
  }

  /**
   * Validate transformed weather data
   * @private
   */
  private validateWeatherData(data: WeatherData): void {
    if (!isValidTemperature(data.temperature)) {
      this.logger('warn', 'Temperature outside expected range', { temperature: data.temperature });
    }
    if (!isValidPressure(data.pressure)) {
      this.logger('warn', 'Pressure outside expected range', { pressure: data.pressure });
    }
    if (!isValidHumidity(data.humidity)) {
      this.logger('warn', 'Humidity outside expected range', { humidity: data.humidity });
    }
    if (!isValidWindSpeed(data.windSpeed)) {
      this.logger('warn', 'Wind speed outside expected range', { windSpeed: data.windSpeed });
    }
  }

  /**
   * Return URL string with the apikey query parameter stripped so it's safe to log.
   * Debug-level logs are not passed through sanitizeLogMetadata, so we must strip
   * secrets here before they reach the logger.
   * @private
   */
  private sanitizeUrlForLogging(url: URL): string {
    const safe = new URL(url);
    if (safe.searchParams.has('apikey')) {
      safe.searchParams.set('apikey', '***');
    }
    return safe.toString();
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Module-level Set avoids recomputing toLowerCase() on every retry decision.
      for (const needle of RETRYABLE_ERROR_SUBSTRINGS) {
        if (message.includes(needle)) return true;
      }
    }
    return false;
  }

  /**
   * Promise-based delay utility
   * @private
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Clear location cache (useful for testing or configuration changes)
   */
  public clearLocationCache(): void {
    this.locationCache.clear();
    this.forecastCache.clear();
    this.logger('debug', 'Location and forecast caches cleared');
  }

  /** Location-cache size, for monitoring. */
  public getCacheStats(): { size: number } {
    return { size: this.locationCache.size };
  }

  /** Cumulative HTTP fetch attempts (initial + retries) since construction. */
  public getRequestCount(): number {
    return this.requestCount;
  }

  /**
   * HTTP fetch attempts in the rolling last 24 hours. Backed by 24 hourly
   * buckets that rotate as time advances, so memory stays constant regardless
   * of uptime. Reads call `rotateRequestWindow` so a quota check made between
   * fetches still reflects buckets that have aged out.
   */
  public getRequestCountLast24h(): number {
    this.rotateRequestWindow();
    let total = 0;
    for (const count of this.requestWindow) {
      total += count;
    }
    return total;
  }

  /**
   * Advance the rolling window so `requestWindow[REQUEST_WINDOW_HOURS - 1]`
   * tracks the current epoch hour, zeroing buckets for skipped hours. Called
   * from both the read path (so quota checks see fresh state) and the write
   * path (so the increment lands in the right bucket).
   * @private
   */
  private rotateRequestWindow(): void {
    const currentHour = Math.floor(Date.now() / HOUR_MS);
    const elapsed = currentHour - this.requestWindowCurrentHour;
    if (elapsed === 0) return;
    if (elapsed < 0) {
      // Backward wall-clock jump (NTP correction, manual clock change). The
      // existing buckets are labelled against the old, now-future hour index
      // so their counts no longer correspond to the previous 24 hours of
      // real time. Zero the window: undercounting briefly is far safer than
      // capping fetches against ghost requests for up to 24 hours.
      this.requestWindow.fill(0);
      this.requestWindowCurrentHour = currentHour;
      return;
    }
    if (elapsed >= REQUEST_WINDOW_HOURS) {
      // More than a full window has passed: every bucket is stale.
      this.requestWindow.fill(0);
    } else {
      // Shift left by `elapsed`, dropping the oldest hours and pushing zeros
      // for the freshly exposed (current-hour) slots. O(min(elapsed, 24)) per
      // rotation; off the per-emission hot path (only fetches and quota
      // checks rotate, both at minutes-or-longer cadence).
      this.requestWindow.splice(0, elapsed);
      for (let i = 0; i < elapsed; i++) {
        this.requestWindow.push(0);
      }
    }
    this.requestWindowCurrentHour = currentHour;
  }

  /**
   * Increment the trailing (current-hour) bucket. Always rotates first so a
   * burst of requests after a long idle period lands in the correct bucket
   * rather than the last hour the service was active.
   * @private
   */
  private recordRequestInWindow(): void {
    this.rotateRequestWindow();
    // The current hour is the last bucket: index REQUEST_WINDOW_HOURS - 1.
    // The bucket is guaranteed to exist (constructor pre-fills the array and
    // rotateRequestWindow preserves length); the `?? 0` keeps strict
    // noUncheckedIndexedAccess happy without a non-null assertion.
    const lastIdx = REQUEST_WINDOW_HOURS - 1;
    this.requestWindow[lastIdx] = (this.requestWindow[lastIdx] ?? 0) + 1;
  }
}
