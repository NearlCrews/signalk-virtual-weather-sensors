/**
 * Region-aware severe-weather warnings for the v2 Weather API `getWarnings`.
 *
 * There is no single free global alerts feed, so warnings are sourced by
 * region: NWS CAP for US waters (keyless, requires an identifying User-Agent),
 * and Met.no MetAlerts for Norwegian waters (keyless, same contact User-Agent
 * requirement). Unsupported regions and upstream failures are reported
 * explicitly so consumers can distinguish unavailable warning coverage from a
 * successful lookup that found no active warnings.
 */

import type { WeatherWarning } from '@signalk/server-api';
import { PLUGIN } from '../constants/index.js';
import {
  type MetAlertsResponse,
  mapMetAlertsToWarnings,
  mapNwsAlertsToWarnings,
  type NwsAlertsResponse,
} from '../mappers/WarningsMapper.js';
import type { GeoLocation, Logger } from '../types/index.js';
import { isWithinBounds, toCoordKey, toErrorMessage } from '../utils/conversions.js';
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchJson } from '../utils/http.js';

/**
 * Loose bounding box for US NWS coverage (CONUS, Alaska, Hawaii, the
 * territories, and their offshore marine zones). Deliberately generous: NWS
 * returns no features for a point it does not cover, and the fetch is
 * best-effort, so over-inclusion only costs an occasional empty lookup.
 */
const US_BOX = { latMin: 15, latMax: 72, lonMin: -180, lonMax: -64 } as const;

/**
 * Loose bounding box for Met.no MetAlerts coverage (Norway and Norwegian waters:
 * the mainland, the Norwegian Sea, the North Sea Norwegian sector, the Barents
 * Sea, Svalbard, and Jan Mayen). Deliberately generous, like US_BOX: MetAlerts
 * returns no features for a position it does not cover, and the fetch is
 * best-effort, so over-inclusion only costs an occasional empty lookup.
 */
const NORDIC_BOX = { latMin: 54, latMax: 82, lonMin: -12, lonMax: 37 } as const;

export interface WarningsOptions {
  readonly requestTimeoutMs?: number;
}

export class WarningsService {
  private readonly logger: Logger;
  private readonly requestTimeoutMs: number;

  constructor(logger: Logger = () => {}, options?: WarningsOptions) {
    this.logger = logger;
    this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** Warnings for a position, dispatched by region. */
  public async getWarnings(location: GeoLocation): Promise<WeatherWarning[]> {
    if (this.inUsCoverage(location)) {
      return this.fetchNws(location);
    }
    if (this.inNordicCoverage(location)) {
      return this.fetchMetAlerts(location);
    }
    throw new Error(
      'Not supported! Weather warnings are currently available only in NWS and MET Norway coverage areas.'
    );
  }

  private inBox(
    location: GeoLocation,
    box: { latMin: number; latMax: number; lonMin: number; lonMax: number }
  ): boolean {
    return (
      isWithinBounds(location.latitude, box.latMin, box.latMax) &&
      isWithinBounds(location.longitude, box.lonMin, box.lonMax)
    );
  }

  private inUsCoverage(location: GeoLocation): boolean {
    return this.inBox(location, US_BOX);
  }

  private inNordicCoverage(location: GeoLocation): boolean {
    return this.inBox(location, NORDIC_BOX);
  }

  /** Fetch and map NWS active alerts. */
  private async fetchNws(location: GeoLocation): Promise<WeatherWarning[]> {
    const point = toCoordKey(location);
    const url = `https://api.weather.gov/alerts/active?point=${point}`;
    try {
      const response = await fetchJson<NwsAlertsResponse>(url, {
        timeoutMs: this.requestTimeoutMs,
        headers: { 'User-Agent': PLUGIN.CONTACT_USER_AGENT },
      });
      return mapNwsAlertsToWarnings(response);
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger('warn', 'NWS warnings fetch failed', {
        point,
        error: message,
      });
      throw new Error(`NWS warnings unavailable: ${message}`, { cause: error });
    }
  }

  /** Fetch and map Met.no MetAlerts active alerts. */
  private async fetchMetAlerts(location: GeoLocation): Promise<WeatherWarning[]> {
    const lat = location.latitude.toFixed(4);
    const lon = location.longitude.toFixed(4);
    const url = `https://api.met.no/weatherapi/metalerts/2.0/current.json?lat=${lat}&lon=${lon}&lang=en`;
    try {
      const response = await fetchJson<MetAlertsResponse>(url, {
        timeoutMs: this.requestTimeoutMs,
        headers: { 'User-Agent': PLUGIN.CONTACT_USER_AGENT },
      });
      return mapMetAlertsToWarnings(response);
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger('warn', 'MetAlerts warnings fetch failed', {
        point: `${lat},${lon}`,
        error: message,
      });
      throw new Error(`MET Norway warnings unavailable: ${message}`, { cause: error });
    }
  }
}
