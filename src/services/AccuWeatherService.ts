/**
 * AccuWeather API Service
 * Modern TypeScript implementation with comprehensive error handling and enhanced field extraction
 */

import type { WeatherData as SKWeatherData } from '@signalk/server-api';
import {
  ACCUWEATHER,
  DEFAULT_CONFIG,
  ERROR_CODES,
  FORECAST_CACHE,
  PLUGIN,
} from '../constants/index.js';
import { mapAccuWeatherCurrentToWeatherData } from '../mappers/AccuWeatherMapper.js';
import {
  mapCurrentToObservation,
  mapDailyToForecasts,
  mapHourlyToForecasts,
} from '../mappers/WeatherProviderMapper.js';
import type { CurrentWeatherProvider } from '../providers/WeatherProvider.js';
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
  isApiQuotaReached,
  isValidHumidity,
  isValidPressure,
  isValidTemperature,
  isValidWindSpeed,
  toCoordKey,
  toErrorMessage,
} from '../utils/conversions.js';
import { DEFAULT_MAX_RESPONSE_BYTES } from '../utils/http.js';
import { assertValidCoordinates, validateAccuWeatherResponse } from '../utils/validation.js';
import { CoalescingTtlCache } from './cache/CoalescingTtlCache.js';
import { ForecastCache } from './cache/ForecastCache.js';
import { RetryingHttpClient } from './http/RetryingHttpClient.js';
import { RollingRequestWindow } from './quota/RollingRequestWindow.js';

/** Validation pattern for AccuWeather location keys (URL path segment). */
const LOCATION_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** How often the location cache prune sweep runs (5 minutes). */
const CACHE_PRUNE_INTERVAL_MS = 5 * 60_000;

/**
 * AccuWeather API client for weather data operations.
 * Provides a type-safe interface to the AccuWeather REST API with location and
 * forecast caching, retry and backoff, and rolling-24h quota tracking.
 */
export class AccuWeatherService implements CurrentWeatherProvider {
  /** Provider name for the v2 registration and logs. */
  public readonly name = 'AccuWeather';
  /** `$source` stamped on AccuWeather-sourced deltas. */
  public readonly sourceRef = 'accuweather';

