/**
 * Region-aware severe-weather warnings for the v2 Weather API `getWarnings`.
 *
 * There is no single free global alerts feed, so warnings are sourced by
 * region: NWS CAP for US waters (keyless, requires an identifying User-Agent),
 * and Met.no MetAlerts for Norwegian waters (keyless, same contact User-Agent
 * requirement). Points outside a covered region return an empty list, which is
 * honest rather than fabricating an alert. Every fetch is best-effort: a feed
 * outage or an edge point the feed does not cover yields [] (and a log line),
 * never a thrown error to the consumer.
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
import { toErrorMessage } from '../utils/conversions.js';
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchJson } from '../utils/http.js';

/**
 * Both NWS and Met.no require an identifying User-Agent with contact info.
 * NWS returns 403 without it; Met.no policy requires it for all API clients.
 */
const CONTACT_USER_AGENT = `${PLUGIN.NAME}/${PLUGIN.VERSION} (+https://github.com/NearlCrews/signalk-virtual-weather-sensors)`;

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

  /** Warnings for a position, dispatched by region. Empty list outside covered regions. */
  public async getWarnings(location: GeoLocation): Promise<WeatherWarning[]> {
    if (this.inUsCoverage(location)) {
      return this.fetchNws(location);
    }
    if (this.inNordicCoverage(location)) {
      return this.fetchMetAlerts(location);
    }
    return [];
  }

  private inUsCoverage(location: GeoLocation): boolean {
    const { latitude, longitude } = location;
    return (
      latitude >= US_BOX.latMin &&
      latitude <= US_BOX.latMax &&
      longitude >= US_BOX.lonMin &&
      longitude <= US_BOX.lonMax
    );
  }

  private inNordicCoverage(location: GeoLocation): boolean {
    const { latitude, longitude } = location;
    return (
      latitude >= NORDIC_BOX.latMin &&
      latitude <= NORDIC_BOX.latMax &&
      longitude >= NORDIC_BOX.lonMin &&
      longitude <= NORDIC_BOX.lonMax
    );
  }

  /** Fetch and map NWS active alerts, best-effort (empty on any failure). */
  private async fetchNws(location: GeoLocation): Promise<WeatherWarning[]> {
    const point = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
    const url = `https://api.weather.gov/alerts/active?point=${point}`;
    try {
      const response = await fetchJson<NwsAlertsResponse>(url, {
        timeoutMs: this.requestTimeoutMs,
        headers: { 'User-Agent': CONTACT_USER_AGENT },
      });
      return mapNwsAlertsToWarnings(response);
    } catch (error) {
      this.logger('warn', 'NWS warnings fetch failed; returning no warnings', {
        point,
        error: toErrorMessage(error),
      });
      return [];
    }
  }

  /** Fetch and map Met.no MetAlerts active alerts, best-effort (empty on any failure). */
  private async fetchMetAlerts(location: GeoLocation): Promise<WeatherWarning[]> {
    const lat = location.latitude.toFixed(4);
    const lon = location.longitude.toFixed(4);
    const url = `https://api.met.no/weatherapi/metalerts/2.0/current.json?lat=${lat}&lon=${lon}&lang=en`;
    try {
      const response = await fetchJson<MetAlertsResponse>(url, {
        timeoutMs: this.requestTimeoutMs,
        headers: { 'User-Agent': CONTACT_USER_AGENT },
      });
      return mapMetAlertsToWarnings(response);
    } catch (error) {
      this.logger('warn', 'MetAlerts warnings fetch failed; returning no warnings', {
        point: `${lat},${lon}`,
        error: toErrorMessage(error),
      });
      return [];
    }
  }
}
