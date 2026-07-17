/**
 * Retrying JSON-over-HTTP client.
 *
 * A single GET with an abort-based timeout, a bounded JSON body read, and the
 * retry, exponential backoff, and Retry-After honoring an upstream with a strict
 * quota and intermittent 429/503 responses needs. Generic over the response
 * shape and free of any provider-specific identifier: the caller supplies the
 * URL, the timeout, retry budget, User-Agent, and an optional per-attempt
 * counting hook. Error messages are tagged with the same `ERROR_CODES` substrings
 * the rest of the plugin classifies on.
 */

import { ERROR_CODES } from '../../constants/index.js';
import type { Logger } from '../../types/index.js';
import { toErrorMessage } from '../../utils/conversions.js';
import { DEFAULT_MAX_RESPONSE_BYTES, readBoundedJson } from '../../utils/http.js';

/**
 * Lowercased retryable error code substrings. An array, not a Set: membership is
 * tested by substring (`message.includes`), not exact key, so a Set buys nothing.
 * Lowercased once at module load so isRetryableError does not recompute it.
 */
const RETRYABLE_ERROR_SUBSTRINGS: ReadonlyArray<string> = [
  ERROR_CODES.NETWORK.API_RATE_LIMIT.toLowerCase(),
  ERROR_CODES.NETWORK.NETWORK_ERROR.toLowerCase(),
  'timeout',
  'econnreset',
  'enotfound',
];

/** Upper bound on Retry-After delays we honor, regardless of header value. */
const MAX_RETRY_AFTER_MS = 60_000;

/** Construction options for {@link RetryingHttpClient}. */
export interface RetryingHttpClientOptions {
  /** Abort each request attempt after this many milliseconds. */
  readonly requestTimeoutMs: number;
  /** Total attempts (initial plus retries) before giving up. */
  readonly retryAttempts: number;
  /** Base backoff in milliseconds, multiplied by the attempt number. */
  readonly retryDelayMs: number;
  /** `User-Agent` header sent on every request. */
  readonly userAgent: string;
  /** Called once immediately before every fetch attempt. It may reject dispatch. */
  readonly beforeRequest?: () => void;
  /** @deprecated Use `beforeRequest`. */
  readonly onRequestCounted?: () => void;
  /** Logger for debug and warn lines; defaults to a no-op. */
  readonly logger?: Logger;
  /** Response-body size cap in bytes; defaults to the shared 1 MiB. */
  readonly maxResponseBytes?: number;
  /** Label used in size and parse error messages; defaults to `'response'`. */
  readonly responseLabel?: string;
  /** Plugin-lifecycle cancellation signal shared by all requests and retry delays. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Generic retrying HTTP client. Provides a type-safe GET with retry,
 * exponential backoff, Retry-After honoring, an abort-based timeout, a
 * response-size cap, and an optional per-request counting hook. Caching is
 * left entirely to callers.
 */
export class RetryingHttpClient {
  private readonly requestTimeoutMs: number;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;
  private readonly userAgent: string;
  private readonly beforeRequest: () => void;
  private readonly logger: Logger;
  private readonly maxResponseBytes: number;
  private readonly responseLabel: string;
  private readonly signal: AbortSignal | undefined;

  constructor(options: RetryingHttpClientOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.retryAttempts = options.retryAttempts;
    this.retryDelayMs = options.retryDelayMs;
    this.userAgent = options.userAgent;
    this.beforeRequest = options.beforeRequest ?? options.onRequestCounted ?? (() => {});
    this.logger = options.logger ?? (() => {});
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.responseLabel = options.responseLabel ?? 'response';
    this.signal = options.signal;
  }

  /**
   * Issue a GET with retry and backoff; recurses on a retryable status or a
   * timeout until the attempt budget is spent.
   */
  public async request<T>(url: URL, attempt = 1): Promise<T> {
    this.signal?.throwIfAborted();
    // Keep local quota rejection outside the retry catch. A rejected reservation
    // is not an upstream failure and must never consume retry attempts.
    this.beforeRequest();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);
    const abortFromParent = (): void => controller.abort(this.signal?.reason);
    this.signal?.addEventListener('abort', abortFromParent, { once: true });

