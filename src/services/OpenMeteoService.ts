/**
 * Open-Meteo current-conditions provider.
 *
 * Implements `CurrentWeatherProvider` and `ForecastCapableProvider` against the
 * keyless, global Open-Meteo forecast API. No API key, no location-key lookup
 * (Open-Meteo takes lat/lon directly), and no per-key daily cap, so the quota
 * accessors report zero. The base URL is configurable so a commercial user can
 * point at a self-hosted or paid Open-Meteo instance (the free hosted service is
 * non-commercial).
 */

import type { WeatherData as SKWeatherData } from '@signalk/server-api';
import { PLUGIN } from '../constants/index.js';
import {
  mapOpenMeteoCurrentToObservation,
  mapOpenMeteoDailyToForecasts,
  mapOpenMeteoHourlyToForecasts,
} from '../mappers/OpenMeteoForecastMapper.js';
import { mapOpenMeteoCurrentToWeatherData } from '../mappers/OpenMeteoMapper.js';
import type { ForecastCapableProvider } from '../providers/WeatherProvider.js';
import type {
  GeoLocation,
  Logger,
  OpenMeteoCurrentResponse,
  OpenMeteoForecastResponse,
  WeatherData,
} from '../types/index.js';
import { isAbortError, toErrorMessage } from '../utils/conversions.js';
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchJson, normalizeBaseUrl } from '../utils/http.js';
import { assertValidCoordinates } from '../utils/validation.js';

/** Default Open-Meteo host. Overridable so commercial users can self-host or use a paid plan. */
const DEFAULT_BASE_URL = 'https://api.open-meteo.com';
/** Forecast endpoint path. */
const FORECAST_ENDPOINT = '/v1/forecast';
/** Current-block variables requested. Order is cosmetic; units are set on the query. */
const CURRENT_PARAMS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'precipitation',
  'weather_code',
  'cloud_cover',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'dew_point_2m',
  'visibility',
  'uv_index',
].join(',');
/** Hourly-block variables for the 48-hour point-forecast endpoint. */
const HOURLY_PARAMS = [
  'temperature_2m',
  'relative_humidity_2m',
  'dew_point_2m',
  'apparent_temperature',
  'precipitation',
  'weather_code',
  'cloud_cover',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'visibility',
  'uv_index',
].join(',');
/** Daily-block variables for the 7-day daily-forecast endpoint. */
const DAILY_PARAMS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'weather_code',
  'wind_speed_10m_max',
  'wind_direction_10m_dominant',
  'wind_gusts_10m_max',
  'uv_index_max',
  'sunrise',
  'sunset',
].join(',');
/** Days fetched for the hourly forecast: 2 days == 48 hours, matching forecastCapabilities.hourlyHours. */
const HOURLY_FORECAST_DAYS = 2;
/** Days fetched for the daily forecast, matching forecastCapabilities.dailyDays. */
const DAILY_FORECAST_DAYS = 7;

export interface OpenMeteoOptions {
  /** Override the Open-Meteo host (self-hosted or paid instance). */
  readonly baseUrl?: string;
  /** Override the per-request timeout in milliseconds. */
  readonly requestTimeoutMs?: number;
  readonly signal?: AbortSignal | undefined;
}

export class OpenMeteoService implements ForecastCapableProvider {
  /** Provider name for the v2 registration and logs. */
  public readonly name = 'Open-Meteo';
  /** `$source` stamped on Open-Meteo-sourced deltas, distinct from AccuWeather. */
  public readonly sourceRef = 'open-meteo';
  public readonly maxObservationAgeMs = 60 * 60 * 1000;
  /** Forecast horizon this provider declares; read by the v2 adapter to size its result arrays. */
  public readonly forecastCapabilities = { hourlyHours: 48, dailyDays: 7 } as const;

  private readonly logger: Logger;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  /** Cumulative attempted-fetch count (incremented before each request), for the status banner. */
  private requestCount = 0;
  private readonly signal: AbortSignal | undefined;
  private readonly userAgent = `${PLUGIN.NAME}/${PLUGIN.VERSION}`;

  constructor(logger: Logger = () => {}, options?: OpenMeteoOptions) {
    this.logger = logger;
    this.baseUrl = normalizeBaseUrl(options?.baseUrl, DEFAULT_BASE_URL);
    this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.signal = options?.signal;

    this.logger('info', 'OpenMeteoService initialized', { baseUrl: this.baseUrl });
  }

  public async fetchCurrentWeather(location: GeoLocation): Promise<WeatherData> {
    assertValidCoordinates(location, 'Open-Meteo request');
    const url = this.buildUrl(location);

    try {
      this.requestCount++;
      const response = await fetchJson<OpenMeteoCurrentResponse>(url, {
        timeoutMs: this.requestTimeoutMs,
        headers: { 'User-Agent': this.userAgent },
        signal: this.signal,
      });
      const weatherData = mapOpenMeteoCurrentToWeatherData(response);

      this.logger('info', 'Open-Meteo weather retrieved', {
        location: `${location.latitude},${location.longitude}`,
        temperature: weatherData.temperature,
        windSpeed: weatherData.windSpeed,
      });

      return weatherData;
    } catch (error) {
      if (isAbortError(error)) {
        this.requestCount--;
        throw error;
      }
      this.logger('error', 'Failed to fetch Open-Meteo weather', {
        location: `${location.latitude},${location.longitude}`,
        error: toErrorMessage(error),
      });
      throw error;
    }
  }

