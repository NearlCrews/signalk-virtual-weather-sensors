/**
 * Weather Service - Main Orchestration Layer
 * Modern TypeScript implementation coordinating weather data collection and processing
 * Integrates AccuWeather API, vessel navigation data, and wind calculations
 */

import type { ServerAPI } from '@signalk/server-api';
import { WindCalculator } from '../calculators/WindCalculator.js';
import { ERROR_CODES, PERFORMANCE } from '../constants/index.js';
import type {
  GeoLocation,
  Logger,
  PluginConfiguration,
  PluginState,
  VesselNavigationData,
  WeatherData,
} from '../types/index.js';
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
      pluginName: 'signalk-virtual-weather-sensors',
      updateFrequency: this.config.updateFrequency,
      emissionInterval: this.config.emissionInterval,
      enableEventDriven: true,
      useVesselPosition: true,
    });

    // Initialize services — accept injected instances for testability while
    // defaulting to real implementations to keep existing call sites working.
    this.accuWeatherService =
      accuWeatherService ?? new AccuWeatherService(this.config.accuWeatherApiKey, this.logger);

    this.signalKService = signalKService ?? new SignalKService(this.app, this.logger);

    // Use provided wind calculator or create a basic one
    this.windCalculator = windCalculator || this.createBasicWindCalculator();

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
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }, 5000);

      this.state = 'running';
      this.logger('info', 'WeatherService started successfully');

      if (this.app.setPluginStatus) {
        this.app.setPluginStatus('Weather service running');
      }
    } catch (error) {
      this.state = 'error';
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger('error', 'Failed to start WeatherService', {
        error: errorMessage,
      });

      if (this.app.setPluginError) {
        this.app.setPluginError(`Weather service startup failed: ${errorMessage}`);
      }

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

      // Clear cached data
      this.currentWeatherData = null;
      this.lastUpdate = null;

      // Clear service caches
      this.accuWeatherService.clearLocationCache();
      this.signalKService.clearCache();

      this.state = 'stopped';
      this.logger('info', 'WeatherService stopped successfully', {
        updateCount: this.updateCount,
        errorCount: this.errorCount,
      });

      if (this.app.setPluginStatus) {
        this.app.setPluginStatus('Weather service stopped');
      }
    } catch (error) {
      this.state = 'error';
      const errorMessage = error instanceof Error ? error.message : String(error);

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
   * Generate mock weather data for testing
   */
  public generateMockWeatherData(): WeatherData {
    const vesselData = this.signalKService.getVesselNavigationData();

    const baseWeatherData: WeatherData = {
      temperature: 288.15, // 15°C in Kelvin
      pressure: 101325, // Standard sea level pressure in Pascals
      humidity: 0.65, // 65% as ratio (0-1)
      windSpeed: 5.14, // 10 knots in m/s
      windDirection: Math.PI / 2, // 90 degrees in radians (East)
      dewPoint: 283.15, // Calculated dew point in Kelvin
      windChill: 287.5, // Wind chill temperature in Kelvin
      heatIndex: 289.8, // Heat index in Kelvin
      description: 'Mock weather data for testing',
      timestamp: new Date().toISOString(),
      quality: 0.5, // Mock data has lower quality
    };

    // Calculate apparent wind if we have vessel data
    if (vesselData.isComplete && vesselData.speedOverGround && vesselData.courseOverGroundTrue) {
      const apparentWindSpeed = this.windCalculator.calculateApparentWindSpeed(
        baseWeatherData.windSpeed,
        vesselData.speedOverGround,
        vesselData.courseOverGroundTrue,
        baseWeatherData.windDirection
      );

      const apparentWindAngle = this.windCalculator.calculateApparentWindAngle(
        baseWeatherData.windSpeed,
        vesselData.speedOverGround,
        vesselData.courseOverGroundTrue,
        baseWeatherData.windDirection
      );

      return {
        ...baseWeatherData,
        apparentWindSpeed,
        apparentWindAngle,
      };
    }

    return baseWeatherData;
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
          error: error instanceof Error ? error.message : String(error),
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

    try {
      this.logger('debug', 'Starting weather data update');

      // Get position for weather lookup
      const position = this.getWeatherPosition();
      if (!position) {
        throw new Error('No position available for weather data');
      }

      // Fetch weather data from AccuWeather
      const weatherData = await this.accuWeatherService.fetchCurrentWeather(position);

      // Get current vessel navigation data
      const vesselData = this.signalKService.getVesselNavigationData();

      // Calculate enhanced weather values
      const enhancedWeatherData = this.enhanceWeatherData(weatherData, vesselData);

      // Update current data (emission handled by index.ts via NMEA2000PathMapper)
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
      const errorMessage = error instanceof Error ? error.message : String(error);

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
   * Enhance weather data with calculated values
   * @private
   */
  private enhanceWeatherData(
    weatherData: WeatherData,
    vesselData: VesselNavigationData
  ): WeatherData {
    // Only calculate derived values if not already provided by the API
    const windChill =
      weatherData.windChill ??
      this.windCalculator.calculateWindChill(weatherData.temperature, weatherData.windSpeed);
    const heatIndex =
      weatherData.heatIndex ??
      this.windCalculator.calculateHeatIndex(weatherData.temperature, weatherData.humidity);
    const dewPoint =
      weatherData.dewPoint ??
      this.windCalculator.calculateDewPoint(weatherData.temperature, weatherData.humidity);

    const apparentWind = this.calculateApparentWindData(weatherData, vesselData);

    return {
      ...weatherData,
      windChill,
      heatIndex,
      dewPoint,
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
    if (vesselData.isComplete && vesselData.speedOverGround && vesselData.courseOverGroundTrue) {
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
    vesselData: VesselNavigationData
  ): { apparentWindSpeed?: number; apparentWindAngle?: number } {
    const speedOverGround = vesselData.speedOverGround;
    const courseOverGroundTrue = vesselData.courseOverGroundTrue;

    if (speedOverGround === undefined || courseOverGroundTrue === undefined) {
      return this.calculateApparentWindFallback(weatherData, vesselData);
    }

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
        error: error instanceof Error ? error.message : String(error),
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

    return { apparentWindSpeed, apparentWindAngle };
  }

  /**
   * Calculate apparent wind angle from vessel heading
   * @private
   */
  private calculateApparentWindAngleFromHeading(
    windDirection: number,
    vesselData: VesselNavigationData
  ): number {
    const vesselHeading = vesselData.headingTrue ?? vesselData.courseOverGroundTrue;

    if (vesselHeading !== undefined && vesselHeading !== null) {
      return this.windCalculator.normalizeAngle(windDirection - vesselHeading);
    }

    // No heading available - use true wind direction as absolute angle
    return windDirection;
  }

  /**
   * Get position for weather data lookup
   * @private
   */
  private getWeatherPosition(): GeoLocation | null {
    return this.signalKService.getVesselPosition();
  }

  /**
   * Create wind calculator instance
   * @private
   */
  private createBasicWindCalculator(): WindCalculator {
    return new WindCalculator(this.logger);
  }
}