    try {
      return await this.performAttempt<T>(url, attempt, controller.signal);
    } catch (error) {
      return this.handleRequestError<T>(error, url, attempt, timedOut);
    } finally {
      clearTimeout(timeout);
      this.signal?.removeEventListener('abort', abortFromParent);
    }
  }

  private async performAttempt<T>(url: URL, attempt: number, signal: AbortSignal): Promise<T> {
    this.logger('debug', 'Making API request', {
      url: this.sanitizeUrlForLogging(url),
      attempt,
      maxAttempts: this.retryAttempts,
    });
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': this.userAgent },
      signal,
    });
    if (!response.ok) await this.handleApiError(response, attempt);
    // The attempt timeout remains armed while the response body is read.
    return readBoundedJson<T>(response, this.maxResponseBytes, this.responseLabel);
  }

  private async handleRequestError<T>(
    error: unknown,
    url: URL,
    attempt: number,
    timedOut: boolean
  ): Promise<T> {
    if (error instanceof Error && error.name === 'AbortError') {
      if (this.signal?.aborted) this.signal.throwIfAborted();
      if (!timedOut) throw error;
      if (attempt >= this.retryAttempts) {
        throw new Error(
          `${ERROR_CODES.NETWORK.API_TIMEOUT}: Request timeout after ${this.retryAttempts} attempts`
        );
      }
      this.logger('warn', 'Request timeout, retrying', {
        attempt,
        url: this.sanitizeUrlForLogging(url),
      });
      await this.delay(this.retryDelayMs * attempt);
      return this.request<T>(url, attempt + 1);
    }

    if (attempt >= this.retryAttempts || !this.isRetryableError(error)) throw error;
    const retryAfterMs = (error as { retryAfterMs?: number | null }).retryAfterMs;
    const delayMs = retryAfterMs ?? this.retryDelayMs * attempt;
    this.logger('warn', 'Retryable error, attempting retry', {
      attempt,
      delayMs,
      honoredRetryAfter: retryAfterMs != null,
      error: toErrorMessage(error),
    });
    await this.delay(delayMs);
    return this.request<T>(url, attempt + 1);
  }

  /**
   * Parse Retry-After header value to milliseconds
   * @private
   */
  private parseRetryAfter(response: Response): number | null {
    const retryAfter = response.headers.get('Retry-After');
    if (!retryAfter) return null;

    // Try parsing as seconds (integer)
    const seconds = Number.parseInt(retryAfter, 10);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }

    // Try parsing as HTTP date
    const retryDate = new Date(retryAfter);
    if (!Number.isNaN(retryDate.getTime())) {
      const delayMs = retryDate.getTime() - Date.now();
      if (delayMs > 0) {
        return Math.min(delayMs, MAX_RETRY_AFTER_MS);
      }
    }

    return null;
  }

  /**
   * Handle API error responses by classifying the status and throwing a
   * tagged error. Backoff is owned by the caller (`request`'s retry
   * loop) so this method must not sleep. Sleeping here previously caused
   * 2× backoff per retry attempt.
   * @private
   */
  private async handleApiError(response: Response, attempt: number): Promise<never> {
    const statusCode = response.status;
    const retryAfterMs = this.parseRetryAfter(response);

    let message = response.statusText;
    try {
      // Bound the error body too: a malicious 429/503 with an oversized body
      // would otherwise bypass the 1 MiB cap that protects success paths.
      const errorData = await readBoundedJson<{ message?: string }>(
        response,
        this.maxResponseBytes,
        this.responseLabel
      );
      message = errorData.message || response.statusText;
    } catch (parseError) {
      // Surface malformed error bodies by default so operators see upstream
      // misbehaviour without needing to enable debug logging.
      this.logger('warn', 'API error response was not JSON, falling back to statusText', {
        status: response.status,
        parseError: toErrorMessage(parseError),
      });
    }

    switch (statusCode) {
      case 401:
        throw new Error(`${ERROR_CODES.NETWORK.API_UNAUTHORIZED}: Invalid API key - ${message}`);
      case 403:
        // 403 Forbidden is distinct from 429 Rate Limit: wrong plan, expired key, IP blocked
        throw new Error(`${ERROR_CODES.NETWORK.API_FORBIDDEN}: API access forbidden - ${message}`);
      case 404:
        throw new Error(
          `${ERROR_CODES.DATA.INVALID_WEATHER_DATA}: Location not found - ${message}`
        );
      case 429:
        return this.throwRetryableStatus(attempt, retryAfterMs, {
          code: ERROR_CODES.NETWORK.API_RATE_LIMIT,
          logLabel: 'Rate limited by API, will retry',
          retryingMessage: `Rate limited, retrying - ${message}`,
          finalMessage: `Rate limit exceeded - ${message}`,
        });
      case 503:
        return this.throwRetryableStatus(attempt, retryAfterMs, {
          code: ERROR_CODES.NETWORK.NETWORK_ERROR,
          logLabel: 'Service unavailable, will retry',
          retryingMessage: `Service temporarily unavailable, retrying - ${message}`,
          finalMessage: `Service unavailable - ${message}`,
        });
      default:
        // A 5xx is a server fault that may recover, so tag it retryable
        // (NETWORK_ERROR). A 4xx is a client fault that will not change on
        // retry, so tag it non-retryable to avoid burning attempts and quota.
        if (statusCode >= 500) {
          throw new Error(
            `${ERROR_CODES.NETWORK.NETWORK_ERROR}: API request failed (${statusCode}) - ${message}`
          );
        }
        throw new Error(
          `${ERROR_CODES.NETWORK.API_INVALID_RESPONSE}: API request failed (${statusCode}) - ${message}`
        );
    }
  }

  /**
   * Throw a retryable-status error: while attempts remain, log and throw an
   * Error tagged with `retryAfterMs` so `request` retries; on the last
   * attempt throw a plain final error. Shared by the 429 and 503 branches.
   * @private
   */
  private throwRetryableStatus(
    attempt: number,
    retryAfterMs: number | null,
    opts: { code: string; logLabel: string; retryingMessage: string; finalMessage: string }
  ): never {
    if (attempt < this.retryAttempts) {
      this.logger('warn', opts.logLabel, {
        attempt,
        retryAfterMs,
        retryAfterHeader: !!retryAfterMs,
      });
      throw Object.assign(new Error(`${opts.code}: ${opts.retryingMessage}`), { retryAfterMs });
    }
    throw new Error(`${opts.code}: ${opts.finalMessage}`);
  }

  /**
   * Return URL string with the apikey query parameter stripped so it's safe to log.
   * Debug-level logs are not passed through sanitizeLogMetadata, so we must strip
   * secrets here before they reach the logger. A cheap string check avoids the
   * URL clone allocation on the common keyless path.
   * @private
   */
  private sanitizeUrlForLogging(url: URL): string {
    const raw = url.toString();
    if (!raw.includes('apikey')) {
      return raw;
    }
    const safe = new URL(url);
    safe.searchParams.set('apikey', '***');
    return safe.toString();
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // The module-level lowercased list avoids recomputing toLowerCase() on every retry decision.
      for (const needle of RETRYABLE_ERROR_SUBSTRINGS) {
        if (message.includes(needle)) return true;
      }
    }
    return false;
  }

  /**
   * Promise-based delay utility
   * @private
   */
  private delay(ms: number): Promise<void> {
    this.signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timeout);
        this.signal?.removeEventListener('abort', onAbort);
        reject(this.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      this.signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
