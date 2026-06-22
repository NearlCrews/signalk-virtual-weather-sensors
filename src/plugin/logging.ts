/**
 * Logger factory for the Signal K Virtual Weather Sensors plugin.
 * Creates a structured Logger bound to the Signal K server's debug/error
 * channels, with sanitization of sensitive metadata on warn/error levels.
 */

import type { ServerAPI } from '@signalk/server-api';
import { PLUGIN } from '../constants/index.js';
import type { Logger, LogLevel } from '../types/index.js';

/** Level marker prepended to every log line so all four levels are distinguishable. */
const LOG_PREFIX: Record<LogLevel, string> = {
  debug: '[DEBUG] ',
  info: '[INFO] ',
  warn: '[WARN] ',
  error: '[ERROR] ',
};

/**
 * Single regex matching any sensitive key substring. `accuweatherapikey` is
 * covered by the `apikey` alternation (substring match) so it does not need its
 * own branch.
 */
const SENSITIVE_LOG_KEY_PATTERN = /apikey|api_key|password|secret|token/;

/**
 * Cap on metadata nesting (objects and arrays alike) before recursion is
 * truncated. A container AT this depth becomes the `'[depth-truncated]'`
 * marker, so the cap names the deepest level whose contents are still walked.
 */
const SANITIZE_MAX_DEPTH = 5;

/**
 * Sanitize log metadata to remove sensitive information. Thin typed entry
 * point: `sanitizeLogValue` is the sole recursive walker and owns the depth
 * cap, the circular-reference guard, and the sensitive-key redaction. The
 * top-level metadata bag is a fresh object at depth 0, so the walker always
 * returns an object here; the cast restores the entry point's record type.
 * @private
 */
function sanitizeLogMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return sanitizeLogValue(metadata, 0, new WeakSet()) as Record<string, unknown>;
}

/**
 * Recursively sanitize one metadata value. Primitives pass through; any
 * container past the depth cap collapses to a marker string (a cyclic or
 * pathologically deep metadata bag must not stack-overflow the Node process
 * when a warn / error is logged); objects redact sensitive keys, and arrays
 * walk each element so a nested `{ items: [{ apiKey }] }` cannot bypass
 * redaction.
 * @private
 */
function sanitizeLogValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (depth >= SANITIZE_MAX_DEPTH) {
    return '[depth-truncated]';
  }
  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeLogValue(entry, depth + 1, seen));
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_LOG_KEY_PATTERN.test(key.toLowerCase())
      ? '[REDACTED]'
      : sanitizeLogValue(entry, depth + 1, seen);
  }
  return sanitized;
}

export function createLogger(app: ServerAPI): Logger {
  // debug/info go through app.debug (gated by DEBUG=plugin-id). warn/error
  // go through app.error so operators see them without enabling debug logging.
  // Admin UI banner state is reported separately via app.setPluginError.
  return (level, message, metadata) => {
    const hasMetadata =
      metadata !== undefined && metadata !== null && Object.keys(metadata).length > 0;
    // Sanitize metadata only for warn/error (may carry API keys etc); the
    // hot-path debug/info logs skip it to avoid recursion overhead.
    const finalMetadata =
      hasMetadata && (level === 'warn' || level === 'error')
        ? sanitizeLogMetadata(metadata as Record<string, unknown>)
        : metadata;
    const logMetadata = hasMetadata ? ` | ${JSON.stringify(finalMetadata)}` : '';
    const line = `${LOG_PREFIX[level]}[${PLUGIN.NAME}] ${message}${logMetadata}`;
    if (level === 'warn' || level === 'error') {
      app.error(line);
    } else {
      app.debug(line);
    }
  };
}
