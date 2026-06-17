/**
 * Weather Service - Main Orchestration Layer
 * Modern TypeScript implementation coordinating weather data collection and processing
 * Integrates AccuWeather API, vessel navigation data, and wind calculations
 */

import type { ServerAPI } from '@signalk/server-api';
import { WindCalculator } from '../calculators/WindCalculator.js';
import { API_QUOTA, ERROR_CODES, PERFORMANCE, PLUGIN } from '../constants/index.js';
import type { CurrentWeatherProvider } from '../providers/WeatherProvider.js';
import {
  isCompleteNavigationData,
  type Logger,
  type MarineData,
  type PluginConfiguration,
  type PluginState,
  type VesselNavigationData,
  type WeatherData,
} from '../types/index.js';
import {
  elapsedSinceMs,
  isApiQuotaReached,
  msToWholeMinutes,
  toErrorMessage,
} from '../utils/conversions.js';
import { AccuWeatherService } from './AccuWeatherService.js';
import type { OpenMeteoMarineService } from './OpenMeteoMarineService.js';
import { SignalKService } from './SignalKService.js';

/**
 * Public, stable shape returned by `getServiceStatus()`. The nested health and
 * cache shapes are derived from the underlying service methods so the contract
 * stays in lockstep with what those services actually return.
 */
export interface WeatherServiceStatus {
  readonly state: PluginState;
  readonly lastUpdate: Date | null;
  readonly updateCount: number;
  readonly errorCount: number;
  readonly hasWeatherData: boolean;
  readonly signalKHealth: ReturnType<SignalKService['getHealthStatus']>;
  readonly cacheStats: ReturnType<CurrentWeatherProvider['getCacheStats']>;
  readonly apiRequestCount: number;
}

/** Apparent-wind result. Either field is absent when it cannot be derived. */
interface ApparentWind {
  readonly apparentWindSpeed?: number;
  readonly apparentWindAngle?: number;
}

/** Banner the emission tick should push, as selected by `getTickBanner`. */
export interface TickBanner {
  readonly kind: 'status' | 'error';
  readonly message: string;
}

/**
 * Single sink for every status / error banner write. Routed through the
 * plugin-entry-level `setBanner` so identical consecutive `(kind, message)`
 * pairs dedupe. Optional: tests construct WeatherService without a sink and
 * fall back to direct `app.setPlugin*` writes.
 */
export type BannerSink = (kind: 'status' | 'error', message: string) => void;

/**
 * Main Weather Service orchestrating all weather data operations
 * Coordinates AccuWeather API, vessel navigation, and wind calculations
 */
export class WeatherService {
  private readonly app: ServerAPI;
  private readonly config: PluginConfiguration;
  private readonly logger: Logger;

  private readonly accuWeatherService: CurrentWeatherProvider;
  /** Optional sea-state fetcher; present only when the marine layer is enabled. */
  private readonly marineService: OpenMeteoMarineService | null;
  private readonly signalKService: SignalKService;
  private readonly windCalculator: WindCalculator;

  private state: PluginState = 'stopped';
  private updateTimer: NodeJS.Timeout | null = null;
  // Single-flight latch for updateWeatherData: overlapping callers join the
  // in-flight fetch instead of starting a second one (see updateWeatherData).
  private updateInFlight: Promise<void> | null = null;
  private initialUpdateTimer: NodeJS.Timeout | null = null;

  private currentWeatherData: WeatherData | null = null;
  /** Last successful marine snapshot; null until the first marine fetch (or when disabled). */
  private currentMarineData: MarineData | null = null;
  private lastUpdate: Date | null = null;

