/**
 * Met.no Locationforecast 2.0 current-conditions provider.
 *
 * Implements `CurrentWeatherProvider` against the keyless, global Met.no
 * Locationforecast API. No API key, no location-key lookup (Met.no takes
 * lat/lon directly), and no per-key daily cap, so the quota accessors return
 * zero. The base URL is configurable so the service can be tested against a
 * stub without hitting the live API.
 *
 * Met.no requires an identifying User-Agent containing a contact URL or email
 * address; the service uses the plugin package name, version, and GitHub URL.
 * Coordinates are formatted with toFixed(4) because Met.no returns a hard 403
 * on five or more decimal places.
 */

import { PLUGIN } from '../constants/index.js';
import { mapMetNoCurrentToWeatherData } from '../mappers/MetNoMapper.js';
import type { CurrentWeatherProvider } from '../providers/WeatherProvider.js';
import type {
  GeoLocation,
  Logger,
  MetNoLocationforecastResponse,
  WeatherData,
} from '../types/index.js';
import { toErrorMessage } from '../utils/conversions.js';
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchJson, normalizeBaseUrl } from '../utils/http.js';
import { assertValidCoordinates } from '../utils/validation.js';

/** Default Met.no host. */
const DEFAULT_BASE_URL = 'https://api.met.no';

/** Locationforecast 2.0 complete endpoint path. */
const COMPLETE_ENDPOINT = '/weatherapi/locationforecast/2.0/complete';

/**
 * Contact-form User-Agent required by Met.no terms of service.
 * See https://api.met.no/doc/TermsOfService
 */
const USER_AGENT = `${PLUGIN.NAME}/${PLUGIN.VERSION} (+https://github.com/NearlCrews/signalk-virtual-weather-sensors)`;

export interface MetNoOptions {
  /** Override the Met.no host for tests or a self-hosted proxy. */
  readonly baseUrl?: string;
  /** Override the per-request timeout in milliseconds. */
  readonly requestTimeoutMs?: number;
}

export class MetNoService implements CurrentWeatherProvider {
  /** Provider name for logs and the v2 registration label. */
  public readonly name = 'Met.no';
  /** `$source` stamped on Met.no-sourced deltas, distinct from Open-Meteo and AccuWeather. */
  public readonly sourceRef = 'met-no';

  private readonly logger: Logger;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  /** Cumulative attempted-fetch count (incremented before each request), for the status banner. */
  private requestCount = 0;

  constructor(logger: Logger = () => {}, options?: MetNoOptions) {
    this.logger = logger;
    this.baseUrl = normalizeBaseUrl(options?.baseUrl, DEFAULT_BASE_URL);
    this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    this.logger('info', 'MetNoService initialized', { baseUrl: this.baseUrl });
  }

  public async fetchCurrentWeather(location: GeoLocation): Promise<WeatherData> {
    assertValidCoordinates(location, 'Met.no request');
    const url = this.buildUrl(location);

    try {
      this.requestCount++;
      const response = await fetchJson<MetNoLocationforecastResponse>(url, {
        timeoutMs: this.requestTimeoutMs,
        headers: { 'User-Agent': USER_AGENT },
      });
      const weatherData = mapMetNoCurrentToWeatherData(response);

      this.logger('info', 'Met.no weather retrieved', {
        location: `${location.latitude},${location.longitude}`,
        temperature: weatherData.temperature,
        windSpeed: weatherData.windSpeed,
      });

      return weatherData;
    } catch (error) {
      this.logger('error', 'Failed to fetch Met.no weather', {
        location: `${location.latitude},${location.longitude}`,
        error: toErrorMessage(error),
      });
      throw error;
    }
  }

  /** Build the Locationforecast /complete request URL. Coordinates use toFixed(4): at most 4 decimals. */
  private buildUrl(location: GeoLocation): URL {
    const url = new URL(`${this.baseUrl}${COMPLETE_ENDPOINT}`);
    url.searchParams.set('lat', location.latitude.toFixed(4));
    url.searchParams.set('lon', location.longitude.toFixed(4));
    return url;
  }

  /** Cumulative request count, for the status banner. */
  public getRequestCount(): number {
    return this.requestCount;
  }

  /** Keyless: Met.no has no per-key daily cap, so there is no rolling window to report. */
  public getRequestCountLast24h(): number {
    return 0;
  }

  /** Met.no needs no location-key cache (it takes lat/lon directly). */
  public getCacheStats(): { size: number } {
    return { size: 0 };
  }
}
