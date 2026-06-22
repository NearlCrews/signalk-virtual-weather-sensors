/** Number of hourly buckets in the rolling 24h request window. */
const REQUEST_WINDOW_HOURS = 24;
/** Hour expressed in milliseconds, used by the rolling window rotation. */
const HOUR_MS = 60 * 60 * 1000;

/**
 * Generic rolling 24-hour request counter backed by 24 hourly buckets.
 *
 * Tracks both a cumulative all-time count and a windowed last-24h count. The
 * windowed count rotates as time advances, so memory stays at exactly 24
 * numbers regardless of uptime. All methods accept a `now` timestamp
 * (defaulting to `Date.now()`) so the class is deterministically testable
 * without fake timers or module-level mocking.
 *
 * Typical use: one instance per service that needs quota tracking; call
 * `record()` on every successful upstream API request and `countLast24h()` to
 * check the rolling total against a configured quota ceiling.
 */
export class RollingRequestWindow {
  /**
   * Cumulative count of all recorded requests since construction. Never
   * decreases; survives window rotations.
   */
  private cumulative = 0;

  /**
   * Fixed-length array of 24 hourly request-count buckets spanning the last 24
   * hours. The last slot (`buckets[REQUEST_WINDOW_HOURS - 1]`) is the current
   * hour; earlier indices step into the past. `rotate` shifts the array left by
   * the number of elapsed hours (dropping the oldest, pushing zeros at the
   * current-hour end), so memory stays at exactly 24 numbers regardless of
   * uptime. The current-hour epoch index lives in `currentHour`.
   */
  private buckets: number[] = new Array(REQUEST_WINDOW_HOURS).fill(0);

  /**
   * Epoch-hour index of the LAST bucket (`buckets[REQUEST_WINDOW_HOURS - 1]`),
   * i.e. the current-hour slot. On rotation we shift the array left by the
   * number of elapsed hours and update this index.
   */
  private currentHour: number;

  constructor(now = Date.now()) {
    this.currentHour = Math.floor(now / HOUR_MS);
  }

  /**
   * Record one request. Increments the cumulative count first so it reflects
   * the request before any rotation side-effects, then rotates the window to
   * the current hour, then increments the current-hour bucket.
   */
  public record(now = Date.now()): void {
    this.cumulative++;
    this.rotate(now);
    this.buckets[REQUEST_WINDOW_HOURS - 1] = (this.buckets[REQUEST_WINDOW_HOURS - 1] ?? 0) + 1;
  }

  /**
   * All-time request count since construction. Never decreases, regardless of
   * how many buckets have rotated out of the 24h window.
   */
  public cumulativeCount(): number {
    return this.cumulative;
  }

  /**
   * HTTP fetch attempts in the rolling last 24 hours. Backed by 24 hourly
   * buckets that rotate as time advances, so memory stays constant regardless
   * of uptime. Rotates before summing so a quota check made between fetches
   * still reflects buckets that have aged out.
   */
  public countLast24h(now = Date.now()): number {
    this.rotate(now);
    let total = 0;
    for (const count of this.buckets) {
      total += count;
    }
    return total;
  }

  /**
   * Advance the rolling window so `buckets[REQUEST_WINDOW_HOURS - 1]` tracks
   * the current epoch hour, zeroing buckets for skipped hours. Called from both
   * the read path (so quota checks see fresh state) and the write path (so the
   * increment lands in the right bucket).
   */
  private rotate(now: number): void {
    const hour = Math.floor(now / HOUR_MS);
    const elapsed = hour - this.currentHour;
    if (elapsed === 0) return;
    if (elapsed < 0) {
      // Backward wall-clock jump (NTP correction, manual clock change). The
      // existing buckets are labelled against the old, now-future hour index
      // so their counts no longer correspond to the previous 24 hours of
      // real time. Zero the window: undercounting briefly is far safer than
      // capping fetches against ghost requests for up to 24 hours.
      this.buckets.fill(0);
      this.currentHour = hour;
      return;
    }
    if (elapsed >= REQUEST_WINDOW_HOURS) {
      // More than a full window has passed: every bucket is stale.
      this.buckets.fill(0);
    } else {
      // Shift left by `elapsed`, dropping the oldest hours and pushing zeros
      // for the freshly exposed (current-hour) slots. O(min(elapsed, 24)) per
      // rotation; off the per-emission hot path (only fetches and quota
      // checks rotate, both at minutes-or-longer cadence).
      this.buckets.splice(0, elapsed);
      for (let i = 0; i < elapsed; i++) {
        this.buckets.push(0);
      }
    }
    this.currentHour = hour;
  }
}