  // Performance monitoring
  private updateCount = 0;
  private errorCount = 0;
  /**
   * Consecutive fetch failures since the last success. Every failure escalates
   * immediately (see `escalateFetchError`); the streak only drives the cosmetic
   * `(N consecutive)` suffix on the error banner, there is no threshold gate.
   */
  private consecutiveFailures = 0;
  /**
   * True once an AccuWeather 401 has been seen: the configured key is invalid,
   * so retrying burns quota with no chance of success. The update timer is
   * cleared and subsequent forceUpdate calls return early. Cleared only by a
   * config change, which constructs a fresh service instance.
   */
  private apiKeyRejected = false;

  /**
   * Banner sink wired by the plugin entry point. When supplied, every status
   * and error banner write routes through it so the entry-point dedupe catches
   * repeated identical messages. When `undefined` (tests, direct construction)
   * the service falls back to the bare `app.setPlugin*` API.
   */
  private readonly setBanner: BannerSink;

  constructor(
    app: ServerAPI,
    config: PluginConfiguration,
    logger: Logger = () => {},
    windCalculator?: WindCalculator,
    accuWeatherService?: CurrentWeatherProvider,
    signalKService?: SignalKService,
    setBanner?: BannerSink,
    marineService?: OpenMeteoMarineService
  ) {
    this.app = app;
    this.config = config;
    this.logger = logger;
    this.setBanner =
      setBanner ??
      ((kind, message) => {
        if (kind === 'status') app.setPluginStatus(message);
        else app.setPluginError(message);
      });

    this.logger('info', 'WeatherService initializing', {
      pluginName: PLUGIN.NAME,
      updateFrequency: this.config.updateFrequency,
      emissionInterval: this.config.emissionInterval,
      enableEventDriven: true,
      useVesselPosition: true,
    });

    // The fallback must carry dailyApiQuota: without it the injected-service
    // path (production, index.ts) and this direct-construction path (tests)
    // would disagree on quota gating for forecast fetches.
    this.accuWeatherService =
      accuWeatherService ??
      new AccuWeatherService(this.config.accuWeatherApiKey, this.logger, {
        dailyApiQuota: this.config.dailyApiQuota,
      });
    this.signalKService = signalKService ?? new SignalKService(this.app, this.logger);
    this.windCalculator = windCalculator ?? new WindCalculator(this.logger);
    this.marineService = marineService ?? null;

    this.logger('info', 'WeatherService initialized successfully');
  }

  /**
   * Start the weather service with hybrid emission system
   */
  public async start(): Promise<void> {
    if (this.state === 'running') {
      this.logger('warn', 'WeatherService already running');
      return;
    }

    try {
      this.state = 'starting';
      this.logger('info', 'Starting WeatherService');

      // Start periodic weather data updates
      // Emission is handled by the plugin entry point (index.ts) via NMEA2000PathMapper
      this.setupWeatherUpdates();

      // Perform initial weather update after brief delay. Track the handle so
      // a stop() within the delay window doesn't leave the callback firing
      // against a torn-down service.
      this.initialUpdateTimer = setTimeout(() => {
        this.initialUpdateTimer = null;
        if (this.state !== 'running') return;
        this.updateWeatherData().catch((error) => {
          this.logger('error', 'Initial weather update failed', {
            error: toErrorMessage(error),
          });
        });
      }, PLUGIN.INITIAL_UPDATE_DELAY_MS);

      this.state = 'running';
      this.logger('info', 'WeatherService started successfully');

      // The plugin entry point pushes the live status banner immediately after
      // start() returns, so a banner write here would be overwritten on the
      // same tick. Likewise, startup errors are surfaced via setPluginError in
      // index.ts handleStartupError(): rethrow and let the caller publish.
    } catch (error) {
      this.state = 'error';
      const errorMessage = toErrorMessage(error);

      this.logger('error', 'Failed to start WeatherService', {
        error: errorMessage,
      });

      throw new Error(`${ERROR_CODES.SYSTEM.PLUGIN_START_FAILED}: ${errorMessage}`);
    }
  }

