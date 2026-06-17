/**
 * Open-Meteo Marine sea-state fetcher.
 *
 * Keyless, like the atmospheric Open-Meteo provider, but a separate host
 * (marine-api.open-meteo.com) and endpoint. Marine data is independent of the
 * chosen atmospheric provider, so this runs as its own optional layer. The base
 * URL is overridable: a self-hosted Open-Meteo server serves /v1/marine on the
 * same host as the forecast API, so the wiring passes the configured
 * openMeteoBaseUrl here when set, falling back to the public marine subdomain.
 */

import { PLUGIN } from '../constants/index.js';
import { mapOpenMeteoMarineToMarineData } from '../mappers/OpenMeteoMarineMapper.js';
import type { GeoLocation, Logger, MarineData, OpenMeteoMarineResponse } from '../types/index.js';
import { toErrorMessage } from '../utils/conversions.js';
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchJson, normalizeBaseUrl } from '../utils/http.js';
import { assertValidCoordinates } from '../utils/validation.js';

/** Default public Open-Meteo Marine host. */
const DEFAULT_BASE_URL = 'https://marine-api.open-meteo.com';
/** Marine endpoint path. */
const MARINE_ENDPOINT = '/v1/marine';
/** Current-block variables requested. */
const CURRENT_PARAMS = [
  'wave_height',
  'wave_direction',
  'wave_period',
  'wind_wave_height',
  'swell_wave_height',
  'swell_wave_direction',
  'swell_wave_period',
  'ocean_current_velocity',
  'ocean_current_direction',
  'sea_surface_temperature',
].join(',');

export interface OpenMeteoMarineOptions {
  /** Override the Open-Meteo Marine host (self-hosted or paid instance). */
  readonly baseUrl?: string;
  /** Override the per-request timeout in milliseconds. */
  readonly requestTimeoutMs?: number;
}

export class OpenMeteoMarineService {
  private readonly logger: Logger;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private requestCount = 0;

  constructor(logger: Logger = () => {}, options?: OpenMeteoMarineOptions) {
    this.logger = logger;
    this.baseUrl = normalizeBaseUrl(options?.baseUrl, DEFAULT_BASE_URL);
    this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.logger('info', 'OpenMeteoMarineService initialized', { baseUrl: this.baseUrl });
  }

  public async fetchMarine(location: GeoLocation): Promise<MarineData> {
    assertValidCoordinates(location, 'Open-Meteo marine request');
    const url = this.buildUrl(location);

    try {
      this.requestCount++;
      const response = await fetchJson<OpenMeteoMarineResponse>(url, {
        timeoutMs: this.requestTimeoutMs,
        headers: { 'User-Agent': `${PLUGIN.NAME}/${PLUGIN.VERSION}` },
      });
      const marine = mapOpenMeteoMarineToMarineData(response);
      this.logger('debug', 'Open-Meteo marine retrieved', {
        location: `${location.latitude},${location.longitude}`,
        significantWaveHeight: marine.significantWaveHeight,
      });
      return marine;
    } catch (error) {
      this.logger('error', 'Failed to fetch Open-Meteo marine data', {
        location: `${location.latitude},${location.longitude}`,
        error: toErrorMessage(error),
      });
      throw error;
    }
  }

  private buildUrl(location: GeoLocation): URL {
    const url = new URL(`${this.baseUrl}${MARINE_ENDPOINT}`);
    url.searchParams.set('latitude', String(location.latitude));
    url.searchParams.set('longitude', String(location.longitude));
    url.searchParams.set('current', CURRENT_PARAMS);
    url.searchParams.set('timezone', 'GMT');
    return url;
  }

  /** Cumulative marine request count, for diagnostics. */
  public getRequestCount(): number {
    return this.requestCount;
  }
}
