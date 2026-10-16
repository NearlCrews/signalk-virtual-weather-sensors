/**
 * Region-aware severe-weather warnings for the v2 Weather API `getWarnings`.
 *
 * There is no single free global alerts feed, so warnings are sourced by
 * region: NWS CAP for US waters (keyless, requires an identifying User-Agent),
 * and Met.no MetAlerts for Norwegian waters (keyless, same contact User-Agent
 * requirement). A position outside both coverage areas resolves to an empty
 * list: the server turns a provider throw into an HTTP 400 for the consumer,
 * which would put every dashboard outside the US and Norway into an error
 * state for a limitation that is documented and expected. An upstream failure
 * inside a covered region still throws, so a consumer there can tell
 * "unavailable" from "none active".
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
import { isAbortError, isWithinBounds, toCoordKey, toErrorMessage } from '../utils/conversions.js';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchJson,
  HttpStatusError,
  setCoordParams,
} from '../utils/http.js';

interface CoverageBox {
  readonly latMin: number;
  readonly latMax: number;
  readonly lonMin: number;
  readonly lonMax: number;
}

/**
 * Loose bounding boxes for US NWS coverage: CONUS, Alaska, Hawaii, Puerto Rico,
 * and the Virgin Islands; Guam and the Northern Marianas; the Aleutians west of
 * the antimeridian; and American Samoa. The first is deliberately generous, and
 * NWS answers 400 "out of bounds" for a point inside it that it does not cover
 * (British Columbia, Mexico, Bermuda), which `fetchNws` treats as "no
 * warnings". The Pacific boxes stay tight, so a vessel off Japan or Kamchatka
 * makes no NWS request at all.
 */
const US_BOXES: readonly CoverageBox[] = [
  { latMin: 15, latMax: 72, lonMin: -180, lonMax: -64 },
  { latMin: 12, latMax: 21, lonMin: 144, lonMax: 147 },
  { latMin: 50, latMax: 56, lonMin: 170, lonMax: 180 },
  { latMin: -16, latMax: -10, lonMin: -172, lonMax: -167 },
];

/**
 * NWS answer for a point outside its coverage: status 400 with the detail
 * `Parameter "point" is invalid: out of bounds`. Both must match, so a 400 for
 * any other reason (a malformed request) still reports a failure rather than a
 * false all-clear.
 */
const NWS_OUT_OF_BOUNDS = { status: 400, detail: 'out of bounds' } as const;

/**
 * Loose bounding box for Met.no MetAlerts coverage (Norway and Norwegian waters:
 * the mainland, the Norwegian Sea, the North Sea Norwegian sector, the Barents
 * Sea, Svalbard, and Jan Mayen). Deliberately generous, like US_BOXES: MetAlerts
 * returns no features for a position it does not cover, and the fetch is
 * best-effort, so over-inclusion only costs an occasional empty lookup.
 */
const NORDIC_BOX: CoverageBox = { latMin: 54, latMax: 82, lonMin: -12, lonMax: 37 };

/** Met.no MetAlerts active-alerts endpoint; position and language are added per request. */
const METALERTS_URL = 'https://api.met.no/weatherapi/metalerts/2.0/current.json';

export interface WarningsOptions {
  readonly requestTimeoutMs?: number;
  readonly signal?: AbortSignal | undefined;
}

export class WarningsService {
  private readonly logger: Logger;
  private readonly requestTimeoutMs: number;
  private readonly signal: AbortSignal | undefined;

  constructor(logger: Logger = () => {}, options?: WarningsOptions) {
    this.logger = logger;
    this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.signal = options?.signal;
  }

  /**
   * Warnings for a position, dispatched by region. Outside NWS and MET Norway
   * coverage the result is an empty list, not an error.
   */
  public async getWarnings(location: GeoLocation): Promise<WeatherWarning[]> {
    if (this.inUsCoverage(location)) {
      return this.fetchNws(location);
    }
    if (this.inNordicCoverage(location)) {
      return this.fetchMetAlerts(location);
    }
    this.logger('debug', 'No warnings feed covers this position, returning none', {
      point: toCoordKey(location),
    });
    return [];
  }

  private inBox(location: GeoLocation, box: CoverageBox): boolean {
    return (
      isWithinBounds(location.latitude, box.latMin, box.latMax) &&
      isWithinBounds(location.longitude, box.lonMin, box.lonMax)
    );
  }

  private inUsCoverage(location: GeoLocation): boolean {
    return US_BOXES.some((box) => this.inBox(location, box));
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
        signal: this.signal,
      });
      return mapNwsAlertsToWarnings(response);
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (
        error instanceof HttpStatusError &&
        error.status === NWS_OUT_OF_BOUNDS.status &&
        error.body.includes(NWS_OUT_OF_BOUNDS.detail)
      ) {
        this.logger('debug', 'Position is outside NWS coverage, returning no warnings', { point });
        return [];
      }
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
    const url = setCoordParams(new URL(METALERTS_URL), location, 'lat', 'lon');
    url.searchParams.set('lang', 'en');
    try {
      const response = await fetchJson<MetAlertsResponse>(url, {
        timeoutMs: this.requestTimeoutMs,
        headers: { 'User-Agent': PLUGIN.CONTACT_USER_AGENT },
        signal: this.signal,
      });
      return mapMetAlertsToWarnings(response);
    } catch (error) {
      if (isAbortError(error)) throw error;
      const message = toErrorMessage(error);
      this.logger('warn', 'MetAlerts warnings fetch failed', {
        point: `${url.searchParams.get('lat')},${url.searchParams.get('lon')}`,
        error: message,
      });
      throw new Error(`MET Norway warnings unavailable: ${message}`, { cause: error });
    }
  }
}
