/**
 * Weather Service - Main Orchestration Layer
 * Modern TypeScript implementation coordinating weather data collection and processing
 * Integrates AccuWeather API, vessel navigation data, and wind calculations
 */

import type { ServerAPI } from '@signalk/server-api';
import { WindCalculator } from '../calculators/WindCalculator.js';
import { API_QUOTA, ERROR_CODES, PERFORMANCE, PLUGIN } from '../constants/index.js';
import {
  isCompleteNavigationData,
  type Logger,
  type PluginConfiguration,
  type PluginState,
  type VesselNavigationData,
  type WeatherData,
} from '../types/index.js';
import { msToWholeMinutes, toErrorMessage } from '../utils/conversions.js';
import { AccuWeatherService } from './AccuWeatherService.js';
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
  readonly cacheStats: ReturnType<AccuWeatherService['getCacheStats']>;
  readonly apiRequestCount: number;
}

/** Apparent-wind result. Either field is absent when it cannot be derived. */
interface ApparentWind {
  readonly apparentWindSpeed?: number;
  readonly apparentWindAngle?: number;
}

/**
 * Main Weather Service orchestrating all weather data operations
 * Coordinates AccuWeather API, vessel navigation, and wind calculations
 */
export class WeatherService {
  private readonly app: ServerAPI;
  private readonly config: PluginConfiguration;
  private readonly logger: Logger;

  private readonly accuWeatherService: AccuWeatherService;
  private readonly signalKService: SignalKService;
  private readonly windCalculator: WindCalculator;

  private state: PluginState = 'stopped';
  private updateTimer: NodeJS.Timeout | null = null;
  private initialUpdateTimer: NodeJS.Timeout | null = null;

  private currentWeatherData: WeatherData | null = null;
  private lastUpdate: Date | null = null;

  // Performance monitoring
  private updateCount = 0;
  private errorCount = 0;
  /**
   * Consecutive fetch failures since the last success. Once it crosses
   * `CONSECUTIVE_FAILURE_LIMIT`, a `setPluginError` is published so operators
   * see the underlying error rather than the stale-data banner kicking in
   * after 2x updateFrequency.
   */
  private consecutiveFailures = 0;
  /**
   * True once an AccuWeather 401/403 has been seen: the key is wrong or the
   * plan is revoked, so retrying burns quota with no chance of success. The
   * update timer is cleared and subsequent forceUpdate calls return early.
   */
  private apiKeyRejected = false;

