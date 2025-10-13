/**
 * Signal K Virtual Weather Sensors - Main Entry Point
 * Modern TypeScript Signal K plugin providing comprehensive AccuWeather integration
 * with enhanced NMEA2000 environmental measurements and sk-n2k-emitter alignment
 */

import { DEFAULT_CONFIG, ERROR_CODES, PLUGIN } from './constants/index.js';
import { NMEA2000PathMapper } from './mappers/NMEA2000PathMapper.js';
import { WeatherService } from './services/WeatherService.js';
import type { LogLevel, PluginConfiguration, PluginState } from './types/index.js';
import { ConfigurationValidator } from './utils/validation.js';

/**
 * Signal K data value structure
 */
interface SignalKDataValue {
  value: unknown;
  timestamp?: string;
  source?: {
    label?: string;
    type?: string;
    bus?: string;
    src?: string;
  };
}

/**
 * Signal K Server Application Interface
 */
interface SignalKApp {
  debug(...args: unknown[]): void;
  setPluginStatus?: (message: string) => void;
  setPluginError?: (message: string) => void;
  getSelfPath(path: string): SignalKDataValue | null | undefined;
  handleMessage?: (pluginId: string, delta: unknown) => void;
}

/**
 * Plugin instance state
 */
interface PluginInstance {
  weatherService: WeatherService | null;
  pathMapper: NMEA2000PathMapper | null;
  emissionTimer: NodeJS.Timeout | null;
  state: PluginState;
  startTime: Date | null;
  logger: (level: LogLevel, message: string, metadata?: Record<string, unknown>) => void;
}

/**
 * Main plugin factory function
 * @param app Signal K server application instance
 * @returns Signal K plugin interface
 */
export default function createPlugin(app: SignalKApp) {
  const instance: PluginInstance = {
    weatherService: null,
    pathMapper: null,
    emissionTimer: null,
    state: 'stopped',
    startTime: null,
    logger: createLogger(app),
  };

  /**
   * Plugin interface implementation
   */
  const plugin = {
    id: PLUGIN.NAME,
    name: PLUGIN.DISPLAY_NAME,
    description: PLUGIN.DESCRIPTION,

    /**
     * Start the plugin with provided configuration
     */
    start: async (settings: unknown, _restartPlugin?: () => void): Promise<void> => {
      try {
        logPluginStarting(instance, settings);

        if (isPluginAlreadyRunning(instance)) {
          return;
        }

        const config = initializePlugin(instance, settings);
        await startServices(instance, config, app);
        finalizePluginStart(instance, config, app);
      } catch (error) {
        await handleStartupError(instance, error, settings, app);
        throw error;
      }
    },

    /**
     * Stop the plugin and cleanup resources
     */
    stop: async (): Promise<void> => {
      try {
        instance.logger('info', 'Stopping signalk-virtual-weather-sensors plugin');

        instance.state = 'stopping';

        await cleanup(instance);

        const uptime = instance.startTime ? Date.now() - instance.startTime.getTime() : 0;

        instance.state = 'stopped';
        instance.startTime = null;

        if (app.setPluginStatus) {
          app.setPluginStatus('SK to N2K Weather stopped');
        }

        instance.logger('info', 'signalk-virtual-weather-sensors plugin stopped successfully', {
          uptimeMs: uptime,
          finalState: instance.state,
        });
      } catch (error) {
        instance.state = 'error';
        const errorMessage = error instanceof Error ? error.message : String(error);

        instance.logger('error', 'Error stopping plugin', {
          error: errorMessage,
        });

        if (app.setPluginError) {
          app.setPluginError(`signalk-virtual-weather-sensors stop failed: ${errorMessage}`);
        }
      }
    },

    /**
     * Plugin configuration schema for Signal K server UI
     */
    schema: () => ({
      type: 'object',
      properties: {
        accuWeatherApiKey: {
          type: 'string',
          title: 'AccuWeather API Key',
          description: 'Get your API key at https://developer.accuweather.com/',
          default: '',
        },
        updateFrequency: {
          type: 'number',
          title: 'Weather Update Frequency',
          description: 'How often to fetch weather data from AccuWeather API in minutes.',
          default: DEFAULT_CONFIG.UPDATE_FREQUENCY,
          minimum: 1,
          maximum: 60,
        },
        emissionInterval: {
          type: 'number',
          title: 'Broadcast Interval',
          description: 'How often to emit weather data to the NMEA2000 network in seconds.',
          default: DEFAULT_CONFIG.EMISSION_INTERVAL,
          minimum: 1,
          maximum: 60,
        },
      },
      required: ['accuWeatherApiKey'],
    }),

    /**
     * UI schema for better form presentation
     */
    uiSchema: () => ({
      'ui:order': ['accuWeatherApiKey', 'updateFrequency', 'emissionInterval'],
      accuWeatherApiKey: {
        'ui:widget': 'password',
      },
      updateFrequency: {
        'ui:widget': 'updown',
      },
      emissionInterval: {
        'ui:widget': 'updown',
      },
    }),

    /**
     * Get plugin status information
     */
    getStatus: () => {
      if (!instance.weatherService) {
        return { state: instance.state, message: 'Weather service not initialized' };
      }

      const status = instance.weatherService.getServiceStatus();
      const uptime = instance.startTime ? Date.now() - instance.startTime.getTime() : 0;

      return {
        state: status.state,
        uptime,
        lastUpdate: status.lastUpdate,
        lastEmission: status.lastEmission,
        updateCount: status.updateCount,
        emissionCount: status.emissionCount,
        errorCount: status.errorCount,
        hasWeatherData: status.hasWeatherData,
        enhancedFieldCount: getEnhancedFieldCount(),
        signalKHealth: status.signalKHealth,
        cacheStats: status.cacheStats,
      };
    },
  };

  return plugin;
}

