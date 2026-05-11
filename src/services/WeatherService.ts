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
import { toErrorMessage } from '../utils/conversions.js';
import { AccuWeatherService } from './AccuWeatherService.js';
import { SignalKService } from './SignalKService.js';

/**
 * Public, stable shape returned by `getServiceStatus()` so callers don't
 * depend on the internal types of `AccuWeatherService` / `SignalKService`.
 */
export interface WeatherServiceStatus {
  readonly state: PluginState;
  readonly lastUpdate: Date | null;
  readonly updateCount: number;
  readonly errorCount: number;
  readonly hasWeatherData: boolean;
  readonly signalKHealth: {
    readonly status: PluginState;
    readonly dataAge: number | null;
    readonly isStale: boolean;
    readonly hasComplete: boolean;
  };
  readonly cacheStats: {
    readonly size: number;
  };
  readonly apiRequestCount: number;
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
    this.windCalculator = windCalculator ?? this.createBasicWindCalculator();

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

      this.app.setPluginStatus(PLUGIN.STATUS.SERVICE_RUNNING);
    } catch (error) {
      this.state = 'error';
      const errorMessage = toErrorMessage(error);

      this.logger('error', 'Failed to start WeatherService', {
        error: errorMessage,
      });

      this.app.setPluginError(`Weather service startup failed: ${errorMessage}`);

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

      this.app.setPluginStatus(PLUGIN.STATUS.SERVICE_STOPPED);
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
   * Admin UI status banner string. Format:
   *   "Running, last update Nm ago (N updates, K API requests)"
   * or "Running, awaiting first update" before the first fetch. The API
   * request counter is appended only when non-zero so the pre-fetch and
   * "no requests yet" cases both stay terse. Lives here so the format and
   * the underlying counters stay together.
   *
   * When `dailyApiQuota > 0` the suffix gains a ", K/Q today" segment, where
   * K is the rolling 24h count from `AccuWeatherService.getRequestCountLast24h()`
   * and Q is the configured quota. Crossing `API_QUOTA.WARN_RATIO` switches
   * the banner prefix to a quota-warning variant so operators see the cap is
   * approaching even when no setPluginError is active yet.
   */
  public formatStatusBanner(): string {
    const ageMs = this.getDataAgeMs();
    const prefix = this.shouldShowQuotaWarning()
      ? PLUGIN.STATUS.RUNNING_QUOTA_WARN
      : PLUGIN.STATUS.RUNNING;

    if (ageMs === null) {
      const quotaSuffix = this.formatQuotaSuffix();
      const head = `${prefix}, awaiting first update`;
      return quotaSuffix ? `${head} (${quotaSuffix.replace(/^, /, '')})` : head;
    }
    const ageMin = Math.round(ageMs / 60_000);
    const ageLabel = ageMin <= 0 ? 'just now' : `${ageMin}m ago`;
    const requestCount = this.accuWeatherService.getRequestCount();
    const counters =
      requestCount > 0
        ? `${this.updateCount} updates, ${requestCount} API requests`
        : `${this.updateCount} updates`;
    return `${prefix}, last update ${ageLabel} (${counters}${this.formatQuotaSuffix()})`;
  }

  /**
   * `, K/Q today` segment for the banner suffix when `dailyApiQuota > 0`,
   * otherwise an empty string so the existing format stays byte-identical
   * with the cap disabled. Pulls the rolling 24h count fresh on each call
   * so the displayed value reflects bucket rotation.
   * @private
   */
  private formatQuotaSuffix(): string {
    if (this.config.dailyApiQuota <= 0) return '';
    const used = this.accuWeatherService.getRequestCountLast24h();
    return `, ${used}/${this.config.dailyApiQuota} today`;
  }

  /**
   * True when the rolling 24h request count has crossed `WARN_RATIO` of the
   * configured quota. Returns false when the cap is disabled (`dailyApiQuota = 0`).
   * @private
   */
  private shouldShowQuotaWarning(): boolean {
    if (this.config.dailyApiQuota <= 0) return false;
    const used = this.accuWeatherService.getRequestCountLast24h();
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
        this.errorCount++;
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

    // Daily-quota guard: when the rolling 24h request count meets the cap,
    // skip the fetch entirely. The existing stale-data error path
    // (`emitWeatherTick` in index.ts) takes over once `lastUpdate` ages
    // past `2 * updateFrequency`. We also emit an explicit setPluginError
    // here so operators see WHY the plugin paused (rather than a generic
    // stale-data message) the moment the cap is hit.
    if (this.isQuotaExhausted()) {
      const used = this.accuWeatherService.getRequestCountLast24h();
      const quota = this.config.dailyApiQuota;
      const message = `AccuWeather daily quota reached (${used}/${quota} in last 24h). Pausing fetches until usage drops below the cap.`;
      this.logger('warn', 'Skipping weather update: daily API quota reached', {
        used,
        quota,
      });
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

      this.currentWeatherData = enhancedWeatherData;
      this.lastUpdate = new Date();
      this.updateCount++;

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
      const errorMessage = toErrorMessage(error);

      this.logger('error', 'Weather data update failed', {
        error: errorMessage,
        errorCount: this.errorCount,
        processingTimeMs: Date.now() - startTime,
      });

      // Keep last known data on error
      throw error;
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
  ): { apparentWindSpeed?: number; apparentWindAngle?: number } {
    if (isCompleteNavigationData(vesselData)) {
      return this.calculateApparentWindWithCompleteData(weatherData, vesselData);
    }

    return this.calculateApparentWindFallback(weatherData, vesselData);
  }

  /**
   * Calculate apparent wind with complete vessel data
   * @private
   */
  private calculateApparentWindWithCompleteData(
    weatherData: WeatherData,
    vesselData: VesselNavigationData & {
      readonly speedOverGround: number;
      readonly courseOverGroundTrue: number;
    }
  ): { apparentWindSpeed?: number; apparentWindAngle?: number } {
    const { speedOverGround, courseOverGroundTrue } = vesselData;

    try {
      const apparentWindSpeed = this.windCalculator.calculateApparentWindSpeed(
        weatherData.windSpeed,
        speedOverGround,
        courseOverGroundTrue,
        weatherData.windDirection
      );

      const apparentWindAngle = this.windCalculator.calculateApparentWindAngle(
        weatherData.windSpeed,
        speedOverGround,
        courseOverGroundTrue,
        weatherData.windDirection
      );

      this.logger('debug', 'Apparent wind calculated', {
        trueWindSpeed: weatherData.windSpeed,
        vesselSpeed: speedOverGround,
        apparentWindSpeed,
        apparentWindAngle,
      });

      return { apparentWindSpeed, apparentWindAngle };
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
  ): { apparentWindSpeed?: number; apparentWindAngle?: number } {
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

  /**
   * Create wind calculator instance
   * @private
   */
  private createBasicWindCalculator(): WindCalculator {
    return new WindCalculator(this.logger);
  }
}