  /**
   * Stop the weather service and clean up resources
   */
  public async stop(): Promise<void> {
    if (this.state === 'stopped') {
      this.logger('warn', 'WeatherService already stopped');
      return;
    }

    try {
      this.state = 'stopping';
      this.logger('info', 'Stopping WeatherService');

      // Clear update timer
      if (this.updateTimer) {
        clearInterval(this.updateTimer);
        this.updateTimer = null;
      }

      // Clear pending initial-update timer if still in flight
      if (this.initialUpdateTimer) {
        clearTimeout(this.initialUpdateTimer);
        this.initialUpdateTimer = null;
      }

      // Clear cached weather payload but preserve the AccuWeather location-key
      // cache: its entries stay valid for the configured locationCacheTimeout,
      // and refetching on every restart burns paid LOCATION_SEARCH API calls.
      // Per-instance memory gets GC'd when the service is dropped anyway.
      this.currentWeatherData = null;
      this.currentMarineData = null;
      this.lastUpdate = null;
      this.signalKService.clearCache();

      this.state = 'stopped';
      this.logger('info', 'WeatherService stopped successfully', {
        updateCount: this.updateCount,
        errorCount: this.errorCount,
      });

      // No banner write here: the plugin entry point publishes PLUGIN.STATUS.STOPPED
      // on the very next line of its stop() handler, so a write here would be a
      // dead write.
    } catch (error) {
      this.state = 'error';
      const errorMessage = toErrorMessage(error);

      this.logger('error', 'Failed to stop WeatherService', {
        error: errorMessage,
      });

      throw new Error(`${ERROR_CODES.SYSTEM.PLUGIN_STOP_FAILED}: ${errorMessage}`);
    }
  }

  /**
   * Get current weather data
   */
  public getCurrentWeatherData(): WeatherData | null {
    return this.currentWeatherData;
  }

  /** Latest sea-state snapshot, or null when the marine layer is disabled or has no data yet. */
  public getCurrentMarineData(): MarineData | null {
    return this.currentMarineData;
  }

  /**
   * Fetch the optional sea-state layer for the given position, best-effort.
   * No-op when the marine service is not configured. A failure logs and keeps
   * the previous snapshot so a transient marine outage does not blank the data.
   * @private
   */
  private async refreshMarineData(position: {
    readonly latitude: number;
    readonly longitude: number;
  }): Promise<void> {
    if (!this.marineService) return;
    try {
      this.currentMarineData = await this.marineService.fetchMarine(position);
    } catch (error) {
      this.logger('warn', 'Marine data fetch failed; keeping last marine snapshot', {
        error: toErrorMessage(error),
      });
    }
  }

  /** Milliseconds since the last successful weather fetch, or null if none yet. */
  public getDataAgeMs(): number | null {
    return elapsedSinceMs(this.lastUpdate ? this.lastUpdate.getTime() : null);
  }

  /**
   * Age threshold beyond which fetched weather data counts as stale:
   * `STALENESS_FACTOR` times the fetch cadence, so one missed fetch is
   * tolerated and the second trips the watchdog.
   * @private
   */
  private maxStalenessMs(): number {
    return PLUGIN.STALENESS_FACTOR * this.config.updateFrequency * 60_000;
  }

  /**
   * True once the last successful fetch is older than `maxStalenessMs()`.
   * The emission tick uses this to stop broadcasting outdated data; false
   * before the first fetch (there is nothing stale to withhold).
   */
  public isDataStale(): boolean {
    const ageMs = this.getDataAgeMs();
    return ageMs !== null && ageMs > this.maxStalenessMs();
  }

  /**
   * Banner the emission tick should push this tick. Owns the precedence:
   * the quota-exhausted error wins (it tells the operator WHY fetches paused,
   * even when the data has also gone stale), then the stale-data error, then
   * the live status banner. The caller routes the result through its dedupe
   * sink and separately gates emission on `isDataStale()`.
   */
  public getTickBanner(): TickBanner {
    if (this.isQuotaExhausted()) {
      return { kind: 'error', message: this.formatQuotaExhaustedMessage() };
    }
    const ageMs = this.getDataAgeMs();
    if (ageMs !== null && ageMs > this.maxStalenessMs()) {
      return { kind: 'error', message: this.formatStaleMessage(ageMs) };
    }
    return { kind: 'status', message: this.formatStatusBanner() };
  }

