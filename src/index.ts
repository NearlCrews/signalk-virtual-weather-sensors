/**
 * Signal K Virtual Weather Sensors plugin entry point.
 * Polls AccuWeather, calculates apparent wind, and emits NMEA2000-compatible
 * Signal K deltas on a fixed interval.
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

  const plugin: Plugin = {
    id: PLUGIN.NAME,
    name: PLUGIN.DISPLAY_NAME,
    description: PLUGIN.DESCRIPTION,

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

    stop: async (): Promise<void> => {
      try {
        instance.logger('info', 'Stopping signalk-virtual-weather-sensors plugin');

        instance.state = 'stopping';

        await cleanup(instance);

        const uptime = instance.startTime ? Date.now() - instance.startTime.getTime() : 0;

        instance.state = 'stopped';
        instance.startTime = null;

        if (app.setPluginStatus) {
          app.setPluginStatus(PLUGIN.STATUS.STOPPED);
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
 * Returns true (and logs a warning) when start() is invoked while a previous
 * start is still in flight or already completed. The 'starting' check guards
 * against duplicate timers when the server calls start() concurrently.
 */
function isPluginAlreadyRunning(instance: PluginInstance): boolean {
  if (instance.state === 'running' || instance.state === 'starting') {
    instance.logger('warn', 'Plugin already running', { state: instance.state });
    return true;
  }
  return false;
}

function initializePlugin(instance: PluginInstance, settings: unknown): PluginConfiguration {
  instance.state = 'starting';
  instance.startTime = new Date();
  return validateAndNormalizeSettings(settings, instance.logger);
}

async function startServices(
  instance: PluginInstance,
  config: PluginConfiguration,
  app: ServerAPI
): Promise<void> {
  instance.weatherService = new WeatherService(app, config, instance.logger);
  instance.pathMapper = new NMEA2000PathMapper(instance.logger);
  await instance.weatherService.start();
  setupEnhancedEmissionSystem(instance, config, app);
}

function finalizePluginStart(
  instance: PluginInstance,
  config: PluginConfiguration,
  app: ServerAPI
): void {
  instance.state = 'running';

  if (app.setPluginStatus) {
    app.setPluginStatus(
      `${PLUGIN.STATUS.RUNNING} - Enhanced with ${PLUGIN.ENHANCED_FIELD_COUNT} data points`
    );
  }

  instance.logger('info', 'signalk-virtual-weather-sensors plugin started successfully', {
    enhancedFields: PLUGIN.ENHANCED_FIELD_COUNT,
    emissionInterval: config.emissionInterval,
    updateFrequency: config.updateFrequency,
    hybridMode: true,
  });
}

async function handleStartupError(
  instance: PluginInstance,
  error: unknown,
  settings: unknown,
  app: ServerAPI
): Promise<void> {
  instance.state = 'error';
  const errorMessage = error instanceof Error ? error.message : String(error);

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

function setupEnhancedEmissionSystem(
  instance: PluginInstance,
  config: PluginConfiguration,
  app: ServerAPI
): void {
  const emissionInterval = config.emissionInterval * 1000;
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

  const lastUpdate = instance.weatherService?.getLastUpdate();
  if (lastUpdate) {
    const ageMs = Date.now() - lastUpdate.getTime();
    if (ageMs > maxStalenessMs) {
      if (app.setPluginError) {
        app.setPluginError(
          `Weather data stale: last update ${Math.round(ageMs / 60_000)} minutes ago`
        );
      }
      return;
    }
  }

  // Only rebuild delta when weather data changes (reference comparison).
  if (weatherData !== instance.cachedWeatherDataRef) {
    instance.cachedDelta = instance.pathMapper.mapToSignalKPaths(weatherData);
    instance.cachedWeatherDataRef = weatherData;
  }

  if (!instance.cachedDelta) {
    return;
  }

  // Mutate the cached delta's first-update timestamp in place. The delta is private
  // to this plugin instance and is rebuilt whenever weatherData changes, so mutation
  // here doesn't surprise any other consumer, and avoids a 24-field spread per tick.
  stampEmissionTimestamp(instance.cachedDelta);
  app.handleMessage(PLUGIN.NAME, instance.cachedDelta);
}

/**
 * Sets the first update's timestamp to now in place. No-op if the delta has no updates.
 * @private
 */
function stampEmissionTimestamp(cached: Delta): void {
  const firstUpdate = cached.updates[0];
  if (!firstUpdate) return;
  (firstUpdate as { timestamp: typeof firstUpdate.timestamp }).timestamp =
    new Date().toISOString() as typeof firstUpdate.timestamp;
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

/** Level marker prepended to every log line so all four levels are distinguishable. */
const LOG_PREFIX: Record<LogLevel, string> = {
  debug: '[DEBUG] ',
  info: '[INFO] ',
  warn: '[WARN] ',
  error: '[ERROR] ',
};

function createLogger(app: ServerAPI): Logger {
  const errorFn = typeof app.error === 'function' ? app.error.bind(app) : null;
  // Routes warn/error to app.error when available; otherwise falls back to app.debug.
  // Either way the line itself carries the level prefix from LOG_PREFIX.
  const emitWarnError = errorFn ?? app.debug.bind(app);
  const levelEmit: Record<LogLevel, (line: string) => void> = {
    debug: (line) => app.debug(line),
    info: (line) => app.debug(line),
    warn: emitWarnError,
    error: emitWarnError,
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
    levelEmit[level](`${LOG_PREFIX[level]}[${PLUGIN.NAME}] ${message}${logMetadata}`);
  };
}

/** Single regex that matches any sensitive key substring (faster than 6× String.includes). */
const SENSITIVE_LOG_KEY_PATTERN = /apikey|api_key|accuweatherapikey|password|secret|token/;

/**
 * Sanitize log metadata to remove sensitive information
 * @private
 */
function sanitizeLogMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_LOG_KEY_PATTERN.test(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeLogMetadata(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
