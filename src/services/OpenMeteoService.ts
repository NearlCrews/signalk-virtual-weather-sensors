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
import { FORECAST_CACHE, PLUGIN } from '../constants/index.js';
import { WEATHER_PROVIDER_SHORT_LABELS } from '../constants/notifications-shared.js';
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
import { isAbortError, toCoordKey, toErrorMessage } from '../utils/conversions.js';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchJson,
  normalizeBaseUrl,
  RequestCounter,
  setCoordParams,
} from '../utils/http.js';
import { assertValidCoordinates } from '../utils/validation.js';
import { CoalescingTtlCache } from './cache/CoalescingTtlCache.js';

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
/**
 * 15-minutely companion variable requested alongside the current block. The
 * current block's `precipitation` covers only its 900-second `interval`, so
 * `environment.weather.precipitationLastHour` sums the four 15-minute buckets
 * that end at the observation stamp instead: a rolling past hour, not the last
 * completed clock hour, which lagged by up to 59 minutes.
 */
const CURRENT_COMPANION_MINUTELY_PARAMS = 'precipitation';
/**
 * 15-minutely companion window. `forecast_minutely_15=1` yields the bucket at
 * the current step, which is the observation stamp, and `past_minutely_15=4`
 * supplies the three before it plus one spare for a stamp that straddles a
 * step boundary.
 */
