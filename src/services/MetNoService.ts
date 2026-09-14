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

import type { WeatherData as SKWeatherData } from '@signalk/server-api';
import { PLUGIN } from '../constants/index.js';
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
 * Decimal places for the memo key, deliberately coarser than the four decimals
 * the REQUEST uses. Four decimals is about 11 m, so a vessel underway produced
 * a fresh key on every fetch and never hit the memo; two decimals is about
 * 1.1 km, comfortably inside a Met.no model grid cell, so a moving vessel keeps
 * reusing one document instead of refetching it for every metre travelled.
 */
const MEMO_KEY_DECIMALS = 2;

/**
 * The document last received for a memo key, with its cache validators.
 *
 * Retained separately from the TTL memo because the memo PRUNES an entry the
 * moment it expires, which is exactly the moment a revalidation needs the old
 * body to fall back on. Bounded by `MAX_RETAINED_DOCUMENTS`.
 */
interface DocumentCacheMeta {
  readonly document: MetNoLocationforecastResponse;
  readonly lastModified: string | undefined;
  readonly expiresMs: number | undefined;
}

/**
 * Retained-document cap. The plugin fetches for one vessel position, and the
 * v2 adapter caps its own concurrency at 4, so this is generous; the bound
 * exists so a consumer polling many positions cannot grow the map without end.
 */
const MAX_RETAINED_DOCUMENTS = 16;

export interface MetNoOptions {
  /** Override the Met.no host for tests or a self-hosted proxy. */
  readonly baseUrl?: string;
  /** Override the per-request timeout in milliseconds. */
  readonly requestTimeoutMs?: number;
  readonly signal?: AbortSignal | undefined;
}

export class MetNoService implements ForecastCapableProvider {
  /** Provider name for logs and the v2 registration label. */
  public readonly name = 'Met.no';
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
  private readonly documentCache: CoalescingTtlCache<MetNoLocationforecastResponse>;
  /** Retained documents and their cache validators, capped by `retainDocument`. */
  private readonly documentMeta = new Map<string, DocumentCacheMeta>();
  private readonly signal: AbortSignal | undefined;

  constructor(logger: Logger = () => {}, options?: MetNoOptions) {
    this.logger = logger;
    this.baseUrl = normalizeBaseUrl(options?.baseUrl, DEFAULT_BASE_URL);
    this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.signal = options?.signal;
    this.documentCache = new CoalescingTtlCache(
      DOCUMENT_MEMO_TTL_MS,
      DOCUMENT_MEMO_TTL_MS,
      this.logger
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
    const key = toCoordKey(location, MEMO_KEY_DECIMALS);
    try {
      return await this.documentCache.get(key, () => this.refreshDocument(key, location));
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
    location: GeoLocation
  ): Promise<MetNoLocationforecastResponse> {
    const meta = this.documentMeta.get(key);
    const held = meta?.document;

    if (held !== undefined && meta?.expiresMs !== undefined && meta.expiresMs > Date.now()) {
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
          ...(held !== undefined &&
            meta?.lastModified !== undefined && { ifModifiedSince: meta.lastModified }),
        }
      );
      // `held` is defined whenever a validator was sent, which is the only way
      // a 304 can arrive, so the retained document always has a body to keep.
      const document = result.body ?? (held as MetNoLocationforecastResponse);
      this.retainDocument(key, {
        document,
        lastModified: result.lastModified,
        expiresMs: result.expiresMs,
      });
      if (result.body === null) {
        this.logger('debug', 'Met.no document unchanged (304)', { key });
      }
      return document;
    } catch (error) {
      if (isAbortError(error)) this.requestCount--;
      throw error;
    }
  }

  /**
   * Store the latest document for a key, evicting the oldest retained entry
   * once the map is over its cap. Map iteration order is insertion order, and
   * re-setting an existing key does not move it, so deleting the first key
   * evicts the least recently ADDED entry.
   * @private
   */
  private retainDocument(key: string, meta: DocumentCacheMeta): void {
    this.documentMeta.delete(key);
    this.documentMeta.set(key, meta);
    while (this.documentMeta.size > MAX_RETAINED_DOCUMENTS) {
      const oldest = this.documentMeta.keys().next();
      if (oldest.done === true) break;
      this.documentMeta.delete(oldest.value);
    }
  }

  /**
   * Build the Locationforecast /complete request URL. Coordinates use
   * toFixed(4): at most 4 decimals, which is the hard 403 trigger in the Met.no
   * terms of service. The memo key is rounded further; see MEMO_KEY_DECIMALS.
   */
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
    return { size: this.documentCache.size() };
  }

  public isCurrentWeatherFetchBlocked(): boolean {
    return false;
  }
}
