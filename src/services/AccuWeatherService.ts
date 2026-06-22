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
  isValidCoordinates,
  isValidHumidity,
  isValidPressure,
  isValidTemperature,
  isValidWindSpeed,
  toErrorMessage,
} from '../utils/conversions.js';
import { validateAccuWeatherResponse } from '../utils/validation.js';
import { evictOldestOverCap } from './cache/cacheUtils.js';
import { ForecastCache } from './cache/ForecastCache.js';

/** Maximum allowed response body size in bytes (1 MiB) */
const MAX_RESPONSE_BYTES = 1_048_576;

/** Validation pattern for AccuWeather location keys (URL path segment). */
const LOCATION_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Lowercased retryable error code substrings. An array, not a Set: membership is
 * tested by substring (`message.includes`), not exact key, so a Set buys nothing.
 * Lowercased once at module load so isRetryableError does not recompute it.
 */
const RETRYABLE_ERROR_SUBSTRINGS: ReadonlyArray<string> = [
  ERROR_CODES.NETWORK.API_RATE_LIMIT.toLowerCase(),
  ERROR_CODES.NETWORK.NETWORK_ERROR.toLowerCase(),
  'timeout',
  'econnreset',
  'enotfound',
];

/** How often the location cache prune sweep runs (5 minutes). */
const CACHE_PRUNE_INTERVAL_MS = 5 * 60 * 1000;

/** Upper bound on Retry-After delays we honor, regardless of header value. */
const MAX_RETRY_AFTER_MS = 60_000;