/**
 * Log plugin starting message
 * @private
 */
function logPluginStarting(instance: PluginInstance, settings: unknown): void {
  instance.logger('info', 'Starting signalk-virtual-weather-sensors plugin', {
    version: PLUGIN.VERSION,
    settings: typeof settings === 'object' ? Object.keys(settings || {}) : 'invalid',
  });
}

/**
 * Check if plugin is already running
 * @private
 */
function isPluginAlreadyRunning(instance: PluginInstance): boolean {
  if (instance.state === 'running') {
    instance.logger('warn', 'Plugin already running');
    return true;
  }
  return false;
}

/**
 * Initialize plugin and validate configuration
 * @private
 */
function initializePlugin(instance: PluginInstance, settings: unknown): PluginConfiguration {
  instance.state = 'starting';
  instance.startTime = new Date();
  return validateAndNormalizeSettings(settings, instance.logger);
}

/**
 * Start services and setup emission system
 * @private
 */
async function startServices(
  instance: PluginInstance,
  config: PluginConfiguration,
  app: SignalKApp
): Promise<void> {
  // Initialize services
  instance.weatherService = new WeatherService(app, config, instance.logger);
  instance.pathMapper = new NMEA2000PathMapper(instance.logger);

  // Start weather service
  await instance.weatherService.start();

  // Setup enhanced emission system
  setupEnhancedEmissionSystem(instance, config, app);
}

/**
 * Finalize plugin start and update status
 * @private
 */
function finalizePluginStart(
  instance: PluginInstance,
  config: PluginConfiguration,
  app: SignalKApp
): void {
  instance.state = 'running';

  if (app.setPluginStatus) {
    app.setPluginStatus(
      `SK to N2K Weather running - Enhanced with ${getEnhancedFieldCount()} data points`
    );
  }

  instance.logger('info', 'signalk-virtual-weather-sensors plugin started successfully', {
    enhancedFields: getEnhancedFieldCount(),
    emissionInterval: config.emissionInterval,
    updateFrequency: config.updateFrequency,
    hybridMode: true,
  });
}

/**
 * Handle startup errors
 * @private
 */
async function handleStartupError(
  instance: PluginInstance,
  error: unknown,
  settings: unknown,
  app: SignalKApp
): Promise<void> {
  instance.state = 'error';
  const errorMessage = error instanceof Error ? error.message : String(error);

  instance.logger('error', 'Failed to start plugin', {
    error: errorMessage,
    settings: typeof settings === 'object' ? settings : 'invalid',
  });

  if (app.setPluginError) {
    app.setPluginError(`signalk-virtual-weather-sensors startup failed: ${errorMessage}`);
  }

  await cleanup(instance);
}

/**
 * Setup enhanced emission system with hybrid event-driven + interval approach
 * @private
 */
