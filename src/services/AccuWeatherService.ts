/**
 * AccuWeather API Service
 * Modern TypeScript implementation with comprehensive error handling and enhanced field extraction
 */

import { ACCUWEATHER, DEFAULT_CONFIG, ERROR_CODES, PLUGIN, UNITS } from '../constants/index.js';
import type {
  AccuWeatherConfig,
  AccuWeatherCurrentConditions,
  AccuWeatherLocation,
  GeoLocation,
  Logger,
  WeatherData,
} from '../types/index.js';
import {
  calculateAbsoluteHumidity,
  calculateAirDensity,
  calculateBeaufortScale,
  celsiusToKelvin,
  clamp,
  degreesToRadians,
  isValidCoordinates,
  isValidHumidity,
  isValidPressure,
  isValidTemperature,
  isValidWindSpeed,
  kelvinToCelsius,
  kmhToMS,
  millibarsToPA,
  percentageToRatio,
  toErrorMessage,
} from '../utils/conversions.js';
import { validateAccuWeatherResponse } from '../utils/validation.js';

/** Maximum allowed response body size in bytes (1 MiB) */
const MAX_RESPONSE_BYTES = 1_048_576;

/** Threshold above which an observation is treated as low-quality in calculateDataQuality. */
const STALE_OBSERVATION_THRESHOLD_MS = 60 * 60 * 1000;

