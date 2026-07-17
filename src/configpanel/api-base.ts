// Panel-shared utilities: the API base path plus the small helpers every
// panel hook and component would otherwise re-implement. Deliberately free of
// runtime-plugin imports (utils/conversions.ts and friends) so the browser
// bundle does not drag Node-side constants along.

import { PLUGIN_NAME } from '../constants/notifications-shared.js';

// Keep the route prefix in lockstep with the routes mounted by
// Plugin.registerWithRouter in src/index.ts: a divergence would 404 the
// panel's fetches against the live router.
export const API_BASE = `/plugins/${PLUGIN_NAME}/api`;

/** Fold an unknown thrown value into a display string. */
export function toErrorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface JsonResponse {
  readonly ok: boolean;
  readonly status: number;
  /** Raw response text, so pollers can compare payloads without reparsing. */
  readonly text: string;
  /** JSON-parsed body, or null when the body is not valid JSON. */
  readonly body: unknown;
}

/**
 * Fetch a panel API endpoint and parse the JSON body. A non-JSON body folds
 * into `body: null` instead of throwing so callers can still branch on the
 * HTTP status of an error response; network failures throw and are folded by
 * callers with `toErrorText`.
 */
export async function fetchJson(path: string, init?: RequestInit): Promise<JsonResponse> {
  const res = await fetch(`${API_BASE}${path}`, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Non-JSON body (proxy error page, empty 500): callers fall back on status.
  }
  return { ok: res.ok, status: res.status, text, body };
}
