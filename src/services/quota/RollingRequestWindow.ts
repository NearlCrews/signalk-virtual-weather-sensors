/** Exact rolling-window width used by the AccuWeather daily quota. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RequestWindowSnapshot {
  readonly cumulative: number;
  readonly timestamps: ReadonlyArray<number>;
}

/**
 * Exact rolling 24-hour request window.
 *
 * JavaScript runs each method synchronously, so `tryAcquire` performs the
 * prune, limit check, and reservation as one indivisible operation before an
 * HTTP request is dispatched. Future timestamps are retained during a
 * backward clock correction so the limiter fails conservatively.
 */
export class RollingRequestWindow {
  private cumulative = 0;
  private timestamps: number[] = [];

  constructor(now = Date.now(), snapshot?: RequestWindowSnapshot) {
    if (snapshot !== undefined) {
      this.cumulative = Number.isSafeInteger(snapshot.cumulative)
        ? Math.max(0, snapshot.cumulative)
        : 0;
      this.timestamps = snapshot.timestamps.filter(
        (timestamp): timestamp is number =>
          Number.isFinite(timestamp) && timestamp > now - WINDOW_MS
      );
      this.timestamps.sort((a, b) => a - b);
    }
  }

  /** Record an already-approved request. Prefer `tryAcquire` for quota-controlled dispatch. */
  public record(now = Date.now()): void {
    this.prune(now);
    this.timestamps.push(now);
    this.timestamps.sort((a, b) => a - b);
    this.cumulative++;
  }

  /**
   * Reserve one request when the rolling count is below `limit`. A missing,
   * non-finite, or non-positive limit disables the cap but still records use.
   */
  public tryAcquire(limit: number | undefined, now = Date.now()): boolean {
    this.prune(now);
    if (
      limit !== undefined &&
      Number.isFinite(limit) &&
      limit > 0 &&
      this.timestamps.length >= limit
    ) {
      return false;
    }
    this.timestamps.push(now);
    this.timestamps.sort((a, b) => a - b);
    this.cumulative++;
    return true;
  }

  public cumulativeCount(): number {
    return this.cumulative;
  }

  public countLast24h(now = Date.now()): number {
    this.prune(now);
    return this.timestamps.length;
  }

  public snapshot(now = Date.now()): RequestWindowSnapshot {
    this.prune(now);
    return { cumulative: this.cumulative, timestamps: [...this.timestamps] };
  }

  private prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    let firstRetained = 0;
    while (
      firstRetained < this.timestamps.length &&
      (this.timestamps[firstRetained] ?? 0) <= cutoff
    ) {
      firstRetained++;
    }
    if (firstRetained > 0) this.timestamps = this.timestamps.slice(firstRetained);
  }
}
