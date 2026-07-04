/**
 * Shared Signal K delta primitives.
 *
 * Centralises the branded-type casts (`Context`, `SourceRef`, `Path`) and the
 * one-line `pv` / `me` builders so the mapper, notifier, and plugin entry
 * point all construct deltas through the same call sites. Keeps the
 * `vessels.self` literal in one place. Every delta must name its `$source`
 * explicitly: there is deliberately no default ref, so a caller that forgets
 * one fails to compile instead of silently mis-stamping a provider.
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
import { asTimestamp } from './conversions.js';

/** Signal K self-context literal used for every delta this plugin emits. */
export const SELF_CONTEXT = 'vessels.self' as Context;

/** Brand a provider's plain `sourceRef` string as the Signal K `SourceRef` type. */
export const toSourceRef = (source: string): SourceRef => source as SourceRef;

/** Build a Signal K PathValue, casting the plain string path to the branded Path type. */
export const pv = (path: string, value: unknown): PathValue => ({
  path: path as Path,
  value: value as PathValue['value'],
});

/** Build a Signal K Meta entry, casting the plain string path to the branded Path type. */
export const me = (path: string, value: MetaValue): Meta => ({ path: path as Path, value });

/** Current wall-clock time as a branded ISO 8601 Timestamp. */
const nowIso = () => asTimestamp(new Date().toISOString());

/**
 * Build a Signal K Delta carrying a single values update with the plugin's
 * standard self-context and a provider `$source`. When `timestamp` is omitted
 * OR empty (a provider that returned no observation time) the current
 * wall-clock time is stamped (notifier transitions, transient deltas); pass a
 * non-empty ISO timestamp for cached deltas that should keep the original
 * observation time. Defaulting empty here is the single chokepoint so every
 * caller is covered and an empty string can never reach the wire as a
 * timestamp. `sourceRef` is required: the active provider passes its own ref
 * so consumers' source-priority rules can distinguish weather sources.
 */
export function buildValuesDelta(
  values: PathValue[],
  timestamp: string | undefined,
  sourceRef: SourceRef
): Delta {
  return {
    context: SELF_CONTEXT,
    updates: [
      {
        $source: sourceRef,
        timestamp: timestamp ? asTimestamp(timestamp) : nowIso(),
        values,
      },
    ],
  };
}

/**
 * Build a Signal K Delta carrying a single meta update. Mirrors
 * {@link buildValuesDelta} for the static one-shot meta block.
 */
export function buildMetaDelta(meta: Meta[], sourceRef: SourceRef): Delta {
  return {
    context: SELF_CONTEXT,
    updates: [
      {
        $source: sourceRef,
        timestamp: nowIso(),
        meta,
      },
    ],
  };
}