  /**
   * Operator-facing stale-data banner message. Floors (not rounds) so a delta
   * that has crossed the threshold by, say, 30 seconds reports the actual
   * whole minute since last update, not the next minute up. Pluralizes for
   * the "1 minute ago" boundary.
   * @private
   */
  private formatStaleMessage(ageMs: number): string {
    const ageMin = msToWholeMinutes(ageMs);
    const unit = ageMin === 1 ? 'minute' : 'minutes';
    return `Weather data stale: last update ${ageMin} ${unit} ago`;
  }

  /**
   * Rolling 24h request count for the admin-UI panel's `/api/status` endpoint.
   * Delegates to the AccuWeather service's hourly-bucket accessor.
   */
  public getRequestCountLast24h(): number {
    return this.accuWeatherService.getRequestCountLast24h();
  }

  /**
   * Admin UI status banner string. Format:
   *   "Running, last update Nm ago (N updates, K API requests, K/Q today)"
   * or "Running, awaiting first update (K/Q today)" before the first fetch.
   * Segments are assembled from a `string[]` and joined with ', ' so each
   * piece is independent: the API-request counter and the quota suffix drop
   * out cleanly when their inputs are zero or the cap is disabled, without
   * needing a regex strip on the leading separator.
   *
   * Crossing `API_QUOTA.WARN_RATIO` switches the banner prefix to a
   * quota-warning variant so operators see the cap is approaching even when
   * no setPluginError is active yet.
   */
  public formatStatusBanner(): string {
    // A rejected API key is a terminal state until the operator updates config:
    // surface it on the status banner so the admin UI does not show an
    // inconsistent "Running, awaiting first update" alongside the auth-error
    // banner published from `escalateFetchError`.
    if (this.apiKeyRejected) {
      return 'API key rejected: update key in plugin settings';
    }

    const used = this.getRequestCountLast24h();
    const prefix = this.shouldShowQuotaWarning(used)
      ? PLUGIN.STATUS.RUNNING_QUOTA_WARN
      : PLUGIN.STATUS.RUNNING;

    const ageMs = this.getDataAgeMs();
    if (ageMs === null) {
      const quotaSegment = this.formatQuotaSegment(used);
      const head = `${prefix}, awaiting first update`;
      return quotaSegment ? `${head} (${quotaSegment})` : head;
    }

    const ageMin = msToWholeMinutes(ageMs);
    const ageLabel = ageMin <= 0 ? 'just now' : `${ageMin}m ago`;
    const requestCount = this.accuWeatherService.getRequestCount();

    const counters: string[] = [
      `${this.updateCount} ${this.updateCount === 1 ? 'update' : 'updates'}`,
    ];
    if (requestCount > 0) {
      counters.push(`${requestCount} API ${requestCount === 1 ? 'request' : 'requests'}`);
    }
    const quotaSegment = this.formatQuotaSegment(used);
    if (quotaSegment) counters.push(quotaSegment);

    return `${prefix}, last update ${ageLabel} (${counters.join(', ')})`;
  }

  /**
   * `K/Q today` segment (no leading separator) when `dailyApiQuota > 0`,
   * otherwise empty. `used` is the rolling 24h count, read once by the caller.
   * @private
   */
  private formatQuotaSegment(used: number): string {
    if (this.config.dailyApiQuota <= 0) return '';
    return `${used}/${this.config.dailyApiQuota} today`;
  }

