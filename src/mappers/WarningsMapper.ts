/**
 * Pure mappers from regional alert feeds to the Signal K v2 `WeatherWarning`
 * shape ({ startTime, endTime, details, source, type }). No I/O: fetching lives
 * in WarningsService, so these stay trivially unit-testable. Warnings are
 * returned in ascending start-time order, as the v2 API expects.
 */

import type { WeatherWarning } from '@signalk/server-api';
import { WARNINGS } from '../constants/index.js';
import { capExternalString } from '../utils/conversions.js';

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

/** Minimal shape of the Met.no MetAlerts `/current.json` GeoJSON response (only mapped fields). */
export interface MetAlertsResponse {
  readonly features?: ReadonlyArray<{
    readonly when?: { readonly interval?: ReadonlyArray<string> };
    readonly properties?: {
      readonly event?: string | null;
      readonly eventAwarenessName?: string | null;
      readonly severity?: string | null;
      readonly title?: string | null;
      readonly description?: string | null;
      readonly instruction?: string | null;
      readonly area?: string | null;
    };
  }>;
}

/**
 * Coerce an optional string-ish value to a trimmed, control-stripped short
 * label, or '' when absent. Timestamps pass through the same guard: they are
 * provider text too, and the label ceiling is far above any ISO 8601 instant.
 * The ceiling belongs to the field's role, so every call site picks `label` or
 * `details` and none of them names a length.
 */
function label(value: unknown): string {
  return capExternalString(value, WARNINGS.MAX_LABEL_LENGTH).trim();
}

/**
 * Coerce an optional string-ish value to a trimmed, control-stripped warning
 * body, or '' when absent. A body carries a marine narrative rather than a
 * name, so it keeps the far larger details ceiling.
 */
function details(value: unknown): string {
  return capExternalString(value, WARNINGS.MAX_DETAILS_LENGTH).trim();
}

function isValidTimestamp(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

/**
 * Sort warnings by ascending start time. Compares parsed epoch milliseconds
 * rather than the raw strings: NWS CAP timestamps carry a local UTC offset
 * (e.g. `2026-06-17T05:00:00-05:00`), and lexical comparison of offset-bearing
 * ISO strings does not match chronological order across offsets. An unparseable
 * timestamp sorts to the end (NaN-guarded) so it cannot jump ahead of real ones.
 */
function byStartAscending(a: WeatherWarning, b: WeatherWarning): number {
  const aMs = Date.parse(a.startTime);
  const bMs = Date.parse(b.startTime);
  if (Number.isNaN(aMs)) return Number.isNaN(bMs) ? 0 : 1;
  if (Number.isNaN(bMs)) return -1;
  return aMs - bMs;
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
      return {
        startTime: label(p.onset) || label(p.effective),
        endTime: label(p.ends) || label(p.expires),
        details: details(p.headline) || details(p.description),
        source: label(p.senderName) || 'NWS',
        type: label(p.event),
      };
    })
    .filter(
      (warning) =>
        warning.type.length > 0 &&
        isValidTimestamp(warning.startTime) &&
        isValidTimestamp(warning.endTime)
    );
  return warnings.sort(byStartAscending);
}

/**
 * Map a Met.no MetAlerts response to WeatherWarning[]. The start and end times
 * come from `when.interval` (onset at index 0, expiry at index 1). The type
 * prefers the localized `eventAwarenessName` (for example `Gale`), falling back
 * to the camelCase `event` (for example `gale`). Details prefer the narrative
 * `description`, falling back to the `title`, and append the `instruction` when
 * present, since the marine instruction (for example "Do not go out in a small
 * boat") is the actionable part. Features with no type or no start time are
 * dropped, the same contract as the NWS mapper. The source is MET Norway.
 */
export function mapMetAlertsToWarnings(response: MetAlertsResponse): WeatherWarning[] {
  const features = response.features ?? [];
  const warnings = features
    .map((feature) => {
      const p = feature.properties ?? {};
      const interval = feature.when?.interval ?? [];
      const base = details(p.description) || details(p.title);
      const instruction = details(p.instruction);
      const joined = instruction.length > 0 ? `${base} ${instruction}`.trim() : base;
      return {
        startTime: label(interval[0]),
        endTime: label(interval[1]),
        details: capExternalString(joined, WARNINGS.MAX_DETAILS_LENGTH),
        source: 'MET Norway',
        type: label(p.eventAwarenessName) || label(p.event),
      };
    })
    .filter(
      (warning) =>
        warning.type.length > 0 &&
        isValidTimestamp(warning.startTime) &&
        isValidTimestamp(warning.endTime)
    );
  return warnings.sort(byStartAscending);
}
