/**
 * Signal K Virtual Weather Sensors - Main Entry Point
 * Modern TypeScript Signal K plugin providing comprehensive AccuWeather integration
 * with enhanced NMEA2000 environmental measurements and emitter-cannon alignment
 *
 * Uses official @signalk/server-api types for maximum compatibility
 */

import type { Delta, Plugin, ServerAPI } from '@signalk/server-api';
import { DEFAULT_CONFIG, ERROR_CODES, PLUGIN } from './constants/index.js';
import { NMEA2000PathMapper } from './mappers/NMEA2000PathMapper.js';
import { WeatherService } from './services/WeatherService.js';
import type {
  Logger,
  LogLevel,
  PluginConfiguration,
  PluginState,
  WeatherData,
} from './types/index.js';
import { ConfigurationValidator } from './utils/validation.js';

/**
 * Plugin instance state
 */
interface PluginInstance {
  weatherService: WeatherService | null;
  pathMapper: NMEA2000PathMapper | null;
  emissionTimer: NodeJS.Timeout | null;
  state: PluginState;
  startTime: Date | null;
  logger: Logger;
  /** Cached delta to avoid rebuilding on every emission tick */
  cachedDelta: Delta | null;
  cachedWeatherDataRef: WeatherData | null;
}

/**
 * Main plugin factory function
 * Implements the official SignalK PluginConstructor pattern
 * @param app Signal K server application instance (ServerAPI)
 * @returns Signal K Plugin interface
 */
