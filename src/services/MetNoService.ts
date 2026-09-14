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
 * Coordinates are formatted at `COORD_PARAM_DECIMALS` places because Met.no
 * returns a hard 403 on five or more decimal places.
 */

import type { WeatherData as SKWeatherData } from '@signalk/server-api';
import { COORD_CACHE_CELL_DECIMALS, PLUGIN } from '../constants/index.js';
import { WEATHER_PROVIDER_SHORT_LABELS } from '../constants/notifications-shared.js';
import {
  mapMetNoToDailyForecasts,
  mapMetNoToHourlyForecasts,
  mapMetNoToObservation,
} from '../mappers/MetNoForecastMapper.js';
import { mapMetNoCurrentToWeatherData } from '../mappers/MetNoMapper.js';
import type { ForecastCapableProvider } from '../providers/WeatherProvider.js';
import type {
  GeoLocation,
  Logger,
  MetNoLocationforecastResponse,
  WeatherData,
} from '../types/index.js';
import { isAbortError, toCoordKey, toErrorMessage } from '../utils/conversions.js';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchJsonConditional,
  normalizeBaseUrl,
  setCoordParams,
} from '../utils/http.js';
import { assertValidCoordinates } from '../utils/validation.js';
import { CoalescingTtlCache } from './cache/CoalescingTtlCache.js';

/** Default Met.no host. */
const DEFAULT_BASE_URL = 'https://api.met.no';

/** Locationforecast 2.0 complete endpoint path. */
const COMPLETE_ENDPOINT = '/weatherapi/locationforecast/2.0/complete';

/** Declared v2 forecast horizon. Hourly steps run to about +53 h, the daily horizon to about 10 days. */
const HOURLY_FORECAST_HOURS = 48;
const DAILY_FORECAST_DAYS = 9;

/**
 * Met.no refreshes the model on a multi-hour cadence, so a 10-minute memo avoids
 * refetching the identical document across the three v2 methods. The memo is the
 * floor, not the whole caching story: the response's own `Expires` is honored
 * above it (no request at all until it passes), and a request past `Expires`
 * carries `If-Modified-Since` so an unchanged model answers 304 with no body.
 * Both are what the Met.no terms of service ask a client to do.
 */
const DOCUMENT_MEMO_TTL_MS = 10 * 60 * 1000;

/**
 * How long an expired document is retained so the next fetch can revalidate
 * against it. The memo TTL is ten minutes but the plugin's own fetch cadence
 * runs from five minutes to a day, so a document dropped at its TTL would leave
 * nothing to send `If-Modified-Since` against and every fetch would pay for a
 * full body. A day is past any cadence the schema allows.
 */
const DOCUMENT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Retained-document cap. The plugin fetches for one vessel position, and the
 * v2 adapter caps its own concurrency at 4, so this is generous; the bound
 * exists so a consumer polling many positions cannot grow the cache without
 * end, and a /complete document is far larger than the cache's default cap
 * assumes.
 */
const MAX_RETAINED_DOCUMENTS = 16;

/** A received document with the validators that let the next fetch revalidate it. */
interface DocumentCacheMeta {
  readonly document: MetNoLocationforecastResponse;
  readonly lastModified: string | undefined;
  readonly expiresMs: number | undefined;
}

export interface MetNoOptions {
  /** Override the Met.no host for tests or a self-hosted proxy. */
  readonly baseUrl?: string;
  /** Override the per-request timeout in milliseconds. */
  readonly requestTimeoutMs?: number;
  readonly signal?: AbortSignal | undefined;
}

export class MetNoService implements ForecastCapableProvider {
  /** Provider name for logs and the v2 registration label. */
  public readonly name = WEATHER_PROVIDER_SHORT_LABELS['met-no'];
  /** `$source` stamped on Met.no-sourced deltas, distinct from Open-Meteo and AccuWeather. */
  public readonly sourceRef = 'met-no';
  public readonly maxObservationAgeMs = 3 * 60 * 60 * 1000;
  /** Forecast horizon this provider declares; read by the v2 adapter to size its result arrays. */
  public readonly forecastCapabilities = {
    hourlyHours: HOURLY_FORECAST_HOURS,
    dailyDays: DAILY_FORECAST_DAYS,
  } as const;

  private readonly logger: Logger;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  /** Cumulative attempted-fetch count (incremented before each request), for the status banner. */
  private requestCount = 0;
  private readonly documentCache: CoalescingTtlCache<DocumentCacheMeta>;
  private readonly signal: AbortSignal | undefined;

  constructor(logger: Logger = () => {}, options?: MetNoOptions) {
    this.logger = logger;
    this.baseUrl = normalizeBaseUrl(options?.baseUrl, DEFAULT_BASE_URL);
    this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.signal = options?.signal;
    this.documentCache = new CoalescingTtlCache(
      DOCUMENT_MEMO_TTL_MS,
      DOCUMENT_MEMO_TTL_MS,
      this.logger,
      Date.now(),
      { staleRetentionMs: DOCUMENT_RETENTION_MS, maxEntries: MAX_RETAINED_DOCUMENTS }
    );

    this.logger('info', 'MetNoService initialized', { baseUrl: this.baseUrl });
  }

