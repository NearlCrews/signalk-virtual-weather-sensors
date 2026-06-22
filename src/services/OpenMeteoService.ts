/**
 * Open-Meteo current-conditions provider.
 *
 * Implements `CurrentWeatherProvider` against the keyless, global Open-Meteo
 * forecast API. No API key, no location-key lookup (Open-Meteo takes lat/lon
 * directly), and no per-key daily cap, so the quota accessors report zero. The
 * base URL is configurable so a commercial user can point at a self-hosted or
 * paid Open-Meteo instance (the free hosted service is non-commercial).
 */

import { PLUGIN } from '../constants/index.js';
import { mapOpenMeteoCurrentToWeatherData } from '../mappers/OpenMeteoMapper.js';
import type { CurrentWeatherProvider } from '../providers/WeatherProvider.js';
import type { GeoLocation, Logger, OpenMeteoCurrentResponse, WeatherData } from '../types/index.js';
import { toErrorMessage } from '../utils/conversions.js';
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

export interface OpenMeteoOptions {
  /** Override the Open-Meteo host (self-hosted or paid instance). */
  readonly baseUrl?: string;
  /** Override the per-request timeout in milliseconds. */
  readonly requestTimeoutMs?: number;
}

export class OpenMeteoService implements CurrentWeatherProvider {
  /** Provider name for the v2 registration and logs. */
  public readonly name = 'Open-Meteo';
  /** `$source` stamped on Open-Meteo-sourced deltas, distinct from AccuWeather. */
  public readonly sourceRef = 'open-meteo';

  private readonly logger: Logger;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  /** Cumulative attempted-fetch count (incremented before each request), for the status banner. */
  private requestCount = 0;

  constructor(logger: Logger = () => {}, options?: OpenMeteoOptions) {
    this.logger = logger;
    this.baseUrl = normalizeBaseUrl(options?.baseUrl, DEFAULT_BASE_URL);
    this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    this.logger('info', 'OpenMeteoService initialized', { baseUrl: this.baseUrl });
  }

  public async fetchCurrentWeather(location: GeoLocation): Promise<WeatherData> {
    assertValidCoordinates(location, 'Open-Meteo request');
    const url = this.buildUrl(location);

    try {
      this.requestCount++;
      const response = await fetchJson<OpenMeteoCurrentResponse>(url, {
        timeoutMs: this.requestTimeoutMs,
        headers: { 'User-Agent': `${PLUGIN.NAME}/${PLUGIN.VERSION}` },
      });
      const weatherData = mapOpenMeteoCurrentToWeatherData(response);

      this.logger('info', 'Open-Meteo weather retrieved', {
        location: `${location.latitude},${location.longitude}`,
        temperature: weatherData.temperature,
        windSpeed: weatherData.windSpeed,
      });

      return weatherData;
    } catch (error) {
      this.logger('error', 'Failed to fetch Open-Meteo weather', {
        location: `${location.latitude},${location.longitude}`,
        error: toErrorMessage(error),
      });
      throw error;
    }
  }

  /** Build the forecast request URL with the current-block params and m/s wind units. */
  private buildUrl(location: GeoLocation): URL {
    const url = new URL(`${this.baseUrl}${FORECAST_ENDPOINT}`);
    url.searchParams.set('latitude', String(location.latitude));
    url.searchParams.set('longitude', String(location.longitude));
    url.searchParams.set('current', CURRENT_PARAMS);
    url.searchParams.set('wind_speed_unit', 'ms');
    url.searchParams.set('timezone', 'GMT');
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
}