export default function createPlugin(app: ServerAPI): Plugin {
  const instance: PluginInstance = {
    weatherService: null,
    pathMapper: null,
    emissionTimer: null,
    state: 'stopped',
    startTime: null,
    logger: createLogger(app),
    cachedDelta: null,
    cachedWeatherDataRef: null,
  };

  /**
   * Plugin interface implementation
   * Conforms to @signalk/server-api Plugin interface
   */
  const plugin: Plugin = {
    id: PLUGIN.NAME,
    name: PLUGIN.DISPLAY_NAME,
    description: PLUGIN.DESCRIPTION,

    /**
     * Start the plugin with provided configuration
     */
    start: async (
      settings: object,
      _restartPlugin: (newConfiguration: object) => void
    ): Promise<void> => {
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
      title: 'Virtual Weather Sensors',
      description: 'AccuWeather → Signal K with NMEA2000-compatible environmental measurements.',
      properties: {
        accuWeatherApiKey: {
          type: 'string',
          title: 'AccuWeather API Key',
          description: 'Get your API key at https://developer.accuweather.com/',
          default: '',
          minLength: 20,
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
  // Guard both 'running' and 'starting' to avoid duplicate timers/services
  // when the server calls start() again while a previous start is in flight
  if (instance.state === 'running' || instance.state === 'starting') {
    instance.logger('warn', 'Plugin already running', { state: instance.state });
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
  app: ServerAPI
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
  app: ServerAPI
): void {
  instance.state = 'running';

  if (app.setPluginStatus) {
    app.setPluginStatus(
      `SK to N2K Weather running - Enhanced with ${ENHANCED_FIELD_COUNT} data points`
    );
  }

  instance.logger('info', 'signalk-virtual-weather-sensors plugin started successfully', {
    enhancedFields: ENHANCED_FIELD_COUNT,
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
  app: ServerAPI
): Promise<void> {
  instance.state = 'error';
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Log error without exposing sensitive settings
  instance.logger('error', 'Failed to start plugin', {
    error: errorMessage,
    settingsProvided: typeof settings === 'object' && settings !== null,
    settingsKeys: typeof settings === 'object' && settings !== null ? Object.keys(settings) : [],
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
  app: ServerAPI
): void {
  const emissionInterval = config.emissionInterval * 1000; // Convert seconds to milliseconds
  const maxStalenessMs = 2 * config.updateFrequency * 60_000;

  instance.emissionTimer = setInterval(() => {
    try {
      emitWeatherTick(instance, app, maxStalenessMs);
    } catch (error) {
      instance.logger('error', 'Error in emission timer', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, emissionInterval);

  instance.logger('info', 'Emission system configured', {
    intervalSeconds: config.emissionInterval,
  });
}

/**
 * Single emission tick: refreshes the cached delta when weather data has
 * changed, rewrites the timestamp so consumers see the actual emission time
 * (not the cached observation time), and skips emission entirely when upstream
 * data has gone stale beyond `maxStalenessMs`.
 * @private
 */
function emitWeatherTick(instance: PluginInstance, app: ServerAPI, maxStalenessMs: number): void {
  const weatherData = instance.weatherService?.getCurrentWeatherData();
  if (!weatherData || !instance.pathMapper) {
    return;
  }

  const lastUpdate = instance.weatherService?.getServiceStatus().lastUpdate;
  if (lastUpdate && Date.now() - lastUpdate.getTime() > maxStalenessMs) {
    const minutesAgo = Math.round((Date.now() - lastUpdate.getTime()) / 60_000);
    if (app.setPluginError) {
      app.setPluginError(`Weather data stale: last update ${minutesAgo} minutes ago`);
    }
    return;
  }

  // Only rebuild delta when weather data changes (reference comparison).
  // TODO: NMEA2000PathMapper returns a custom SignalKDelta whose plain string
  // fields don't satisfy the branded Path/Context/Timestamp types in
  // @signalk/server-api. Aligning the mapper to return Delta directly would
  // let us drop this cast.
  if (weatherData !== instance.cachedWeatherDataRef) {
    instance.cachedDelta = instance.pathMapper.mapToSignalKPaths(weatherData) as unknown as Delta;
    instance.cachedWeatherDataRef = weatherData;
  }

  if (!instance.cachedDelta) {
    return;
  }

  app.handleMessage(PLUGIN.NAME, withEmissionTimestamp(instance.cachedDelta));
}

/**
 * Returns a delta clone whose first update carries the current wall-clock
 * timestamp, leaving the cached value structure untouched for reuse.
 * @private
 */
function withEmissionTimestamp(cached: Delta): Delta {
  const [firstUpdate, ...restUpdates] = cached.updates;
  if (!firstUpdate) {
    return cached;
  }
  return {
    ...cached,
    updates: [
      {
        ...firstUpdate,
        timestamp: new Date().toISOString() as unknown as NonNullable<typeof firstUpdate.timestamp>,
      },
      ...restUpdates,
    ],
  };
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

  // Clear path mapper and cached delta
  instance.pathMapper = null;
  instance.cachedDelta = null;
  instance.cachedWeatherDataRef = null;
}

/**
 * Validate and normalize plugin settings
 * @private
 */
function validateAndNormalizeSettings(settings: unknown, logger: Logger): PluginConfiguration {
  // Type check settings
  if (!settings || typeof settings !== 'object') {
    throw new Error(`${ERROR_CODES.CONFIGURATION.INVALID_API_KEY}: Invalid plugin configuration`);
  }

  const rawSettings = settings as Record<string, unknown>;

  const partialConfig: Partial<PluginConfiguration> = {
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
  });

  return finalConfig;
}

/**
 * Create structured logger with plugin context
 * Uses appropriate Signal K server logging methods for each level
 * @private
 */
const LOG_PREFIX: Record<LogLevel, string> = {
  debug: '',
  info: '[INFO] ',
  warn: '[WARN] ',
  error: '',
};

function createLogger(app: ServerAPI): Logger {
  const errorFn = typeof app.error === 'function' ? app.error.bind(app) : null;
  // Routes warn/error to app.error when available, else falls back to app.debug
  // with a level prefix so messages remain visible in production logs.
  const levelEmit: Record<LogLevel, (line: string) => void> = {
    debug: (line) => app.debug(line),
    info: (line) => app.debug(line),
    warn: errorFn ? (line) => errorFn(line) : (line) => app.debug(`[WARN] ${line}`),
    error: errorFn ? (line) => errorFn(line) : (line) => app.debug(`[ERROR] ${line}`),
  };

  return (level, message, metadata) => {
    const hasMetadata =
      metadata !== undefined && metadata !== null && Object.keys(metadata).length > 0;
    // Only sanitize metadata for warn/error (may contain config with API keys);
    // skip for debug/info hot paths to avoid overhead.
    const finalMetadata =
      hasMetadata && (level === 'warn' || level === 'error')
        ? sanitizeLogMetadata(metadata as Record<string, unknown>)
        : metadata;
    const logMetadata = hasMetadata ? ` | ${JSON.stringify(finalMetadata)}` : '';
    const line = `${LOG_PREFIX[level]}[${PLUGIN.NAME}] ${message}${logMetadata}`;
    levelEmit[level](line);
  };
}

/**
 * Sanitize log metadata to remove sensitive information
 * @private
 */
function sanitizeLogMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['apikey', 'api_key', 'accuweatherapikey', 'password', 'secret', 'token'];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeLogMetadata(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/** Approximate count of Signal K paths emitted (core + enhanced weather fields) */
const ENHANCED_FIELD_COUNT = 24;

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