/** Number of hourly buckets in the rolling 24h request window. */
const REQUEST_WINDOW_HOURS = 24;
/** Hour expressed in milliseconds, used by the rolling window rotation. */
const HOUR_MS = 60 * 60 * 1000;

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
   * Fixed-length array of 24 hourly request-count buckets spanning the last 24
   * hours. The last slot (`requestWindow[REQUEST_WINDOW_HOURS - 1]`) is the
   * current hour; earlier indices step into the past. `rotateRequestWindow`
   * shifts the array left by the number of elapsed hours (dropping the oldest,
   * pushing zeros at the current-hour end), so memory stays at exactly 24
   * numbers regardless of uptime. The current-hour epoch index lives in
   * `requestWindowCurrentHour`.
   */
  private requestWindow: number[] = new Array(REQUEST_WINDOW_HOURS).fill(0);
  /**
   * Epoch-hour index of the LAST bucket (`requestWindow[REQUEST_WINDOW_HOURS - 1]`),
   * i.e. the current-hour slot. On rotation we shift the array left by the
   * number of elapsed hours and update this index.
   */
  private requestWindowCurrentHour = Math.floor(Date.now() / HOUR_MS);
  /**
   * On-demand forecast cache, keyed by `${kind}:${locationKey}`. Separate from
   * locationCache because forecasts have their own per-kind TTLs and are pulled
   * by external Weather API consumers rather than the plugin's own fetch timer.
   */
  private readonly forecastCache: ForecastCache;
  /**
   * In-flight location searches keyed by location-cache key, so concurrent cold
   * lookups for the same coordinates share one upstream call instead of each
   * spending a request. Entries clear when the search settles.
   */
  private inFlightLocationSearch = new Map<string, Promise<AccuWeatherLocation>>();

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
    this.forecastCache = new ForecastCache(() => this.quotaReachedError(), this.logger);

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
  public async fetchHourlyForecastRaw(location: GeoLocation): Promise<AccuWeatherHourlyForecast[]> {
    this.validateLocation(location);
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
    this.validateLocation(location);
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
    this.validateLocation(location);
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

    // If still over max size, remove oldest entries.
    pruned += evictOldestOverCap(this.locationCache, (entry) => entry.timestamp);

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

    const locationData = await this.searchLocationCoalesced(cacheKey, location);

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
   * Coalesce concurrent cold location searches for the same coordinates onto a
   * single upstream call. Without this a dashboard hitting getHourlyForecast and
   * getDailyForecast at once on an empty cache would fire two identical location
   * searches, spending two requests against the free 50/day key for one lookup.
   * The in-flight entry clears when the search settles (success or failure).
   * @private
   */
  private searchLocationCoalesced(
    cacheKey: string,
    location: GeoLocation
  ): Promise<AccuWeatherLocation> {
    const existing = this.inFlightLocationSearch.get(cacheKey);
    if (existing) return existing;
    const promise = this.searchLocation(location).finally(() => {
      this.inFlightLocationSearch.delete(cacheKey);
    });
    this.inFlightLocationSearch.set(cacheKey, promise);
    return promise;
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

      // The timeout must stay armed across this call: `fetch` resolves at
      // headers-received, and without the signal the body read would be
      // bounded only by undici's 300 s inactivity default instead of the
      // configured requestTimeout.
      return await this.readBoundedJson<T>(response);
    } catch (error) {
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
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Read a Response body as JSON with a size cap. The Content-Length check
   * rejects an oversized declared body before `response.text()` buffers it; the
   * post-read length check is a fallback for a missing (chunked) or lying
   * Content-Length, bounding what reaches `JSON.parse` (the body is already
   * buffered by then, so it caps the parse step, not the buffering).
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

    // Read as text with a length check: Content-Length may be missing (chunked
    // encoding) or lie about the body size. `text.length` is UTF-16 code units,
    // not bytes, but as an upper-bound safety cap that distinction is immaterial.
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new Error(
        `${ERROR_CODES.NETWORK.RESPONSE_TOO_LARGE}: AccuWeather response is ${text.length} characters (max ${MAX_RESPONSE_BYTES})`
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
        return this.throwRetryableStatus(attempt, retryAfterMs, {
          code: ERROR_CODES.NETWORK.API_RATE_LIMIT,
          logLabel: 'Rate limited by API, will retry',
          retryingMessage: `Rate limited, retrying - ${message}`,
          finalMessage: `Rate limit exceeded - ${message}`,
        });
      case 503:
        return this.throwRetryableStatus(attempt, retryAfterMs, {
          code: ERROR_CODES.NETWORK.NETWORK_ERROR,
          logLabel: 'Service unavailable, will retry',
          retryingMessage: `Service temporarily unavailable, retrying - ${message}`,
          finalMessage: `Service unavailable - ${message}`,
        });
      default:
        // A 5xx is a server fault that may recover, so tag it retryable
        // (NETWORK_ERROR). A 4xx is a client fault that will not change on
        // retry, so tag it non-retryable to avoid burning attempts and quota.
        if (statusCode >= 500) {
          throw new Error(
            `${ERROR_CODES.NETWORK.NETWORK_ERROR}: API request failed (${statusCode}) - ${message}`
          );
        }
        throw new Error(
          `${ERROR_CODES.NETWORK.API_INVALID_RESPONSE}: API request failed (${statusCode}) - ${message}`
        );
    }
  }

  /**
   * Throw a retryable-status error: while attempts remain, log and throw an
   * Error tagged with `retryAfterMs` so `makeApiRequest` retries; on the last
   * attempt throw a plain final error. Shared by the 429 and 503 branches.
   * @private
   */
  private throwRetryableStatus(
    attempt: number,
    retryAfterMs: number | null,
    opts: { code: string; logLabel: string; retryingMessage: string; finalMessage: string }
  ): never {
    if (attempt < this.config.retryAttempts) {
      this.logger('warn', opts.logLabel, {
        attempt,
        retryAfterMs,
        retryAfterHeader: !!retryAfterMs,
      });
      throw Object.assign(new Error(`${opts.code}: ${opts.retryingMessage}`), { retryAfterMs });
    }
    throw new Error(`${opts.code}: ${opts.finalMessage}`);
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
      // The module-level lowercased list avoids recomputing toLowerCase() on every retry decision.
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
