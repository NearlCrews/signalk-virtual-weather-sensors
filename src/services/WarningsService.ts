/**
 * Region-aware severe-weather warnings for the v2 Weather API `getWarnings`.
 *
 * There is no single free global alerts feed, so warnings are sourced by
 * region: NWS CAP for US waters today (keyless, requires an identifying
 * User-Agent). Points outside a covered region return an empty list, which is
 * honest rather than fabricating an alert. Every fetch is best-effort: a feed
 * outage or an edge point the feed does not cover yields [] (and a log line),
 * never a thrown error to the consumer.
 *
 * Met.no MetAlerts for Nordic waters is a planned second source; the region
 * dispatch below is the seam it slots into.
 */

import type { WeatherWarning } from '@signalk/server-api';
import { PLUGIN } from '../constants/index.js';
import { mapNwsAlertsToWarnings, type NwsAlertsResponse } from '../mappers/WarningsMapper.js';
import type { GeoLocation, Logger } from '../types/index.js';
import { toErrorMessage } from '../utils/conversions.js';
import { fetchJson } from '../utils/http.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** NWS requires an identifying User-Agent with contact info, or it returns 403. */
const NWS_USER_AGENT = `${PLUGIN.NAME}/${PLUGIN.VERSION} (+https://github.com/NearlCrews/signalk-virtual-weather-sensors)`;

/**
 * Loose bounding box for US NWS coverage (CONUS, Alaska, Hawaii, the
 * territories, and their offshore marine zones). Deliberately generous: NWS
 * returns no features for a point it does not cover, and the fetch is
 * best-effort, so over-inclusion only costs an occasional empty lookup.
 */
const US_BOX = { latMin: 15, latMax: 72, lonMin: -180, lonMax: -64 } as const;

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

  /** Fetch and map NWS active alerts, best-effort (empty on any failure). */
  private async fetchNws(location: GeoLocation): Promise<WeatherWarning[]> {
    const point = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
    const url = `https://api.weather.gov/alerts/active?point=${point}`;
    try {
      const response = await fetchJson<NwsAlertsResponse>(url, {
        timeoutMs: this.requestTimeoutMs,
        headers: { 'User-Agent': NWS_USER_AGENT },
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
}