const CURRENT_COMPANION_PAST_STEPS = 4;
const CURRENT_COMPANION_FORECAST_STEPS = 1;
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
  public readonly name = WEATHER_PROVIDER_SHORT_LABELS['open-meteo'];
  /** `$source` stamped on Open-Meteo-sourced deltas, distinct from AccuWeather. */
  public readonly sourceRef = 'open-meteo';
  public readonly maxObservationAgeMs = 60 * 60 * 1000;
  /** Forecast horizon this provider declares; read by the v2 adapter to size its result arrays. */
  public readonly forecastCapabilities = { hourlyHours: 48, dailyDays: 7 } as const;

  private readonly logger: Logger;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  /** Cumulative attempted-fetch count, for the status banner. */
  private readonly requests = new RequestCounter();
  private readonly signal: AbortSignal | undefined;
  private readonly observationCache: CoalescingTtlCache<OpenMeteoCurrentResponse>;
  private readonly hourlyCache: CoalescingTtlCache<OpenMeteoForecastResponse>;
  private readonly dailyCache: CoalescingTtlCache<OpenMeteoForecastResponse>;

  constructor(logger: Logger = () => {}, options?: OpenMeteoOptions) {
    this.logger = logger;
    this.baseUrl = normalizeBaseUrl(options?.baseUrl, DEFAULT_BASE_URL);
    this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.signal = options?.signal;
    this.observationCache = new CoalescingTtlCache(
      FORECAST_CACHE.OBSERVATION_TTL_MS,
      FORECAST_CACHE.OBSERVATION_TTL_MS,
      this.logger
    );
    this.hourlyCache = new CoalescingTtlCache(
      FORECAST_CACHE.HOURLY_TTL_MS,
      FORECAST_CACHE.HOURLY_TTL_MS,
      this.logger
    );
    this.dailyCache = new CoalescingTtlCache(
      FORECAST_CACHE.DAILY_TTL_MS,
      FORECAST_CACHE.DAILY_TTL_MS,
      this.logger
    );

    this.logger('info', 'OpenMeteoService initialized', { baseUrl: this.baseUrl });
  }

  public async fetchCurrentWeather(location: GeoLocation): Promise<WeatherData> {
    assertValidCoordinates(location, 'Open-Meteo request');
    // A mapping failure is logged by the WeatherService update that called
    // this, as on the Met.no path, so only the fetch is wrapped here.
    const response = await this.logFailure('weather', location, () =>
      this.fetchResponse<OpenMeteoCurrentResponse>(this.buildUrl(location))
    );
    const weatherData = mapOpenMeteoCurrentToWeatherData(response);
    this.logger('info', 'Open-Meteo weather retrieved', {
      location: `${location.latitude},${location.longitude}`,
      temperature: weatherData.temperature,
      windSpeed: weatherData.windSpeed,
    });
    return weatherData;
  }

  /** Fetch a single current observation at `location` in the SK v2 WeatherData shape. */
  public async getObservation(location: GeoLocation): Promise<SKWeatherData> {
    assertValidCoordinates(location, 'Open-Meteo observation');
    return this.logFailure('observation', location, async () => {
      const response = await this.observationCache.get(toCoordKey(location), () =>
        this.fetchResponse<OpenMeteoCurrentResponse>(this.buildUrl(location))
      );
      return mapOpenMeteoCurrentToObservation(response);
    });
  }

  /** Fetch hourly (point) forecasts for the next 48 hours in ascending order. */
  public async getHourlyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
    assertValidCoordinates(location, 'Open-Meteo hourly forecast');
    return this.logFailure('hourly forecast', location, async () => {
      const url = this.buildForecastUrl(location, {
        hourly: HOURLY_PARAMS,
        forecastDays: HOURLY_FORECAST_DAYS,
      });
      const response = await this.hourlyCache.get(toCoordKey(location), () =>
        this.fetchResponse<OpenMeteoForecastResponse>(url)
      );
      return mapOpenMeteoHourlyToForecasts(response);
    });
  }

  /** Fetch daily forecasts for the next 7 days in ascending order. */
  public async getDailyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
    assertValidCoordinates(location, 'Open-Meteo daily forecast');
    return this.logFailure('daily forecast', location, async () => {
      const url = this.buildForecastUrl(location, {
        daily: DAILY_PARAMS,
        forecastDays: DAILY_FORECAST_DAYS,
      });
      const response = await this.dailyCache.get(toCoordKey(location), () =>
        this.fetchResponse<OpenMeteoForecastResponse>(url)
      );
      return mapOpenMeteoDailyToForecasts(response);
    });
  }

  /** Run one public fetch, logging a failure other than an abort before rethrowing it. */
  private async logFailure<T>(
    what: string,
    location: GeoLocation,
    run: () => Promise<T>
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!isAbortError(error)) {
        this.logger('error', `Failed to fetch Open-Meteo ${what}`, {
          location: `${location.latitude},${location.longitude}`,
          error: toErrorMessage(error),
        });
      }
      throw error;
    }
  }

  /**
   * Build the shared base URL for all Open-Meteo requests: lat/lon, m/s wind
   * units, and GMT timezone. Callers append block-specific params on top.
   */
  private buildBaseUrl(location: GeoLocation): URL {
    const url = setCoordParams(new URL(`${this.baseUrl}${FORECAST_ENDPOINT}`), location);
    url.searchParams.set('wind_speed_unit', 'ms');
    url.searchParams.set('timezone', 'GMT');
    return url;
  }

  /**
   * Build the current-block request URL, plus the 15-minutely `precipitation`
   * companion series the past-hour accumulation is summed from.
   */
  private buildUrl(location: GeoLocation): URL {
    const url = this.buildBaseUrl(location);
    url.searchParams.set('current', CURRENT_PARAMS);
    url.searchParams.set('minutely_15', CURRENT_COMPANION_MINUTELY_PARAMS);
    url.searchParams.set('past_minutely_15', String(CURRENT_COMPANION_PAST_STEPS));
    url.searchParams.set('forecast_minutely_15', String(CURRENT_COMPANION_FORECAST_STEPS));
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

  /** Issue one counted upstream request. */
  private fetchResponse<T>(url: URL): Promise<T> {
    return this.requests.track(() =>
      fetchJson<T>(url, {
        timeoutMs: this.requestTimeoutMs,
        headers: { 'User-Agent': PLUGIN.USER_AGENT },
        signal: this.signal,
      })
    );
  }

  /** Cumulative request count, for the status banner. */
  public getRequestCount(): number {
    return this.requests.value;
  }

  /** Keyless: Open-Meteo has no per-key daily cap, so there is no rolling window to report. */
  public getRequestCountLast24h(): number {
    return 0;
  }

  public isCurrentWeatherFetchBlocked(): boolean {
    return false;
  }
}