  constructor(
    app: ServerAPI,
    config: PluginConfiguration,
    logger: Logger = () => {},
    windCalculator?: WindCalculator,
    accuWeatherService?: AccuWeatherService,
    signalKService?: SignalKService
  ) {
    this.app = app;
    this.config = config;
    this.logger = logger;

    this.logger('info', 'WeatherService initializing', {
      pluginName: PLUGIN.NAME,
      updateFrequency: this.config.updateFrequency,
      emissionInterval: this.config.emissionInterval,
      enableEventDriven: true,
      useVesselPosition: true,
    });

    this.accuWeatherService =
      accuWeatherService ?? new AccuWeatherService(this.config.accuWeatherApiKey, this.logger);
    this.signalKService = signalKService ?? new SignalKService(this.app, this.logger);
    this.windCalculator = windCalculator ?? new WindCalculator(this.logger);

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
      // cache: it has a 2-hour TTL by design and refetching on every restart
      // burns paid LOCATION_SEARCH API calls. Per-instance memory gets GC'd
      // when the service is dropped anyway.
      this.currentWeatherData = null;
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

  /**
   * Cheap accessor for the emission timer's stale-data check, so it doesn't
   * have to construct the full WeatherServiceStatus on every tick.
   */
  public getLastUpdate(): Date | null {
    return this.lastUpdate;
  }

  /** Milliseconds since the last successful weather fetch, or null if none yet. */
  public getDataAgeMs(): number | null {
    return this.lastUpdate ? Date.now() - this.lastUpdate.getTime() : null;
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
    const used = this.accuWeatherService.getRequestCountLast24h();
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
    if (this.config.dailyApiQuota <= 0) return false;
    return used / this.config.dailyApiQuota >= API_QUOTA.WARN_RATIO;
  }

  /**
   * True when the rolling 24h request count has reached the configured cap.
   * Used by `updateWeatherData` to short-circuit fetches; the existing
   * stale-data error path then surfaces the pause to operators.
   */
  public isQuotaExhausted(): boolean {
    if (this.config.dailyApiQuota <= 0) return false;
    const used = this.accuWeatherService.getRequestCountLast24h();
    return used / this.config.dailyApiQuota >= API_QUOTA.EXHAUST_RATIO;
  }

  /**
   * Operator-facing message used when fetches are paused at the daily quota.
   * Public so the emission tick can re-push the same wording instead of
   * letting a periodic setPluginStatus call silently overwrite the error.
   */
  public formatQuotaExhaustedMessage(): string {
    const used = this.accuWeatherService.getRequestCountLast24h();
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
   * Force immediate weather data update
   */
  public async forceUpdate(): Promise<void> {
    this.logger('info', 'Forcing immediate weather update');
    await this.updateWeatherData();
  }

  /**
   * Trip threshold for the fetch-failure escalation in `updateWeatherData`.
   * Set to 1 so the underlying error surfaces on the first failed fetch: at
   * the scheduled cadence three failures take 3x updateFrequency, which is
   * later than the 2x stale-data watchdog, so a higher threshold would never
   * beat the generic stale banner to the operator.
   */
  private static readonly CONSECUTIVE_FAILURE_LIMIT = 1;

  /**
   * Substrings tagged onto error messages by `AccuWeatherService.handleApiError`
   * that indicate the configured API key is wrong, revoked, or out of plan.
   * These errors are not retryable: any subsequent fetch would also fail and
   * burn quota.
   */
  private static readonly AUTH_ERROR_CODES: ReadonlyArray<string> = [
    ERROR_CODES.NETWORK.API_UNAUTHORIZED,
    ERROR_CODES.NETWORK.API_FORBIDDEN,
  ];

  private isAuthError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return WeatherService.AUTH_ERROR_CODES.some((code) => error.message.includes(code));
  }

  /**
   * Calculate interval with jitter to avoid synchronized API requests
   * Adds ±10% random variation to the interval
   * @private
   */
  private addJitter(baseInterval: number): number {
    const jitterRange = baseInterval * 0.1; // ±10% jitter
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
   * Update weather data from AccuWeather API
   * @private
   */
  private async updateWeatherData(): Promise<void> {
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
      this.app.setPluginError(message);
      return;
    }

    try {
      this.logger('debug', 'Starting weather data update');

      // Single navigation read also yields position: avoids fetching twice.
      const vesselData = this.signalKService.getVesselNavigationData();
      const position = vesselData.position
        ? {
            latitude: vesselData.position.latitude,
            longitude: vesselData.position.longitude,
          }
        : this.signalKService.getVesselPosition();
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

      // Cold-start UX: the plugin entry pushes "Running, awaiting first update"
      // during start(), and the emission timer wouldn't re-push the banner
      // until its next tick (up to emissionInterval seconds away). Push the
      // live banner here so the "awaiting" string flips the instant the first
      // fetch lands. Subsequent updates rely on the emission tick's dedupe to
      // avoid double-pushes within the same minute.
      if (isFirstSuccessfulUpdate) {
        this.app.setPluginStatus(this.formatStatusBanner());
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
   *  - 401/403: the key is dead, so stop the timer and surface "rejected".
   *  - Any non-auth failure: surface the underlying error immediately so the
   *    operator sees the cause rather than waiting for the 2x stale-data
   *    watchdog. The running streak count is appended once it exceeds one.
   * @private
   */
  private escalateFetchError(error: unknown, errorMessage: string): void {
    if (this.isAuthError(error)) {
      this.apiKeyRejected = true;
      if (this.updateTimer) {
        clearInterval(this.updateTimer);
        this.updateTimer = null;
      }
      this.app.setPluginError(
        `AccuWeather rejected the configured API key. Update the key in plugin settings: ${errorMessage}`
      );
      return;
    }
    if (this.consecutiveFailures >= WeatherService.CONSECUTIVE_FAILURE_LIMIT) {
      const streak =
        this.consecutiveFailures > 1 ? ` (${this.consecutiveFailures} consecutive)` : '';
      this.app.setPluginError(`Weather update failed${streak}: ${errorMessage}`);
    }
  }

  /**
   * Enhance weather data with calculated values. windChill/heatIndex/dewPoint are
   * already populated by AccuWeatherService.transformWeatherData, so we only add
   * apparent-wind here.
   * @private
   */
  private enhanceWeatherData(
    weatherData: WeatherData,
    vesselData: VesselNavigationData
  ): WeatherData {
    const apparentWind = this.calculateApparentWindData(weatherData, vesselData);

    if (
      apparentWind.apparentWindSpeed === undefined &&
      apparentWind.apparentWindAngle === undefined
    ) {
      return weatherData;
    }

    return {
      ...weatherData,
      ...(apparentWind.apparentWindSpeed !== undefined && {
        apparentWindSpeed: apparentWind.apparentWindSpeed,
      }),
      ...(apparentWind.apparentWindAngle !== undefined && {
        apparentWindAngle: apparentWind.apparentWindAngle,
      }),
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
    if (vesselHeading === undefined || vesselHeading === null) {
      return null;
    }
    return this.windCalculator.normalizeAngle(windDirection - vesselHeading);
  }
}