  /**
   * True when the rolling 24h request count `used` has crossed `WARN_RATIO` of
   * the configured quota. Returns false when the cap is disabled.
   * @private
   */
  private shouldShowQuotaWarning(used: number): boolean {
    return isApiQuotaReached(used, this.config.dailyApiQuota, API_QUOTA.WARN_RATIO);
  }

  /**
   * True once an AccuWeather 401 has set `apiKeyRejected`. Exposed so the
   * admin-UI panel's `/api/status` payload can render the rejected state in
   * its `running` flag without subscribing to banner events.
   */
  public isApiKeyRejected(): boolean {
    return this.apiKeyRejected;
  }

  /**
   * True when the rolling 24h request count has reached the configured cap.
   * Used by `updateWeatherData` to short-circuit fetches; the existing
   * stale-data error path then surfaces the pause to operators.
   */
  public isQuotaExhausted(): boolean {
    return isApiQuotaReached(this.getRequestCountLast24h(), this.config.dailyApiQuota);
  }

  /**
   * Operator-facing message used when fetches are paused at the daily quota.
   * Public so the emission tick can re-push the same wording instead of
   * letting a periodic setPluginStatus call silently overwrite the error.
   */
  public formatQuotaExhaustedMessage(): string {
    const used = this.getRequestCountLast24h();
    const quota = this.config.dailyApiQuota;
    return `AccuWeather daily quota reached (${used}/${quota} in last 24h). Fetches paused until the rolling window drops below the cap. To resume sooner, raise dailyApiQuota or increase updateFrequency.`;
  }

  /**
   * Get service status and health information
   */
  public getServiceStatus(): WeatherServiceStatus {
    return {
      state: this.state,
      lastUpdate: this.lastUpdate,
      updateCount: this.updateCount,
      errorCount: this.errorCount,
      hasWeatherData: !!this.currentWeatherData,
      signalKHealth: this.signalKService.getHealthStatus(),
      cacheStats: this.accuWeatherService.getCacheStats(),
      apiRequestCount: this.accuWeatherService.getRequestCount(),
    };
  }

  /**
   * Force immediate weather data update. No production caller: kept public for
   * the test suite (like `AccuWeatherService.clearLocationCache`), where it is
   * the cadence-independent way to drive `updateWeatherData`.
   */
  public async forceUpdate(): Promise<void> {
    this.logger('info', 'Forcing immediate weather update');
    await this.updateWeatherData();
  }

  /**
   * True for a 401 (invalid API key) error tagged by
   * `AccuWeatherService.handleApiError`. A 401 cannot be retried, so the update
   * timer is cleared until the operator changes the key. A 403 (forbidden) is
   * deliberately NOT treated as fatal: it can be transient (an IP block or a
   * brief plan glitch), so it surfaces an error but leaves the retry timer
   * running to recover on its own.
   */
  private isAuthError(error: unknown): boolean {
    return error instanceof Error && error.message.includes(ERROR_CODES.NETWORK.API_UNAUTHORIZED);
  }

  /**
   * Calculate interval with jitter to avoid synchronized API requests
   * Adds ±10% random variation to the interval
   * @private
   */
  private addJitter(baseInterval: number): number {
    const jitterRange = baseInterval * 0.1;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    return Math.round(baseInterval + jitter);
  }

  /**
   * Setup periodic weather data updates with jitter
   * Jitter prevents multiple plugin instances from synchronizing API requests
   * @private
   */
  private setupWeatherUpdates(): void {
    const baseInterval = this.config.updateFrequency * 60 * 1000; // Convert minutes to milliseconds
    const updateInterval = this.addJitter(baseInterval);

    this.updateTimer = setInterval(() => {
      this.updateWeatherData().catch((error) => {
        // errorCount is incremented inside updateWeatherData's own catch
        // before it rethrows; this handler only logs the rejection.
        this.logger('error', 'Scheduled weather update failed', {
          error: toErrorMessage(error),
          errorCount: this.errorCount,
        });
      });
    }, updateInterval);

    this.logger('info', 'Weather update timer started', {
      intervalMinutes: this.config.updateFrequency,
      baseIntervalMs: baseInterval,
      actualIntervalMs: updateInterval,
      jitterApplied: true,
    });
  }

