/**
 * Pure mappers from regional alert feeds to the Signal K v2 `WeatherWarning`
 * shape ({ startTime, endTime, details, source, type }). No I/O: fetching lives
 * in WarningsService, so these stay trivially unit-testable. Warnings are
 * returned in ascending start-time order, as the v2 API expects.
 */

import type { WeatherWarning } from '@signalk/server-api';

/** Minimal shape of the NWS `/alerts/active` GeoJSON response (only mapped fields). */
export interface NwsAlertsResponse {
  readonly features?: ReadonlyArray<{
    readonly properties?: {
      readonly event?: string | null;
      readonly onset?: string | null;
      readonly effective?: string | null;
      readonly ends?: string | null;
      readonly expires?: string | null;
      readonly headline?: string | null;
      readonly description?: string | null;
      readonly senderName?: string | null;
    };
  }>;
}

/** Coerce an optional string-ish value to a trimmed string, or '' when absent. */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Sort warnings by ascending start time (ISO timestamps sort lexically). */
function byStartAscending(a: WeatherWarning, b: WeatherWarning): number {
  return a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0;
}

/**
 * Map an NWS active-alerts response to WeatherWarning[]. The start time prefers
 * `onset` then `effective`; the end time prefers `ends` then `expires`; details
 * prefer the headline, falling back to the description. Features with no event
 * type or no start time are dropped: a warning with no `type` is not actionable,
 * and an empty start time is not a usable timestamp and would sort to the front.
 * NWS alerts reliably carry both, so this only drops malformed entries.
 */
export function mapNwsAlertsToWarnings(response: NwsAlertsResponse): WeatherWarning[] {
  const features = response.features ?? [];
  const warnings = features
    .map((feature) => {
      const p = feature.properties ?? {};
      const details = str(p.headline) || str(p.description);
      return {
        startTime: str(p.onset) || str(p.effective),
        endTime: str(p.ends) || str(p.expires),
        details,
        source: str(p.senderName) || 'NWS',
        type: str(p.event),
      };
    })
    .filter((warning) => warning.type.length > 0 && warning.startTime.length > 0);
  return warnings.sort(byStartAscending);
}
