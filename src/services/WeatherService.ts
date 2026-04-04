/**
 * Weather Service - Main Orchestration Layer
 * Modern TypeScript implementation coordinating weather data collection and processing
 * Integrates AccuWeather API, vessel navigation data, and wind calculations
 */

import type { ServerAPI } from '@signalk/server-api';
import { WindCalculator } from '../calculators/WindCalculator.js';
import { ERROR_CODES, PERFORMANCE, SIGNALK_PATHS } from '../constants/index.js';
import type {
  GeoLocation,
  LogLevel,
  PluginConfiguration,
  PluginState,
  VesselNavigationData,
  WeatherData,
} from '../types/index.js';
import { AccuWeatherService } from './AccuWeatherService.js';
import { SignalKService } from './SignalKService.js';

/**
 * Main Weather Service orchestrating all weather data operations
 * Coordinates AccuWeather API, vessel navigation, and wind calculations
 */
export class WeatherService {
  private readonly app: ServerAPI;
  private readonly config: PluginConfiguration;
  private readonly logger: (
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>
  ) => void;

  private readonly accuWeatherService: AccuWeatherService;
  private readonly signalKService: SignalKService;
  private readonly windCalculator: WindCalculator;

  private state: PluginState = 'stopped';
  private updateTimer: NodeJS.Timeout | null = null;
  private emissionTimer: NodeJS.Timeout | null = null;

  private currentWeatherData: WeatherData | null = null;
  private lastUpdate: Date | null = null;
  private lastEmission: Date | null = null;

  // Performance monitoring
  private updateCount = 0;
  private emissionCount = 0;
  private errorCount = 0;