  public async fetchCurrentWeather(location: GeoLocation): Promise<WeatherData> {
    try {
      const response = await this.fetchForecastDocument(location, 'Met.no request');
      const weatherData = mapMetNoCurrentToWeatherData(response);

      this.logger('info', 'Met.no weather retrieved', {
        location: `${location.latitude},${location.longitude}`,
        temperature: weatherData.temperature,
        windSpeed: weatherData.windSpeed,
      });

      return weatherData;
    } catch (error) {
      if (isAbortError(error)) throw error;
      this.logger('error', 'Failed to fetch Met.no weather', {
        location: `${location.latitude},${location.longitude}`,
        error: toErrorMessage(error),
      });
      throw error;
    }
  }

  public async getObservation(location: GeoLocation): Promise<SKWeatherData> {
    return mapMetNoToObservation(await this.fetchForecastDocument(location, 'Met.no observation'));
  }

  public async getHourlyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
    const doc = await this.fetchForecastDocument(location, 'Met.no hourly forecast');
    return mapMetNoToHourlyForecasts(doc).slice(0, HOURLY_FORECAST_HOURS);
  }

  public async getDailyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
    const doc = await this.fetchForecastDocument(location, 'Met.no daily forecast');
    return mapMetNoToDailyForecasts(doc).slice(0, DAILY_FORECAST_DAYS);
  }

  /**
   * Fetch the /complete document once and memoize it. The three v2 methods all
   * derive from the same document, so a memo keyed by coarsely rounded position
   * collapses their fetches into one upstream request. Beyond the memo TTL the
   * document's own `Expires` still suppresses the request, and past that the
   * request is conditional, so an unchanged model costs a 304 with no body.
   * Only a request that actually goes out increments the request count.
   */
  private async fetchForecastDocument(
    location: GeoLocation,
    context: string
  ): Promise<MetNoLocationforecastResponse> {
    assertValidCoordinates(location, context);
    const key = toCoordKey(location, COORD_CACHE_CELL_DECIMALS);
    try {
      const entry = await this.documentCache.get(key, (held) =>
        this.refreshDocument(key, location, held)
      );
      return entry.document;
    } catch (error) {
      if (isAbortError(error)) throw error;
      this.logger('error', 'Failed to fetch Met.no forecast', {
        location: `${location.latitude},${location.longitude}`,
        error: toErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Refresh one memo entry, doing the least work the upstream allows: reuse the
   * held document while its declared `Expires` is still in the future, then ask
   * conditionally and reuse it again on a 304. Falls through to a full body only
   * when the model has genuinely moved on, or when nothing is held to revalidate.
   * @private
   */
  private async refreshDocument(
    key: string,
    location: GeoLocation,
    held: DocumentCacheMeta | undefined
  ): Promise<DocumentCacheMeta> {
    if (held !== undefined && held.expiresMs !== undefined && held.expiresMs > Date.now()) {
      this.logger('debug', 'Met.no document still within its Expires window', { key });
      return held;
    }

    this.requestCount++;
    try {
      const result = await fetchJsonConditional<MetNoLocationforecastResponse>(
        this.buildUrl(location),
        {
          timeoutMs: this.requestTimeoutMs,
          headers: { 'User-Agent': PLUGIN.CONTACT_USER_AGENT },
          signal: this.signal,
          // Only send the validator when there is something to revalidate:
          // a 304 with nothing held would leave the caller without a document.
          ...(held?.lastModified !== undefined && { ifModifiedSince: held.lastModified }),
        }
      );
      if (result.body === null) {
        // `held` is defined whenever a validator was sent, which is the only
        // way a 304 can arrive, so there is always a body to keep.
        this.logger('debug', 'Met.no document unchanged (304)', { key });
        return {
          document: (held as DocumentCacheMeta).document,
          lastModified: result.lastModified,
          expiresMs: result.expiresMs,
        };
      }
      return {
        document: result.body,
        lastModified: result.lastModified,
        expiresMs: result.expiresMs,
      };
    } catch (error) {
      if (isAbortError(error)) this.requestCount--;
      throw error;
    }
  }

  /**
   * Build the Locationforecast /complete request URL. Coordinates carry
   * `COORD_PARAM_DECIMALS` places, at or under the five-decimal hard 403
   * trigger in the Met.no terms of service. The memo key is rounded further;
   * see `COORD_CACHE_CELL_DECIMALS`.
   */
  private buildUrl(location: GeoLocation): URL {
    return setCoordParams(new URL(`${this.baseUrl}${COMPLETE_ENDPOINT}`), location, 'lat', 'lon');
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
    return { size: this.documentCache.size() };
  }

  public isCurrentWeatherFetchBlocked(): boolean {
    return false;
  }
}