  private readonly config: AccuWeatherConfig;
  private readonly logger: Logger;
  /**
   * Coalescing TTL cache for AccuWeather location keys. Concurrent cold lookups
   * for the same coordinates share one upstream call instead of each spending a
   * request. The fetcher and key derivation stay in the service; the cache owns
   * the entry map, in-flight map, and prune throttle.
   */
  private readonly locationCache: CoalescingTtlCache<AccuWeatherLocation>;
  /**
   * Rolling 24-hour request window. Tracks the cumulative count and 24 hourly
   * buckets for quota checks. See `RollingRequestWindow` for the rotation and
   * backward-jump rationale.
   */
  private readonly requestWindow = new RollingRequestWindow();
  /**
   * On-demand forecast cache, keyed by `${kind}:${locationKey}`. Separate from
   * locationCache because forecasts have their own per-kind TTLs and are pulled
   * by external Weather API consumers rather than the plugin's own fetch timer.
   */
  private readonly forecastCache: ForecastCache;
  /**
   * Retrying JSON-over-HTTP client. Owns the abort-timeout, retry, backoff, and
   * Retry-After path; the rolling request window is counted through its
   * `onRequestCounted` hook so an error response from AccuWeather still charges
   * quota the same way the inline fetch path did.
   */
  private readonly http: RetryingHttpClient;

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
    this.locationCache = new CoalescingTtlCache<AccuWeatherLocation>(
      this.config.locationCacheTimeout * 1000,
      CACHE_PRUNE_INTERVAL_MS,
      this.logger
    );
    this.forecastCache = new ForecastCache(() => this.quotaReachedError(), this.logger);
    this.http = new RetryingHttpClient({
      requestTimeoutMs: this.config.requestTimeout,
      retryAttempts: this.config.retryAttempts,
      retryDelayMs: this.config.retryDelay,
      userAgent: `${PLUGIN.NAME}/${PLUGIN.VERSION}`,
      onRequestCounted: () => this.requestWindow.record(),
      logger: this.logger,
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
      responseLabel: 'AccuWeather response',
    });

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
    assertValidCoordinates(location, 'AccuWeather request');
    return this.searchLocation(location);
  }

  /**
   * Fetch current weather data for specified coordinates
   * @param location Geographic coordinates
   * @returns Promise resolving to processed weather data
   */
  public async fetchCurrentWeather(location: GeoLocation): Promise<WeatherData> {
    assertValidCoordinates(location, 'AccuWeather request');

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
  public async fetchHourlyForecastRaw(location: GeoLocation): Promise<AccuWeatherHourlyForecast[]> {
    assertValidCoordinates(location, 'AccuWeather request');
    // Snapshot the quota verdict once, before this call's own location lookup
    // spends a request. A cold call below the cap is then not gated by the
    // request it is about to make, and a call already over the cap is gated
    // before it can trigger a fresh (request-spending) location search.
    const quotaExhausted = this.isQuotaExhausted();
    const locationKey = await this.resolveLocationKeyForForecast(location, quotaExhausted);
    return this.forecastCache.fetchCached(
      `hourly:${locationKey}`,
      FORECAST_CACHE.HOURLY_TTL_MS,
      quotaExhausted,
      () => this.fetchHourlyForecast(locationKey)
    );
  }

  /**
   * Fetch the 5-day daily forecast for a position. Same caching and quota
   * behaviour as fetchHourlyForecastRaw.
   */
  public async fetchDailyForecastRaw(
    location: GeoLocation
  ): Promise<AccuWeatherDailyForecastResponse> {
    assertValidCoordinates(location, 'AccuWeather request');
    const quotaExhausted = this.isQuotaExhausted();
    const locationKey = await this.resolveLocationKeyForForecast(location, quotaExhausted);
    return this.forecastCache.fetchCached(
      `daily:${locationKey}`,
      FORECAST_CACHE.DAILY_TTL_MS,
      quotaExhausted,
      () => this.fetchDailyForecast(locationKey)
    );
  }

  /**
   * Fetch current conditions for an ARBITRARY position, for the v2 Weather API
   * observations endpoint (which passes a caller-supplied lat/lon, not the
   * vessel position). Quota-aware and cached on a short TTL like the forecast
   * methods, reusing the location-key cache and the rolling request window, so a
   * polling observations consumer does not exhaust the key. Returns the first
   * (current) conditions record.
   */
  public async fetchCurrentConditionsRaw(
    location: GeoLocation
  ): Promise<AccuWeatherCurrentConditions> {
    assertValidCoordinates(location, 'AccuWeather request');
    const quotaExhausted = this.isQuotaExhausted();
    const locationKey = await this.resolveLocationKeyForForecast(location, quotaExhausted);
    const conditions = await this.forecastCache.fetchCached(
      `observation:${locationKey}`,
      FORECAST_CACHE.OBSERVATION_TTL_MS,
      quotaExhausted,
      () => this.getCurrentConditions(locationKey)
    );
    const first = conditions[0];
    if (!first) {
      throw new Error(
        `${ERROR_CODES.DATA.INVALID_WEATHER_DATA}: No current conditions data available`
      );
    }
    return first;
  }

  /** AccuWeather free endpoints cap at a 12-hour hourly and 5-day daily window. */
  public readonly forecastCapabilities = { hourlyHours: 12, dailyDays: 5 } as const;

  /** Current observation at an arbitrary position, in the SK v2 envelope. */
  public async getObservation(location: GeoLocation): Promise<SKWeatherData> {
    return mapCurrentToObservation(await this.fetchCurrentConditionsRaw(location));
  }

  /** 12-hour hourly forecast in the SK v2 envelope, ascending by date. */
  public async getHourlyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
    return mapHourlyToForecasts(await this.fetchHourlyForecastRaw(location));
  }

  /** 5-day daily forecast in the SK v2 envelope, ascending by date. */
  public async getDailyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
    return mapDailyToForecasts(await this.fetchDailyForecastRaw(location));
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
    return toCoordKey(location);
  }

  /**
   * Read a location key from the location cache without issuing a network
   * lookup. Returns undefined when no entry exists for the coordinates;
   * expiry is ignored because a stale key is still the right key for the same
   * coordinates and the quota path only needs it to find a cached forecast.
   * @private
   */
  private getCachedLocationKey(location: GeoLocation): string | undefined {
    return this.locationCache.peekStale(this.locationCacheKey(location))?.Key;
  }

  /** True when the configured rolling-24h quota has been reached. @private */
  private isQuotaExhausted(): boolean {
    return isApiQuotaReached(this.getRequestCountLast24h(), this.config.dailyApiQuota);
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
    const data = await this.http.request<AccuWeatherHourlyForecast[]>(url);
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
    const data = await this.http.request<AccuWeatherDailyForecastResponse>(url);
    if (!data || typeof data !== 'object' || !Array.isArray(data.DailyForecasts)) {
      throw new Error(`${ERROR_CODES.DATA.INVALID_WEATHER_DATA}: No daily forecast data available`);
    }
    return data;
  }

  /**
   * Transform AccuWeather API response to enhanced internal weather data format.
   * Delegates the field extraction to the pure `mapAccuWeatherCurrentToWeatherData`
   * mapper, then runs the service-owned validation on its output.
   * @private
   */
  private transformWeatherData(conditions: AccuWeatherCurrentConditions): WeatherData {
    const weatherData = mapAccuWeatherCurrentToWeatherData(conditions);
    this.validateWeatherData(weatherData);
    return weatherData;
  }

  /**
   * Get location key for coordinates with caching and single-flight coalescing.
   * Delegates to the CoalescingTtlCache, which handles the prune sweep, the
   * freshness check, and the in-flight deduplication.
   * @private
   */
  private async getLocationKey(location: GeoLocation): Promise<string> {
    return (
      await this.locationCache.get(this.locationCacheKey(location), () =>
        this.searchLocation(location)
      )
    ).Key;
  }

  /**
   * Search for location by coordinates
   * @private
   */
  private async searchLocation(location: GeoLocation): Promise<AccuWeatherLocation> {
    const url = this.buildApiUrl(ACCUWEATHER.ENDPOINTS.LOCATION_SEARCH);
    url.searchParams.set('q', `${location.latitude},${location.longitude}`);

    const data = await this.http.request<AccuWeatherLocation>(url);

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

    const data = await this.http.request<AccuWeatherCurrentConditions[]>(url);

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
   * Clear the location and forecast caches. Used by the test suite; production
   * never calls it, because a config change tears down the service and
   * constructs a fresh one (caches start empty), so there is no in-place
   * cache-invalidation path to trigger.
   */
  public clearLocationCache(): void {
    this.locationCache.clear();
    this.forecastCache.clear();
    this.logger('debug', 'Location and forecast caches cleared');
  }

  /** Location-cache size, for monitoring. */
  public getCacheStats(): { size: number } {
    return { size: this.locationCache.size() };
  }

  /** Cumulative HTTP fetch attempts (initial + retries) since construction. */
  public getRequestCount(): number {
    return this.requestWindow.cumulativeCount();
  }

  /**
   * HTTP fetch attempts in the rolling last 24 hours. Backed by 24 hourly
   * buckets that rotate as time advances, so memory stays constant regardless
   * of uptime. Delegates to `RollingRequestWindow.countLast24h`, which rotates
   * before summing so a quota check made between fetches still reflects buckets
   * that have aged out.
   */
  public getRequestCountLast24h(): number {
    return this.requestWindow.countLast24h();
  }
}