  constructor(
    app: ServerAPI,
    config: PluginConfiguration,
    logger: (
      level: LogLevel,
      message: string,
      metadata?: Record<string, unknown>
    ) => void = () => {},
    windCalculator?: WindCalculator
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

    // Initialize services
    this.accuWeatherService = new AccuWeatherService(this.config.accuWeatherApiKey, this.logger);

    this.signalKService = new SignalKService(this.app, this.logger);

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

      // Perform initial weather update after brief delay
      setTimeout(() => {
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

      // Clear all timers
      if (this.updateTimer) {
        clearInterval(this.updateTimer);
        this.updateTimer = null;
      }

      if (this.emissionTimer) {
        clearInterval(this.emissionTimer);
        this.emissionTimer = null;
      }

      // Clear cached data
      this.currentWeatherData = null;
      this.lastUpdate = null;
      this.lastEmission = null;

      // Clear service caches
      this.accuWeatherService.clearLocationCache();
      this.signalKService.clearCache();

      this.state = 'stopped';
      this.logger('info', 'WeatherService stopped successfully', {
        updateCount: this.updateCount,
        emissionCount: this.emissionCount,
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
  public getServiceStatus(): {
    state: PluginState;
    lastUpdate: Date | null;
    lastEmission: Date | null;
    updateCount: number;
    emissionCount: number;
    errorCount: number;
    hasWeatherData: boolean;
    signalKHealth: ReturnType<SignalKService['getHealthStatus']>;
    cacheStats: ReturnType<AccuWeatherService['getCacheStats']>;
  } {
    return {
      state: this.state,
      lastUpdate: this.lastUpdate,
      lastEmission: this.lastEmission,
      updateCount: this.updateCount,
      emissionCount: this.emissionCount,
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
      const enhancedWeatherData = await this.enhanceWeatherData(weatherData, vesselData);

      // Update current data and emit if event-driven mode is enabled
      const previousData = this.currentWeatherData;
      this.currentWeatherData = enhancedWeatherData;
      this.lastUpdate = new Date();
      this.updateCount++;

      // Emit immediately if data has changed significantly
      if (this.shouldEmitOnChange(previousData, enhancedWeatherData)) {
        this.emitWeatherData(enhancedWeatherData);
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
  private async enhanceWeatherData(
    weatherData: WeatherData,
    vesselData: VesselNavigationData
  ): Promise<WeatherData> {
    const windChill = this.windCalculator.calculateWindChill(
      weatherData.temperature,
      weatherData.windSpeed
    );
    // Humidity is already a ratio (0-1)
    const heatIndex = this.windCalculator.calculateHeatIndex(
      weatherData.temperature,
      weatherData.humidity
    );
    const dewPoint = this.windCalculator.calculateDewPoint(
      weatherData.temperature,
      weatherData.humidity
    );

    const apparentWind = this.calculateApparentWindData(weatherData, vesselData);

    const result: WeatherData = {
      ...weatherData,
      windChill,
      heatIndex,
      dewPoint,
    };

    // Only add optional properties if they have values
    if (apparentWind.apparentWindSpeed !== undefined) {
      Object.assign(result, { apparentWindSpeed: apparentWind.apparentWindSpeed });
    }
    if (apparentWind.apparentWindAngle !== undefined) {
      Object.assign(result, { apparentWindAngle: apparentWind.apparentWindAngle });
    }

    return result;
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
    const vesselHeading = vesselData.headingTrue || vesselData.courseOverGroundTrue;

    if (vesselHeading !== undefined && vesselHeading !== null) {
      return this.normalizeAngle(windDirection - vesselHeading);
    }

    // No heading available - use true wind direction as absolute angle
    return windDirection;
  }

  /**
   * Normalize angle to -π to π range
   * @private
   */
  private normalizeAngle(angle: number): number {
    let normalized = angle;
    while (normalized > Math.PI) normalized -= 2 * Math.PI;
    while (normalized < -Math.PI) normalized += 2 * Math.PI;
    return normalized;
  }

  /**
   * Emit weather data to Signal K
   * @private
   */
  private emitWeatherData(weatherData: WeatherData): void {
    try {
      if (!this.app.handleMessage) {
        this.logger('warn', 'Signal K handleMessage not available');
        return;
      }

      // Create Signal K delta message (this will be implemented in path mapping step)
      const delta = this.createSignalKDelta(weatherData);

      // Cast delta to match ServerAPI.handleMessage parameter type
      this.app.handleMessage(
        'signalk-virtual-weather-sensors',
        delta as Parameters<ServerAPI['handleMessage']>[1]
      );

      this.lastEmission = new Date();
      this.emissionCount++;

      this.logger('debug', 'Weather data emitted to Signal K', {
        emissionCount: this.emissionCount,
      });
    } catch (error) {
      this.logger('error', 'Failed to emit weather data', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Create comprehensive Signal K delta message with enhanced AccuWeather mappings
   * @private
   */
  private createSignalKDelta(weatherData: WeatherData): unknown {
    const values: Array<{ path: string; value: unknown }> = [];

    this.addCoreEnvironmentalData(values, weatherData);
    this.addEnhancedTemperatureData(values, weatherData);
    this.addWindData(values, weatherData);
    this.addAtmosphericData(values, weatherData);
    this.addPrecipitationData(values, weatherData);

    this.logger('debug', 'Created enhanced Signal K delta message', {
      totalPaths: values.length,
      enhancedFields: this.countEnhancedFieldsInDelta(values),
    });

    return {
      context: 'vessels.self',
      updates: [
        {
          timestamp: weatherData.timestamp,
          values,
        },
      ],
    };
  }

  /**
   * Add core environmental measurements to Signal K delta
   * @private
   */
  private addCoreEnvironmentalData(
    values: Array<{ path: string; value: unknown }>,
    weatherData: WeatherData
  ): void {
    values.push(
      { path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.TEMPERATURE, value: weatherData.temperature },
      { path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRESSURE, value: weatherData.pressure },
      { path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.RELATIVE_HUMIDITY, value: weatherData.humidity },
      // Also emit as 'humidity' for emitter-cannon HUMIDITY_OUTSIDE PGN generator compatibility
      { path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.HUMIDITY, value: weatherData.humidity }
    );
  }

  /**
   * Add enhanced temperature readings to Signal K delta
   * @private
   */
  private addEnhancedTemperatureData(
    values: Array<{ path: string; value: unknown }>,
    weatherData: WeatherData
  ): void {
    const temperatureFields = [
      { data: weatherData.dewPoint, path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.DEW_POINT_TEMPERATURE },
      {
        data: weatherData.windChill,
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.WIND_CHILL_TEMPERATURE,
      },
      {
        data: weatherData.heatIndex,
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.HEAT_INDEX_TEMPERATURE,
      },
      { data: weatherData.realFeelShade, path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.REAL_FEEL_SHADE },
      {
        data: weatherData.wetBulbTemperature,
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.WET_BULB_TEMPERATURE,
      },
      {
        data: weatherData.wetBulbGlobeTemperature,
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.WET_BULB_GLOBE_TEMPERATURE,
      },
      {
        data: weatherData.apparentTemperature,
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.APPARENT_TEMPERATURE,
      },
      {
        data: weatherData.temperatureDeparture24h,
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.TEMPERATURE_DEPARTURE_24H,
      },
      {
        data: weatherData.heatStressIndex,
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.HEAT_STRESS_INDEX,
      },
    ];

    for (const field of temperatureFields) {
      if (field.data !== undefined) {
        values.push({ path: field.path, value: field.data });
      }
    }
  }

  /**
   * Add wind data to Signal K delta
   * @private
   */
  private addWindData(
    values: Array<{ path: string; value: unknown }>,
    weatherData: WeatherData
  ): void {
    // Core wind measurements
    values.push(
      { path: SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_TRUE, value: weatherData.windSpeed },
      { path: SIGNALK_PATHS.ENVIRONMENT.WIND.DIRECTION_TRUE, value: weatherData.windDirection },
      // speedOverGround mirrors speedTrue for weather API data (no water current distinction)
      // Required by emitter-cannon WIND_TRUE_GROUND PGN generator
      { path: SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_OVER_GROUND, value: weatherData.windSpeed }
    );

    // Enhanced wind measurements
    const windFields = [
      { data: weatherData.windGustSpeed, path: SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_GUST },
      { data: weatherData.windGustFactor, path: SIGNALK_PATHS.ENVIRONMENT.WIND.GUST_FACTOR },
      { data: weatherData.beaufortScale, path: SIGNALK_PATHS.ENVIRONMENT.WIND.BEAUFORT_SCALE },
      { data: weatherData.apparentWindSpeed, path: SIGNALK_PATHS.ENVIRONMENT.WIND.SPEED_APPARENT },
    ];

    for (const field of windFields) {
      if (field.data !== undefined) {
        values.push({ path: field.path, value: field.data });
      }
    }

    this.addApparentWindAngleData(values, weatherData);
    this.addMagneticWindDirection(values, weatherData);
  }

  /**
   * Add apparent wind angle and direction to Signal K delta
   * @private
   */
  private addApparentWindAngleData(
    values: Array<{ path: string; value: unknown }>,
    weatherData: WeatherData
  ): void {
    if (weatherData.apparentWindAngle === undefined) {
      return;
    }

    values.push(
      {
        path: SIGNALK_PATHS.ENVIRONMENT.WIND.ANGLE_APPARENT,
        value: weatherData.apparentWindAngle,
      },
      // angleTrueWater mirrors apparentWindAngle for weather API data
      // Required by emitter-cannon WIND_TRUE PGN generator
      {
        path: SIGNALK_PATHS.ENVIRONMENT.WIND.ANGLE_TRUE_WATER,
        value: weatherData.apparentWindAngle,
      }
    );

    const vesselData = this.signalKService.getVesselNavigationData();
    const vesselHeading = vesselData.headingTrue || vesselData.courseOverGroundTrue;

    if (vesselHeading !== undefined && vesselHeading !== null) {
      const apparentWindDirection = this.windCalculator.calculateWindDirectionHeading(
        vesselHeading,
        weatherData.apparentWindAngle
      );
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.WIND.DIRECTION_APPARENT,
        value: apparentWindDirection,
      });
    }
  }

  /**
   * Add magnetic wind direction to Signal K delta
   * @private
   */
  private addMagneticWindDirection(
    values: Array<{ path: string; value: unknown }>,
    weatherData: WeatherData
  ): void {
    const magneticVariation = this.signalKService.getVesselNavigationData().magneticVariation;

    if (magneticVariation !== undefined && magneticVariation !== null) {
      const directionMagnetic = this.windCalculator.calculateWindDirectionMagnetic(
        weatherData.windDirection,
        magneticVariation
      );
      values.push({
        path: SIGNALK_PATHS.ENVIRONMENT.WIND.DIRECTION_MAGNETIC,
        value: directionMagnetic,
      });
    }
  }

  /**
   * Add atmospheric conditions to Signal K delta
   * @private
   */
  private addAtmosphericData(
    values: Array<{ path: string; value: unknown }>,
    weatherData: WeatherData
  ): void {
    const atmosphericFields = [
      { data: weatherData.uvIndex, path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.UV_INDEX },
      { data: weatherData.visibility, path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.VISIBILITY },
      { data: weatherData.cloudCover, path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.CLOUD_COVER },
      { data: weatherData.cloudCeiling, path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.CLOUD_CEILING },
      {
        data: weatherData.pressureTendency,
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRESSURE_TENDENCY,
      },
      {
        data: weatherData.absoluteHumidity,
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.ABSOLUTE_HUMIDITY,
      },
      { data: weatherData.airDensityEnhanced, path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.AIR_DENSITY },
    ];

    for (const field of atmosphericFields) {
      if (field.data !== undefined) {
        values.push({ path: field.path, value: field.data });
      }
    }
  }

  /**
   * Add precipitation data to Signal K delta
   * @private
   */
  private addPrecipitationData(
    values: Array<{ path: string; value: unknown }>,
    weatherData: WeatherData
  ): void {
    const precipitationFields = [
      {
        data: weatherData.precipitationLastHour,
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRECIPITATION_LAST_HOUR,
      },
      {
        data: weatherData.precipitationCurrent,
        path: SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRECIPITATION_CURRENT,
      },
    ];

    for (const field of precipitationFields) {
      if (field.data !== undefined) {
        values.push({ path: field.path, value: field.data });
      }
    }
  }

  /**
   * Count enhanced fields in delta message for logging
   * @private
   */
  private countEnhancedFieldsInDelta(values: Array<{ path: string; value: unknown }>): number {
    const enhancedPaths = [
      'realFeelShade',
      'wetBulbTemperature',
      'wetBulbGlobeTemperature',
      'indoorHumidity',
      'windGust',
      'uvIndex',
      'visibility',
      'cloudCover',
      'beaufortScale',
      'absoluteHumidity',
    ];

    return values.filter((v) => enhancedPaths.some((enhancedPath) => v.path.includes(enhancedPath)))
      .length;
  }

  /**
   * Determine if weather data change is significant enough for immediate emission
   * @private
   */
  private shouldEmitOnChange(previous: WeatherData | null, current: WeatherData): boolean {
    if (!previous) return true;

    // Define thresholds for significant changes
    const tempThreshold = 1; // 1 Kelvin
    const pressureThreshold = 100; // 100 Pascals
    const windSpeedThreshold = 1; // 1 m/s

    return (
      Math.abs(current.temperature - previous.temperature) > tempThreshold ||
      Math.abs(current.pressure - previous.pressure) > pressureThreshold ||
      Math.abs(current.windSpeed - previous.windSpeed) > windSpeedThreshold
    );
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