  /**
   * Update weather data from AccuWeather API. Single-flight: a scheduled tick
   * that fires while a slow fetch is still in flight (or a forceUpdate racing
   * the timer) joins the existing fetch instead of starting a second one.
   * Concurrent fetches would double-spend API quota and race the post-fetch
   * writes to currentWeatherData, lastUpdate, and updateCount.
   * @private
   */
  private updateWeatherData(): Promise<void> {
    if (this.updateInFlight !== null) {
      return this.updateInFlight;
    }
    const run = this.runWeatherUpdate().finally(() => {
      this.updateInFlight = null;
    });
    this.updateInFlight = run;
    return run;
  }

  private async runWeatherUpdate(): Promise<void> {
    const startTime = Date.now();

    // Bad key has been seen previously: do not refetch. The update timer is
    // already cleared and an error banner is published; this guard catches a
    // racing initialUpdateTimer callback or a manual forceUpdate.
    if (this.apiKeyRejected) {
      this.logger('debug', 'Skipping weather update: API key was rejected');
      return;
    }

    // Daily-quota guard: when the rolling 24h request count meets the cap,
    // skip the fetch entirely. The existing stale-data error path
    // (`emitWeatherTick` in index.ts) takes over once `lastUpdate` ages
    // past `2 * updateFrequency`. We also emit an explicit setPluginError
    // here so operators see WHY the plugin paused (rather than a generic
    // stale-data message) the moment the cap is hit.
    if (this.isQuotaExhausted()) {
      const message = this.formatQuotaExhaustedMessage();
      this.logger('warn', 'Skipping weather update: daily API quota reached', { message });
      this.setBanner('error', message);
      return;
    }

    try {
      this.logger('debug', 'Starting weather data update');

      // Single navigation read also yields position: avoids fetching twice.
      const vesselData = this.signalKService.getVesselNavigationData();
      const position = vesselData.position;
      if (!position) {
        throw new Error('No position available for weather data');
      }

      const weatherData = await this.accuWeatherService.fetchCurrentWeather(position);

      const enhancedWeatherData = this.enhanceWeatherData(weatherData, vesselData);

      // Drop the result if stop() ran while the fetch was in flight; otherwise we'd
      // resurrect state on a torn-down service and race a subsequent start().
      if (this.state !== 'running' && this.state !== 'starting') {
        this.logger('debug', 'Discarding weather update: service no longer running', {
          state: this.state,
        });
        return;
      }

      const isFirstSuccessfulUpdate = this.lastUpdate === null;
      this.currentWeatherData = enhancedWeatherData;
      this.lastUpdate = new Date();
      this.updateCount++;
      // Reset failure streaks on any successful fetch so transient outages do
      // not leave the plugin in an error state once recovery happens.
      this.consecutiveFailures = 0;

      // Optional sea-state layer: fetched on the same cadence and position as
      // the weather update. Best-effort, so a marine failure (inland point,
      // marine host down) only logs and keeps the last marine snapshot; it never
      // fails the weather update or trips the error banner.
      await this.refreshMarineData(position);

      // Cold-start UX: the plugin entry pushes "Running, awaiting first update"
      // during start(), and the emission timer wouldn't re-push the banner
      // until its next tick (up to emissionInterval seconds away). Push the
      // live banner here so the "awaiting" string flips the instant the first
      // fetch lands. Subsequent updates rely on the emission tick's dedupe to
      // avoid double-pushes within the same minute.
      if (isFirstSuccessfulUpdate) {
        this.setBanner('status', this.formatStatusBanner());
      }

      const processingTime = Date.now() - startTime;
      this.logger('info', 'Weather data updated successfully', {
        processingTimeMs: processingTime,
        temperature: enhancedWeatherData.temperature,
        windSpeed: enhancedWeatherData.windSpeed,
        pressure: enhancedWeatherData.pressure,
        hasApparentWind: !!(
          enhancedWeatherData.apparentWindSpeed && enhancedWeatherData.apparentWindAngle
        ),
        vesselDataComplete: vesselData.isComplete,
      });

      // Check for performance issues
      if (processingTime > PERFORMANCE.MAX_PROCESSING_TIME.WEATHER_UPDATE) {
        this.logger('warn', 'Weather update took longer than expected', {
          processingTimeMs: processingTime,
          maxAllowedMs: PERFORMANCE.MAX_PROCESSING_TIME.WEATHER_UPDATE,
        });
      }
    } catch (error) {
      this.errorCount++;
      this.consecutiveFailures++;
      const errorMessage = toErrorMessage(error);

      this.logger('error', 'Weather data update failed', {
        error: errorMessage,
        errorCount: this.errorCount,
        consecutiveFailures: this.consecutiveFailures,
        processingTimeMs: Date.now() - startTime,
      });

      this.escalateFetchError(error, errorMessage);

      // Keep last known data on error
      throw error;
    }
  }

