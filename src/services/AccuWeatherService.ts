/**
 * AccuWeather API Service
 * Modern TypeScript implementation with comprehensive error handling and enhanced field extraction
 */

import {
  ACCUWEATHER,
  DEFAULT_CONFIG,
  ERROR_CODES,
  UNITS,
  VALIDATION_LIMITS,
} from '../constants/index.js';
import type {
  AccuWeatherConfig,
  AccuWeatherCurrentConditions,
  AccuWeatherLocation,
  ApiResponse,
  GeoLocation,
  Logger,
  WeatherData,
} from '../types/index.js';
import {
  calculateAbsoluteHumidity,
  calculateAirDensity,
  calculateBeaufortScale,
} from '../utils/conversions.js';

/**
 * AccuWeather API client for weather data operations
 * Provides type-safe interface to AccuWeather REST API with caching and error handling
 */
/** Maximum number of entries in location cache before pruning */
const MAX_CACHE_SIZE = 100;

/** Maximum age in milliseconds for cache entries (2 hours) */
const CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export class AccuWeatherService {
  private readonly config: AccuWeatherConfig;
  private readonly logger: Logger;
  private locationCache = new Map<string, { location: AccuWeatherLocation; timestamp: number }>();
  private lastCachePrune = Date.now();

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
      // Get or find location key for coordinates
      const locationKey = await this.getLocationKey(location);

      // Fetch current conditions from AccuWeather
      const currentConditions = await this.getCurrentConditions(locationKey);

      // Transform API response to our internal format
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
        enhancedFieldsCount: this.countEnhancedFields(weatherData),
      });

      return weatherData;
    } catch (error) {
      this.logger('error', 'Failed to fetch weather data', {
        location: `${location.latitude},${location.longitude}`,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Transform AccuWeather API response to enhanced internal weather data format
   * @private
   */
  private transformWeatherData(conditions: AccuWeatherCurrentConditions): WeatherData {
    // Core measurements (existing)
    const temperature = conditions.Temperature.Metric.Value + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
    const pressure = conditions.Pressure.Metric.Value * UNITS.PRESSURE.MILLIBAR_TO_PASCAL;
    const humidity = conditions.RelativeHumidity / 100; // Convert percentage to ratio (0-1) per Signal K spec
    const windSpeed = conditions.Wind.Speed.Metric.Value * UNITS.WIND_SPEED.KMH_TO_MS;
    const windDirection = conditions.Wind.Direction.Degrees * UNITS.ANGLE.DEGREES_TO_RADIANS;
    const dewPoint = conditions.DewPoint.Metric.Value + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
    const windChill =
      conditions.WindChillTemperature.Metric.Value + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;
    const heatIndex =
      conditions.RealFeelTemperature.Metric.Value + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;

    const toKelvin = (celsius: number | undefined): number | undefined =>
      typeof celsius === 'number' ? celsius + UNITS.TEMPERATURE.CELSIUS_TO_KELVIN : undefined;

    // Enhanced temperature readings (new) — optional chaining because free-tier keys
    // and partial responses can omit these fields
    const realFeelShade = toKelvin(conditions.RealFeelTemperatureShade?.Metric?.Value);
    const wetBulbTemperature = toKelvin(conditions.WetBulbTemperature?.Metric?.Value);
    const wetBulbGlobeTemperature = toKelvin(conditions.WetBulbGlobeTemperature?.Metric?.Value);
    const apparentTemperature = toKelvin(conditions.ApparentTemperature?.Metric?.Value);

    // Enhanced wind data (new)
    const windGustSpeed = conditions.WindGust.Speed.Metric.Value * UNITS.WIND_SPEED.KMH_TO_MS;
    // undefined when wind is calm — a literal 1 would be indistinguishable from "no gust"
    const windGustFactor = windSpeed > 0 ? windGustSpeed / windSpeed : undefined;

    // Atmospheric conditions (new)
    const uvIndex = conditions.UVIndexFloat;
    const visibility = conditions.Visibility.Metric.Value * 1000; // Convert km to meters
    const cloudCover = conditions.CloudCover / 100; // Convert percentage to ratio
    const cloudCeiling = conditions.Ceiling.Metric.Value; // Already in meters
    const pressureTendency = conditions.PressureTendency.LocalizedText;

    // Precipitation data (new)
    const precipitationLastHour = conditions.Precip1hr.Metric.Value; // Already in mm
    const precipitationCurrent = conditions.PrecipitationSummary.PastHour.Metric.Value; // mm in last hour

    // Temperature trends (new)
    const temperatureDeparture24h = conditions.Past24HourTemperatureDeparture.Metric.Value; // Keep as Celsius delta

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

      // Enhanced temperature readings — conditional spread so we never assign
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
      pressureTendency,

      // Precipitation
      precipitationLastHour,
      precipitationCurrent,

      // Temperature trends
      temperatureDeparture24h,

      // Calculated synthetic values
      beaufortScale,
      absoluteHumidity,
      airDensityEnhanced,
      ...(heatStressIndex !== undefined && { heatStressIndex }),

      // Metadata
      description: conditions.WeatherText,
      timestamp: conditions.LocalObservationDateTime,
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
    try {
      // Convert to Celsius for calculation
      const wbgtC = wetBulbGlobeTemperatureK - UNITS.TEMPERATURE.CELSIUS_TO_KELVIN;

      // Heat stress categories (military/marine standard)
      if (wbgtC < 27) return 0; // No heat stress
      if (wbgtC < 29) return 1; // Low heat stress
      if (wbgtC < 31) return 2; // Moderate heat stress
      if (wbgtC < 33) return 3; // High heat stress
      return 4; // Extreme heat stress
    } catch (error) {
      this.logger('warn', 'Failed to calculate heat stress index', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Count enhanced fields for logging
   * @private
   */
  private countEnhancedFields(weatherData: WeatherData): number {
    let count = 0;
    if (weatherData.realFeelShade !== undefined) count++;
    if (weatherData.wetBulbTemperature !== undefined) count++;
    if (weatherData.wetBulbGlobeTemperature !== undefined) count++;
    if (weatherData.windGustSpeed !== undefined) count++;
    if (weatherData.uvIndex !== undefined) count++;
    if (weatherData.visibility !== undefined) count++;
    if (weatherData.cloudCover !== undefined) count++;
    if (weatherData.beaufortScale !== undefined) count++;
    return count;
  }

  /**
   * Prune expired and excess entries from location cache
   * @private
   */
  private pruneLocationCache(): void {
    const now = Date.now();

    // Only prune every 5 minutes to avoid overhead
    if (now - this.lastCachePrune < 5 * 60 * 1000) {
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

    // Check cache first
    const cached = this.locationCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.config.locationCacheTimeout * 1000) {
      this.logger('debug', 'Using cached location key', { cacheKey });
      return cached.location.Key;
    }

    // Fetch location data from API
    const locationData = await this.searchLocation(location);

    // Cache the result
    this.locationCache.set(cacheKey, {
      location: locationData,
      timestamp: Date.now(),
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

    const response = await this.makeApiRequest<AccuWeatherLocation>(url);

    if (!response.data) {
      throw new Error(
        `${ERROR_CODES.DATA.INVALID_WEATHER_DATA}: No location found for coordinates`
      );
    }

    return response.data;
  }

  /**
   * Get current weather conditions for location key
   * @private
   */
  private async getCurrentConditions(locationKey: string): Promise<AccuWeatherCurrentConditions[]> {
    const url = new URL(
      `${ACCUWEATHER.BASE_URL}${ACCUWEATHER.ENDPOINTS.CURRENT_CONDITIONS}/${locationKey}`
    );
    url.searchParams.set('apikey', this.config.apiKey);
    url.searchParams.set('language', ACCUWEATHER.DEFAULT_LANGUAGE);
    url.searchParams.set('details', 'true');

    const response = await this.makeApiRequest<AccuWeatherCurrentConditions[]>(url);

    if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
      throw new Error(
        `${ERROR_CODES.DATA.INVALID_WEATHER_DATA}: No current conditions data available`
      );
    }

    return response.data;
  }

  /**
   * Make API request with retry logic and error handling
   * @private
   */
  private async makeApiRequest<T>(url: URL, attempt = 1): Promise<ApiResponse<T>> {
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
          'User-Agent': 'signalk-virtual-weather-sensors/1.0.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        await this.handleApiError(response, attempt);
      }

      const data = (await response.json()) as T;

      return {
        data,
        timestamp: new Date().toISOString(),
      };
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
        this.logger('warn', 'Retryable error, attempting retry', {
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.delay(this.config.retryDelay * attempt);
        return this.makeApiRequest<T>(url, attempt + 1);
      }

      throw error;
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
      return Math.min(seconds * 1000, 60000); // Cap at 60 seconds
    }

    // Try parsing as HTTP date
    const retryDate = new Date(retryAfter);
    if (!Number.isNaN(retryDate.getTime())) {
      const delayMs = retryDate.getTime() - Date.now();
      if (delayMs > 0) {
        return Math.min(delayMs, 60000); // Cap at 60 seconds
      }
    }

    return null;
  }

  /**
   * Handle API error responses
   * Respects Retry-After header when present for rate limiting
   * @private
   */
  private async handleApiError(response: Response, attempt: number): Promise<never> {
    const statusCode = response.status;
    const retryAfterMs = this.parseRetryAfter(response);

    let message = response.statusText;
    try {
      const errorData = (await response.json()) as { message?: string };
      message = errorData.message || response.statusText;
    } catch {
      // JSON parse failed, use statusText
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
        // Rate limited - use Retry-After header or exponential backoff
        if (attempt < this.config.retryAttempts) {
          const delayMs = retryAfterMs || this.config.retryDelay * 2 ** (attempt - 1);
          this.logger('warn', 'Rate limited by API, waiting before retry', {
            attempt,
            delayMs,
            retryAfterHeader: !!retryAfterMs,
          });
          await this.delay(delayMs);
          throw new Error(
            `${ERROR_CODES.NETWORK.API_RATE_LIMIT}: Rate limited, retrying - ${message}`
          );
        }
        throw new Error(`${ERROR_CODES.NETWORK.API_RATE_LIMIT}: Rate limit exceeded - ${message}`);
      case 503:
        if (attempt < this.config.retryAttempts) {
          // Service temporarily unavailable - use Retry-After or exponential backoff
          const delayMs = retryAfterMs || this.config.retryDelay * 2 ** (attempt - 1);
          this.logger('warn', 'Service unavailable, waiting before retry', {
            attempt,
            delayMs,
            retryAfterHeader: !!retryAfterMs,
          });
          await this.delay(delayMs);
          throw new Error(
            `${ERROR_CODES.NETWORK.NETWORK_ERROR}: Service temporarily unavailable, retrying - ${message}`
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

    // Reduce quality for very old observations (more than 1 hour)
    const observationAge = Date.now() - conditions.EpochTime * 1000;
    if (observationAge > 3600000) {
      // 1 hour
      quality -= 0.2;
    }

    // Reduce quality if critical data is missing or invalid (humidity should be 0-100%)
    if (conditions.RelativeHumidity <= 0 || conditions.RelativeHumidity > 100) {
      quality -= 0.1;
    }

    // Increase quality for rich data sets
    if (conditions.WindGust.Speed.Metric.Value > 0) quality += 0.05;
    if (conditions.Visibility.Metric.Value > 0) quality += 0.05;

    return Math.max(0, Math.min(1, quality));
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

    if (
      location.latitude < VALIDATION_LIMITS.COORDINATES.LATITUDE.MIN ||
      location.latitude > VALIDATION_LIMITS.COORDINATES.LATITUDE.MAX
    ) {
      throw new Error(
        `${ERROR_CODES.CONFIGURATION.INVALID_COORDINATES}: Latitude must be between -90 and 90 degrees`
      );
    }

    if (
      location.longitude < VALIDATION_LIMITS.COORDINATES.LONGITUDE.MIN ||
      location.longitude > VALIDATION_LIMITS.COORDINATES.LONGITUDE.MAX
    ) {
      throw new Error(
        `${ERROR_CODES.CONFIGURATION.INVALID_COORDINATES}: Longitude must be between -180 and 180 degrees`
      );
    }
  }

  /**
   * Validate transformed weather data
   * @private
   */
  private validateWeatherData(data: WeatherData): void {
    if (
      data.temperature < VALIDATION_LIMITS.TEMPERATURE.MIN ||
      data.temperature > VALIDATION_LIMITS.TEMPERATURE.MAX
    ) {
      this.logger('warn', 'Temperature outside expected range', { temperature: data.temperature });
    }

    if (
      data.pressure < VALIDATION_LIMITS.PRESSURE.MIN ||
      data.pressure > VALIDATION_LIMITS.PRESSURE.MAX
    ) {
      this.logger('warn', 'Pressure outside expected range', { pressure: data.pressure });
    }

    if (
      data.humidity < VALIDATION_LIMITS.HUMIDITY.MIN ||
      data.humidity > VALIDATION_LIMITS.HUMIDITY.MAX
    ) {
      this.logger('warn', 'Humidity outside expected range', { humidity: data.humidity });
    }

    if (
      data.windSpeed < VALIDATION_LIMITS.WIND_SPEED.MIN ||
      data.windSpeed > VALIDATION_LIMITS.WIND_SPEED.MAX
    ) {
      this.logger('warn', 'Wind speed outside expected range', { windSpeed: data.windSpeed });
    }
  }

  /**
   * Check if error is retryable
   * @private
   */
  /**
   * Return URL string with the apikey query parameter stripped so it's safe to log.
   * Debug-level logs are not passed through sanitizeLogMetadata, so we must strip
   * secrets here before they reach the logger.
   * @private
   */
  private sanitizeUrlForLogging(url: URL): string {
    const safe = new URL(url.toString());
    if (safe.searchParams.has('apikey')) {
      safe.searchParams.set('apikey', '***');
    }
    return safe.toString();
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Match on the error codes handleApiError emits for transient failures,
      // plus common network-layer error names
      return (
        message.includes(ERROR_CODES.NETWORK.API_RATE_LIMIT.toLowerCase()) ||
        message.includes(ERROR_CODES.NETWORK.NETWORK_ERROR.toLowerCase()) ||
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('enotfound')
      );
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

  /**
   * Get cache statistics for monitoring
   */
  public getCacheStats(): { size: number } {
    return {
      size: this.locationCache.size,
    };
  }
}