/** Validation pattern for AccuWeather location keys (URL path segment). */
const LOCATION_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** Strip control characters and truncate a string from the API to a safe length for downstream consumers. */
function capString(value: string, maxLength: number): string {
  if (typeof value !== 'string') return '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately stripping injection vectors
  const stripped = value.replace(/[\x00-\x1f\x7f]/g, '');
  return stripped.length > maxLength ? stripped.slice(0, maxLength) : stripped;
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

/** Maximum age in milliseconds for cache entries (2 hours) */
const CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/** How often the location cache prune sweep runs (5 minutes). */
const CACHE_PRUNE_INTERVAL_MS = 5 * 60 * 1000;

/** Upper bound on Retry-After delays we honor, regardless of header value. */
const MAX_RETRY_AFTER_MS = 60_000;

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

  constructor(apiKey: string, logger: Logger = () => {}, config?: Partial<AccuWeatherConfig>) {
    this.config = {
      apiKey,
      locationCacheTimeout: DEFAULT_CONFIG.LOCATION_CACHE_TIMEOUT,
      requestTimeout: DEFAULT_CONFIG.REQUEST_TIMEOUT,
      retryAttempts: DEFAULT_CONFIG.RETRY_ATTEMPTS,
      retryDelay: DEFAULT_CONFIG.RETRY_DELAY,
      ...config,
    };

    this.logger = logger;

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new Error(
        `${ERROR_CODES.CONFIGURATION.INVALID_API_KEY}: AccuWeather API key is required`
      );
    }

    this.logger('info', 'AccuWeatherService initialized', {
      hasApiKey: !!apiKey,
      cacheTimeout: this.config.locationCacheTimeout,
      requestTimeout: this.config.requestTimeout,
    });
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
    const windDirection = degreesToRadians(conditions.Wind.Direction.Degrees);
    const dewPoint = celsiusToKelvin(conditions.DewPoint.Metric.Value);
    const windChill = celsiusToKelvin(conditions.WindChillTemperature.Metric.Value);
    const heatIndex = celsiusToKelvin(conditions.RealFeelTemperature.Metric.Value);

    const toKelvin = (celsius: number | undefined): number | undefined =>
      typeof celsius === 'number' ? celsiusToKelvin(celsius) : undefined;

    // Optional chaining: free-tier keys and partial responses may omit these
    const realFeelShade = toKelvin(conditions.RealFeelTemperatureShade?.Metric?.Value);
    const wetBulbTemperature = toKelvin(conditions.WetBulbTemperature?.Metric?.Value);
    const wetBulbGlobeTemperature = toKelvin(conditions.WetBulbGlobeTemperature?.Metric?.Value);
    const apparentTemperature = toKelvin(conditions.ApparentTemperature?.Metric?.Value);

    const windGustSpeed = kmhToMS(conditions.WindGust.Speed.Metric.Value);
    // undefined when wind is calm: a literal 1 would be indistinguishable from "no gust"
    const windGustFactor = windSpeed > 0 ? windGustSpeed / windSpeed : undefined;

    const uvIndex = conditions.UVIndexFloat;
    const visibility = conditions.Visibility.Metric.Value * UNITS.LENGTH.KM_TO_M;
    const cloudCover = percentageToRatio(conditions.CloudCover);
    const cloudCeiling = conditions.Ceiling.Metric.Value;

    // Free-tier API responses can omit Precip1hr / PrecipitationSummary entirely;
    // optional chaining keeps transformWeatherData from throwing on those payloads.
    const precipitationLastHour = conditions.Precip1hr?.Metric?.Value;
    const precipitationCurrent = conditions.PrecipitationSummary?.PastHour?.Metric?.Value;

    const temperatureDeparture24h = conditions.Past24HourTemperatureDeparture?.Metric?.Value;

    // Calculate synthetic values (humidity is already a ratio)
    const beaufortScale = calculateBeaufortScale(windSpeed, windGustSpeed);
    const absoluteHumidity = calculateAbsoluteHumidity(temperature, humidity);
    const airDensityEnhanced = calculateAirDensity(temperature, pressure, humidity);
    const heatStressIndex =
      wetBulbGlobeTemperature !== undefined
        ? this.calculateHeatStressIndex(wetBulbGlobeTemperature)
        : undefined;

    const weatherData: WeatherData = {
      // Core measurements
      temperature,
      pressure,
      humidity,
      windSpeed,
      windDirection,
      dewPoint,
      windChill,
      heatIndex,

      // Enhanced temperature readings: conditional spread so we never assign
      // explicit `undefined` under exactOptionalPropertyTypes
      ...(realFeelShade !== undefined && { realFeelShade }),
      ...(wetBulbTemperature !== undefined && { wetBulbTemperature }),
      ...(wetBulbGlobeTemperature !== undefined && { wetBulbGlobeTemperature }),
      ...(apparentTemperature !== undefined && { apparentTemperature }),

      // Enhanced wind data
      windGustSpeed,
      ...(windGustFactor !== undefined && { windGustFactor }),

      // Atmospheric conditions
      uvIndex,
      visibility,
      cloudCover,
      cloudCeiling,

      // Precipitation (omitted on free-tier responses that lack these fields)
      ...(precipitationLastHour !== undefined && { precipitationLastHour }),
      ...(precipitationCurrent !== undefined && { precipitationCurrent }),

      // Temperature trends
      ...(temperatureDeparture24h !== undefined && { temperatureDeparture24h }),

      // Calculated synthetic values
      beaufortScale,
      absoluteHumidity,
      airDensityEnhanced,
      ...(heatStressIndex !== undefined && { heatStressIndex }),

      // Metadata
      description: capString(conditions.WeatherText, ACCUWEATHER.MAX_DESCRIPTION_LENGTH),
      timestamp: capString(conditions.LocalObservationDateTime, ACCUWEATHER.MAX_LABEL_LENGTH),
      quality: this.calculateDataQuality(conditions),
    };

    // Validate transformed data
    this.validateWeatherData(weatherData);

    return weatherData;
  }

  /**
   * Calculate heat stress index from wet bulb globe temperature
   * @private
   */
  private calculateHeatStressIndex(wetBulbGlobeTemperatureK: number): number {
    const wbgtC = kelvinToCelsius(wetBulbGlobeTemperatureK);
    // Heat stress categories (military/marine standard)
    if (wbgtC < 27) return 0;
    if (wbgtC < 29) return 1;
    if (wbgtC < 31) return 2;
    if (wbgtC < 33) return 3;
    return 4;
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

    // Remove expired entries
    for (const [key, entry] of this.locationCache.entries()) {
      if (now - entry.timestamp > CACHE_MAX_AGE_MS) {
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

    const cacheKey = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
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
    const url = new URL(`${ACCUWEATHER.BASE_URL}${ACCUWEATHER.ENDPOINTS.LOCATION_SEARCH}`);
    url.searchParams.set('apikey', this.config.apiKey);
    url.searchParams.set('q', `${location.latitude},${location.longitude}`);
    url.searchParams.set('language', ACCUWEATHER.DEFAULT_LANGUAGE);
    url.searchParams.set('details', 'true');

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
    if (!LOCATION_KEY_PATTERN.test(locationKey)) {
      // Defense-in-depth: searchLocation already validates, but the cache could
      // theoretically be poisoned if its invariants ever drift.
      throw new Error(
        `${ERROR_CODES.NETWORK.API_INVALID_RESPONSE}: refusing to use malformed location key in URL path`
      );
    }

    const url = new URL(
      `${ACCUWEATHER.BASE_URL}${ACCUWEATHER.ENDPOINTS.CURRENT_CONDITIONS}/${locationKey}`
    );
    url.searchParams.set('apikey', this.config.apiKey);
    url.searchParams.set('language', ACCUWEATHER.DEFAULT_LANGUAGE);
    url.searchParams.set('details', 'true');

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

      // Count every fetch attempt (initial + retries). Off the emission hot
      // path: this fires at most once per AccuWeather call, default cadence
      // five minutes. Cheap integer increment, no allocation.
      this.requestCount++;

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': `${PLUGIN.NAME}/${PLUGIN.VERSION}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

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
      this.logger('debug', 'API error response was not JSON, falling back to statusText', {
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
   * Calculate data quality score based on conditions
   * @private
   */
  private calculateDataQuality(conditions: AccuWeatherCurrentConditions): number {
    let quality = 1.0;

    // Penalize stale or missing-timestamp observations (>1h old or non-finite EpochTime).
    if (Number.isFinite(conditions.EpochTime)) {
      const observationAge = Date.now() - conditions.EpochTime * 1000;
      if (observationAge > STALE_OBSERVATION_THRESHOLD_MS) {
        quality -= 0.2;
      }
    } else {
      quality -= 0.2;
    }

    if (conditions.RelativeHumidity <= 0 || conditions.RelativeHumidity > 100) {
      quality -= 0.1;
    }

    if (conditions.WindGust.Speed.Metric.Value > 0) quality += 0.05;
    if (conditions.Visibility.Metric.Value > 0) quality += 0.05;

    return clamp(quality, 0, 1);
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
    this.logger('debug', 'Location cache cleared');
  }

  /** Location-cache size, for monitoring. */
  public getCacheStats(): { size: number } {
    return { size: this.locationCache.size };
  }

  /** Cumulative HTTP fetch attempts (initial + retries) since construction. */
  public getRequestCount(): number {
    return this.requestCount;
  }
}