  /**
   * Translate a fetch failure into the right operator-facing banner:
   *  - 401: the API key is invalid, so stop the timer and surface "rejected".
   *  - Any other failure (including a 403): surface the underlying error
   *    immediately so the operator sees the cause rather than waiting for the
   *    2x stale-data watchdog. The retry timer keeps running so a transient
   *    fault recovers on its own. The streak count is appended once above one.
   * @private
   */
  private escalateFetchError(error: unknown, errorMessage: string): void {
    if (this.isAuthError(error)) {
      this.apiKeyRejected = true;
      if (this.updateTimer) {
        clearInterval(this.updateTimer);
        this.updateTimer = null;
      }
      this.setBanner(
        'error',
        `AccuWeather rejected the configured API key. Update the key in plugin settings: ${errorMessage}`
      );
      return;
    }
    // Every failure escalates: the underlying error surfaces on the first
    // failed fetch (scheduled-cadence streaks of N would take N x
    // updateFrequency to trip, later than the 2x stale-data watchdog). The
    // `(N consecutive)` suffix gives the cosmetic distinction between the
    // first and subsequent failures; dedupe in the banner sink keeps repeat
    // identical messages from flooding the admin UI.
    const streak = this.consecutiveFailures > 1 ? ` (${this.consecutiveFailures} consecutive)` : '';
    this.setBanner('error', `Weather update failed${streak}: ${errorMessage}`);
  }

  /**
   * Enhance weather data with calculated values. windChill (theoretical, from
   * true wind), heatIndex, and dewPoint are already populated by
   * AccuWeatherService.transformWeatherData. Here we add apparent wind, and
   * the apparent wind chill derived from it: wind chill recomputed against the
   * apparent wind speed the vessel actually experiences once its own motion is
   * folded in.
   * @private
   */
  private enhanceWeatherData(
    weatherData: WeatherData,
    vesselData: VesselNavigationData
  ): WeatherData {
    const { apparentWindSpeed, apparentWindAngle } = this.calculateApparentWindData(
      weatherData,
      vesselData
    );

    // Apparent wind chill: the cold a person on deck feels, using the wind the
    // moving vessel makes. Omitted when no apparent wind speed was derived; the
    // mapper then falls back to the theoretical wind chill.
    const apparentWindChill =
      apparentWindSpeed !== undefined
        ? this.windCalculator.calculateWindChill(weatherData.temperature, apparentWindSpeed)
        : undefined;

    return {
      ...weatherData,
      ...(apparentWindSpeed !== undefined && { apparentWindSpeed }),
      ...(apparentWindAngle !== undefined && { apparentWindAngle }),
      ...(apparentWindChill !== undefined && { apparentWindChill }),
    };
  }

