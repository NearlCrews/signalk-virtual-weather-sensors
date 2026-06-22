/**
 * Minimal JSON-over-HTTP client: a single GET with an abort-based timeout and a
 * response-size cap. Used by keyless providers (Open-Meteo) that do not need
 * the retry, backoff, and quota machinery `AccuWeatherService` layers on top of
 * its own fetch path. Error messages are tagged with the same `ERROR_CODES`
 * substrings the rest of the plugin classifies on.
 */

import { ERROR_CODES } from '../constants/index.js';
import { toErrorMessage } from './conversions.js';

/** Default response-body cap (1 MiB), matching the AccuWeather fetch path. */
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;

/** Default per-request timeout for the keyless JSON clients, in milliseconds. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Resolve a service base URL: a trimmed, non-empty override wins, otherwise the
 * fallback, with any trailing slashes stripped so endpoint joining is clean.
 * Shared by the keyless Open-Meteo clients so the idiom lives in one place.
 */
export function normalizeBaseUrl(override: string | undefined, fallback: string): string {
  const trimmed = override?.trim();
  return (trimmed && trimmed.length > 0 ? trimmed : fallback).replace(/\/+$/, '');
}

export interface FetchJsonOptions {
  /** Abort the request after this many milliseconds. */
  readonly timeoutMs: number;
  /** Extra request headers (for example a `User-Agent`). */
  readonly headers?: Record<string, string>;
  /** Response-body size cap in bytes; defaults to 1 MiB. */
  readonly maxBytes?: number;
}

/** Map an HTTP status onto the plugin's tagged error-code substring. */
function classifyStatus(status: number): string {
  if (status === 401) return ERROR_CODES.NETWORK.API_UNAUTHORIZED;
  if (status === 403) return ERROR_CODES.NETWORK.API_FORBIDDEN;
  if (status === 429) return ERROR_CODES.NETWORK.API_RATE_LIMIT;
  if (status >= 500) return ERROR_CODES.NETWORK.NETWORK_ERROR;
  return ERROR_CODES.NETWORK.API_INVALID_RESPONSE;
}

/**
 * Read a Response body as JSON with a size cap. The Content-Length check
 * rejects an oversized declared body before buffering; the post-read length
 * check is the fallback for a missing (chunked) or lying Content-Length.
 * The `label` appears in error messages so callers can identify which service
 * produced the oversized or unparseable body (defaults to `'response'`).
 */
export async function readBoundedJson<T>(
  response: Response,
  maxBytes: number = DEFAULT_MAX_RESPONSE_BYTES,
  label = 'response'
): Promise<T> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(
        `${ERROR_CODES.NETWORK.RESPONSE_TOO_LARGE}: ${label} is ${declared} bytes (max ${maxBytes})`
      );
    }
  }

  const text = await response.text();
  if (text.length > maxBytes) {
    throw new Error(
      `${ERROR_CODES.NETWORK.RESPONSE_TOO_LARGE}: ${label} is ${text.length} characters (max ${maxBytes})`
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(
      `${ERROR_CODES.NETWORK.API_INVALID_RESPONSE}: failed to parse ${label} as JSON - ${toErrorMessage(error)}`
    );
  }
}

/**
 * GET a URL and parse a bounded JSON body, aborting after `timeoutMs`. Throws a
 * tagged error on a timeout or a non-2xx status. No retry: a keyless upstream
 * with generous limits does not warrant burning a retry budget here, and the
 * caller's own update cadence provides the next attempt.
 */
export async function fetchJson<T>(url: URL | string, options: FetchJsonOptions): Promise<T> {
  const { timeoutMs, headers, maxBytes = DEFAULT_MAX_RESPONSE_BYTES } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(typeof url === 'string' ? url : url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `${classifyStatus(response.status)}: request failed (${response.status} ${response.statusText})`
      );
    }

    return await readBoundedJson<T>(response, maxBytes);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${ERROR_CODES.NETWORK.API_TIMEOUT}: request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
