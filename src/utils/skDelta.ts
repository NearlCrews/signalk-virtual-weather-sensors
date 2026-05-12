/**
 * Shared Signal K delta primitives.
 *
 * Centralises the branded-type casts (`Context`, `SourceRef`, `Path`) and the
 * one-line `pv` / `me` builders so the mapper, notifier, and plugin entry
 * point all construct deltas through the same call sites. Keeps the
 * `vessels.self` literal and the `accuweather` `$source` ref in one place.
 */

import type {
  Context,
  Delta,
  Meta,
  MetaValue,
  Path,
  PathValue,
  SourceRef,
} from '@signalk/server-api';
import { PLUGIN } from '../constants/index.js';
import { asTimestamp } from './conversions.js';

/** Signal K self-context literal used for every delta this plugin emits. */
export const SELF_CONTEXT = 'vessels.self' as Context;

/** Stable `$source` ref for every delta. Matches `PLUGIN.SOURCE_REF`. */
export const ACCUWEATHER_SOURCE = PLUGIN.SOURCE_REF as SourceRef;

/** Build a Signal K PathValue, casting the plain string path to the branded Path type. */
export const pv = (path: string, value: unknown): PathValue => ({
  path: path as Path,
  value: value as PathValue['value'],
});

/** Build a Signal K Meta entry, casting the plain string path to the branded Path type. */
export const me = (path: string, value: MetaValue): Meta => ({ path: path as Path, value });

/**
 * Build a Signal K Delta carrying a single values update with the plugin's
 * standard self-context and `$source`. When `timestamp` is omitted the current
 * wall-clock time is stamped (notifier transitions, transient deltas); pass an
 * explicit ISO timestamp for cached deltas that should keep the original
 * observation time.
 */
export function buildValuesDelta(values: PathValue[], timestamp?: string): Delta {
  return {
    context: SELF_CONTEXT,
    updates: [
      {
        $source: ACCUWEATHER_SOURCE,
        timestamp: asTimestamp(timestamp ?? new Date().toISOString()),
        values,
      },
    ],
  };
}

/**
 * Build a Signal K Delta carrying a single meta update. Mirrors
 * {@link buildValuesDelta} for the static one-shot meta block.
 */
export function buildMetaDelta(meta: Meta[]): Delta {
  return {
    context: SELF_CONTEXT,
    updates: [
      {
        $source: ACCUWEATHER_SOURCE,
        timestamp: asTimestamp(new Date().toISOString()),
        meta,
      },
    ],
  };
}