  /**
   * Calculate apparent wind speed and angle based on vessel data
   * @private
   */
  private calculateApparentWindData(
    weatherData: WeatherData,
    vesselData: VesselNavigationData
  ): ApparentWind {
    if (isCompleteNavigationData(vesselData)) {
      return this.calculateApparentWindWithCompleteData(weatherData, vesselData);
    }

    return this.calculateApparentWindFallback(weatherData, vesselData);
  }

  /**
   * Calculate apparent wind with complete vessel data. Calls
   * `calculateWindAnalysis` once so the four shared sin/cos terms inside the
   * calculator are computed a single time per update (the per-getter form
   * would invoke them twice).
   * @private
   */
  private calculateApparentWindWithCompleteData(
    weatherData: WeatherData,
    vesselData: VesselNavigationData & {
      readonly speedOverGround: number;
      readonly courseOverGroundTrue: number;
    }
  ): ApparentWind {
    const { speedOverGround, courseOverGroundTrue } = vesselData;

    try {
      const analysis = this.windCalculator.calculateWindAnalysis(
        weatherData.windSpeed,
        speedOverGround,
        courseOverGroundTrue,
        weatherData.windDirection,
        // Bow-relative angle references true heading when available; course
        // is the fallback. The motion vector always uses course.
        vesselData.headingTrue ?? courseOverGroundTrue
      );

      if (!analysis.isValid) {
        // Validation failure inside the calculator: prefer the heading-only
        // fallback over emitting the calculator's degraded defaults.
        this.logger('warn', 'Apparent wind analysis flagged invalid', {
          validationErrors: analysis.validationErrors,
        });
        return this.calculateApparentWindFallback(weatherData, vesselData);
      }

      this.logger('debug', 'Apparent wind calculated', {
        trueWindSpeed: weatherData.windSpeed,
        vesselSpeed: speedOverGround,
        apparentWindSpeed: analysis.apparentWindSpeed,
        apparentWindAngle: analysis.apparentWindAngle,
      });

      return {
        apparentWindSpeed: analysis.apparentWindSpeed,
        apparentWindAngle: analysis.apparentWindAngle,
      };
    } catch (error) {
      this.logger('warn', 'Failed to calculate apparent wind', {
        error: toErrorMessage(error),
      });

      return this.calculateApparentWindFallback(weatherData, vesselData);
    }
  }

  /**
   * Calculate apparent wind fallback using true wind and vessel heading
   * @private
   */
  private calculateApparentWindFallback(
    weatherData: WeatherData,
    vesselData: VesselNavigationData
  ): ApparentWind {
    if (!vesselData.isComplete) {
      this.logger('debug', 'Cannot calculate apparent wind - incomplete vessel data', {
        hasPosition: !!vesselData.position,
        hasSpeed: typeof vesselData.speedOverGround === 'number',
        hasCourse: typeof vesselData.courseOverGroundTrue === 'number',
        vesselDataAge: vesselData.dataAge,
      });
    }

    const apparentWindSpeed = weatherData.windSpeed;
    const apparentWindAngle = this.calculateApparentWindAngleFromHeading(
      weatherData.windDirection,
      vesselData
    );

    return apparentWindAngle === null
      ? { apparentWindSpeed }
      : { apparentWindSpeed, apparentWindAngle };
  }

  /**
   * Calculate apparent wind angle from vessel heading. Returns null when no heading
   * is available: callers must omit the apparentWindAngle path entirely rather than
   * emitting an absolute bearing as if it were a bow-relative angle.
   * @private
   */
  private calculateApparentWindAngleFromHeading(
    windDirection: number,
    vesselData: VesselNavigationData
  ): number | null {
    const vesselHeading = vesselData.headingTrue ?? vesselData.courseOverGroundTrue;
    if (vesselHeading === undefined) {
      return null;
    }
    return this.windCalculator.normalizeAngle(windDirection - vesselHeading);
  }
}