function setupEnhancedEmissionSystem(
  instance: PluginInstance,
  config: PluginConfiguration,
  app: SignalKApp
): void {
  const emissionInterval = config.emissionInterval * 1000; // Convert seconds to milliseconds

  // Setup interval-based emission (NMEA2000 compatibility)
  instance.emissionTimer = setInterval(() => {
    try {
      const weatherData = instance.weatherService?.getCurrentWeatherData();
      if (weatherData && instance.pathMapper) {
        // Create enhanced NMEA2000 delta message
        const delta = instance.pathMapper.mapToSignalKPaths(weatherData);

        // Emit to Signal K server
        if (app.handleMessage) {
          app.handleMessage(PLUGIN.NAME, delta);
        }

        instance.logger('debug', 'Enhanced weather data emitted', {
          pathCount: delta.updates[0]?.values?.length || 0,
          emissionInterval: config.emissionInterval,
        });
      }
    } catch (error) {
      instance.logger('error', 'Error in emission timer', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, emissionInterval);

  instance.logger('info', 'Enhanced emission system configured', {
    intervalSeconds: config.emissionInterval,
    hybridMode: true,
    enhancedFields: getEnhancedFieldCount(),
  });
}

/**
 * Cleanup plugin resources
 * @private
 */
async function cleanup(instance: PluginInstance): Promise<void> {
  // Clear emission timer
  if (instance.emissionTimer) {
    clearInterval(instance.emissionTimer);
    instance.emissionTimer = null;
  }

  // Stop weather service
  if (instance.weatherService) {
    try {
      await instance.weatherService.stop();
    } catch (error) {
      instance.logger('error', 'Error stopping weather service', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    instance.weatherService = null;
  }

  // Clear path mapper
  instance.pathMapper = null;
}

/**
 * Validate and normalize plugin settings
 * @private
 */
function validateAndNormalizeSettings(
  settings: unknown,
  logger: (level: LogLevel, message: string, metadata?: Record<string, unknown>) => void
): PluginConfiguration {
  // Type check settings
  if (!settings || typeof settings !== 'object') {
    throw new Error(`${ERROR_CODES.CONFIGURATION.INVALID_API_KEY}: Invalid plugin configuration`);
  }

  const rawSettings = settings as Record<string, unknown>;

  // Create mutable configuration object
  const configBuilder: Record<string, unknown> = {
    accuWeatherApiKey:
      typeof rawSettings.accuWeatherApiKey === 'string' ? rawSettings.accuWeatherApiKey : '',
    updateFrequency:
      typeof rawSettings.updateFrequency === 'number'
        ? rawSettings.updateFrequency
        : DEFAULT_CONFIG.UPDATE_FREQUENCY,
    emissionInterval:
      typeof rawSettings.emissionInterval === 'number'
        ? rawSettings.emissionInterval
        : DEFAULT_CONFIG.EMISSION_INTERVAL,
  };

  const partialConfig = configBuilder as Partial<PluginConfiguration>;

  // Validate configuration
  const validation = ConfigurationValidator.validateConfiguration(partialConfig);
  if (!validation.isValid) {
    const errorMessage = validation.errors.join('; ');
    logger('error', 'Configuration validation failed', {
      errors: validation.errors,
      warnings: validation.warnings,
    });
    throw new Error(`${ERROR_CODES.CONFIGURATION.INVALID_API_KEY}: ${errorMessage}`);
  }

  if (validation.warnings.length > 0) {
    logger('warn', 'Configuration validation warnings', {
      warnings: validation.warnings,
    });
  }

  // Sanitize and return final configuration
  const finalConfig = ConfigurationValidator.sanitizeConfiguration(partialConfig);

  logger('info', 'Plugin configuration validated and normalized', {
    updateFrequency: finalConfig.updateFrequency,
    emissionInterval: finalConfig.emissionInterval,
    enableEventDriven: true,
    useVesselPosition: true,
    enhancedFieldsAvailable: getEnhancedFieldCount(),
  });

  return finalConfig;
}

/**
 * Create structured logger with plugin context
 * @private
 */
function createLogger(app: SignalKApp) {
  return (level: LogLevel, message: string, metadata?: Record<string, unknown>) => {
    const logMessage = `[${PLUGIN.NAME}] ${message}`;
    const logMetadata = metadata ? ` | ${JSON.stringify(metadata)}` : '';

    switch (level) {
      case 'debug':
        app.debug(`${logMessage}${logMetadata}`);
        break;
      case 'info':
        app.debug(`INFO: ${logMessage}${logMetadata}`);
        break;
      case 'warn':
        app.debug(`WARN: ${logMessage}${logMetadata}`);
        break;
      case 'error':
        app.debug(`ERROR: ${logMessage}${logMetadata}`);
        break;
    }
  };
}

/**
 * Get count of enhanced fields for status reporting
 * @private
 */
function getEnhancedFieldCount(): number {
  // Count of enhanced fields beyond basic weather data (8 basic → 24+ enhanced)
  return 24;
}

// Export plugin metadata for Signal K compatibility
export const metadata = {
  id: PLUGIN.NAME,
  name: PLUGIN.DISPLAY_NAME,
  version: PLUGIN.VERSION,
  description: PLUGIN.DESCRIPTION,
  author: PLUGIN.AUTHOR,
  keywords: [
    'signalk-node-server-plugin',
    'signalk-category-weather',
    'nmea2000',
    'weather',
    'accuweather',
    'typescript',
    'enhanced',
  ],
} as const;