  /** Fetch a single current observation at `location` in the SK v2 WeatherData shape. */
  public async getObservation(location: GeoLocation): Promise<SKWeatherData> {
    assertValidCoordinates(location, 'Open-Meteo observation');
    try {
      this.requestCount++;
      const response = await fetchJson<OpenMeteoCurrentResponse>(this.buildUrl(location), {
        timeoutMs: this.requestTimeoutMs,
        headers: { 'User-Agent': this.userAgent },
        signal: this.signal,
      });
      return mapOpenMeteoCurrentToObservation(response);
    } catch (error) {
      if (isAbortError(error)) {
        this.requestCount--;
        throw error;
      }
      this.logger('error', 'Failed to fetch Open-Meteo observation', {
        location: `${location.latitude},${location.longitude}`,
        error: toErrorMessage(error),
      });
      throw error;
    }
  }

  /** Fetch hourly (point) forecasts for the next 48 hours in ascending order. */
  public async getHourlyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
    assertValidCoordinates(location, 'Open-Meteo hourly forecast');
    try {
      this.requestCount++;
      const url = this.buildForecastUrl(location, {
        hourly: HOURLY_PARAMS,
        forecastDays: HOURLY_FORECAST_DAYS,
      });
      const response = await fetchJson<OpenMeteoForecastResponse>(url, {
        timeoutMs: this.requestTimeoutMs,
        headers: { 'User-Agent': this.userAgent },
        signal: this.signal,
      });
      return mapOpenMeteoHourlyToForecasts(response);
    } catch (error) {
      if (isAbortError(error)) {
        this.requestCount--;
        throw error;
      }
      this.logger('error', 'Failed to fetch Open-Meteo hourly forecast', {
        location: `${location.latitude},${location.longitude}`,
        error: toErrorMessage(error),
      });
      throw error;
    }
  }

  /** Fetch daily forecasts for the next 7 days in ascending order. */
  public async getDailyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
    assertValidCoordinates(location, 'Open-Meteo daily forecast');
    try {
      this.requestCount++;
      const url = this.buildForecastUrl(location, {
        daily: DAILY_PARAMS,
        forecastDays: DAILY_FORECAST_DAYS,
      });
      const response = await fetchJson<OpenMeteoForecastResponse>(url, {
        timeoutMs: this.requestTimeoutMs,
        headers: { 'User-Agent': this.userAgent },
        signal: this.signal,
      });
      return mapOpenMeteoDailyToForecasts(response);
    } catch (error) {
      if (isAbortError(error)) {
        this.requestCount--;
        throw error;
      }
      this.logger('error', 'Failed to fetch Open-Meteo daily forecast', {
        location: `${location.latitude},${location.longitude}`,
        error: toErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Build the shared base URL for all Open-Meteo requests: lat/lon, m/s wind
   * units, and GMT timezone. Callers append block-specific params on top.
   */
  private buildBaseUrl(location: GeoLocation): URL {
    const url = new URL(`${this.baseUrl}${FORECAST_ENDPOINT}`);
    url.searchParams.set('latitude', String(location.latitude));
    url.searchParams.set('longitude', String(location.longitude));
    url.searchParams.set('wind_speed_unit', 'ms');
    url.searchParams.set('timezone', 'GMT');
    return url;
  }

  /** Build the current-block request URL. */
  private buildUrl(location: GeoLocation): URL {
    const url = this.buildBaseUrl(location);
    url.searchParams.set('current', CURRENT_PARAMS);
    return url;
  }

  /**
   * Build a forecast request URL (hourly or daily block) sharing the same base
   * params as `buildUrl`: lat/lon, m/s wind units, and GMT timezone.
   */
  private buildForecastUrl(
    location: GeoLocation,
    params: { hourly?: string; daily?: string; forecastDays: number }
  ): URL {
    const url = this.buildBaseUrl(location);
    if (params.hourly !== undefined) {
      url.searchParams.set('hourly', params.hourly);
    }
    if (params.daily !== undefined) {
      url.searchParams.set('daily', params.daily);
    }
    url.searchParams.set('forecast_days', String(params.forecastDays));
    return url;
  }

  /** Cumulative request count, for the status banner. */
  public getRequestCount(): number {
    return this.requestCount;
  }

  /** Keyless: Open-Meteo has no per-key daily cap, so there is no rolling window to report. */
  public getRequestCountLast24h(): number {
    return 0;
  }

  /** Open-Meteo needs no location-key cache (it takes lat/lon directly). */
  public getCacheStats(): { size: number } {
    return { size: 0 };
  }

  public isCurrentWeatherFetchBlocked(): boolean {
    return false;
  }
}
