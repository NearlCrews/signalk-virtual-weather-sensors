/**
 * Signal K Virtual Weather Sensors plugin entry point.
 * Polls AccuWeather, calculates apparent wind, and emits NMEA2000-compatible
 * Signal K deltas on a fixed interval.
 */

import { type Delta, type Plugin, type ServerAPI, SKVersion } from '@signalk/server-api';
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
import { asTimestamp, toErrorMessage } from './utils/conversions.js';
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
  /** True once the one-shot meta delta has been shipped to the server. */
  metaEmitted: boolean;
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
    metaEmitted: false,
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
        // The Signal K plugin contract reports startup failures via
        // setPluginError; rethrowing here would surface as an unhandled
        // promise rejection because signalk-server doesn't await start().
        await handleStartupError(instance, error, settings, app);
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

        app.setPluginStatus(PLUGIN.STATUS.STOPPED);

        instance.logger('info', 'signalk-virtual-weather-sensors plugin stopped successfully', {
          uptimeMs: uptime,
          finalState: instance.state,
        });
      } catch (error) {
        instance.state = 'error';
        const errorMessage = toErrorMessage(error);

        instance.logger('error', 'Error stopping plugin', {
          error: errorMessage,
        });

        // The admin UI plugin list already prefixes banner text with the
        // plugin's display name, so no need to repeat 'signalk-virtual-weather-sensors'
        // here.
        app.setPluginError(`Stop failed: ${errorMessage}`);
      }
    },

    /**
     * Plugin configuration schema for Signal K server UI.
     *
     * Notes on what the admin UI actually consumes:
     *  - Outer `title` is discarded: the SK admin UI wraps the schema and
     *    forces the wrapper title to a single space. The displayed name
     *    comes from `plugin.name` (PLUGIN.DISPLAY_NAME).
     *  - Outer `required` is also discarded by the wrapper. The API key
     *    field is enforced at submit via `minLength` here, and at runtime
     *    via `ConfigurationValidator.validateConfiguration`. We therefore
     *    do not declare an outer `required` array (it would be dead UI).
     */
    schema: () => ({
      type: 'object',
      description: 'AccuWeather to Signal K with NMEA2000-compatible environmental measurements.',
      properties: {
        accuWeatherApiKey: {
          type: 'string',
          title: 'AccuWeather API Key',
          description: 'Get your API key at https://developer.accuweather.com/',
          default: '',
          minLength: 20,
        },
        updateFrequency: {
          type: 'integer',
          title: 'Weather Update Frequency (minutes)',
          description:
            'How often to fetch new weather data from AccuWeather. Each tick costs one API call (location lookups are cached).',
          default: DEFAULT_CONFIG.UPDATE_FREQUENCY,
          minimum: 1,
          maximum: 60,
        },
        emissionInterval: {
          type: 'integer',
          title: 'Broadcast Interval (seconds)',
          description:
            'How often the cached weather payload is re-emitted to the Signal K bus so NMEA2000 listeners keep seeing fresh deltas.',
          default: DEFAULT_CONFIG.EMISSION_INTERVAL,
          minimum: 1,
          maximum: 60,
        },
        dailyApiQuota: {
          type: 'integer',
          title: 'Daily API Call Quota',
          description:
            'Cap on AccuWeather calls in any rolling 24-hour window. AccuWeather free tier allows 50/day. Set to 0 to disable the cap and quota warnings.',
          default: DEFAULT_CONFIG.DAILY_API_QUOTA,
          minimum: 0,
          maximum: DEFAULT_CONFIG.DAILY_API_QUOTA_MAX,
        },
      },
      // `required` is intentionally omitted at the outer level: the SK admin
      // UI wraps this schema and discards the outer `required` array. See
      // the schema() docblock above.
    }),

    /**
     * UI schema for better form presentation
     */
    uiSchema: () => ({
      'ui:order': ['accuWeatherApiKey', 'updateFrequency', 'emissionInterval', 'dailyApiQuota'],
      accuWeatherApiKey: {
        'ui:widget': 'password',
        'ui:autocomplete': 'off',
        'ui:placeholder': 'paste your AccuWeather developer API key',
      },
      updateFrequency: {
        'ui:widget': 'updown',
        'ui:help':
          'Free-tier keys get 50 calls/day, so 30 minutes (48/day) is the safe default. Raise the cadence on paid tiers.',
      },
      emissionInterval: {
        'ui:widget': 'updown',
        'ui:help':
          'Independent of the fetch cadence: keeps NMEA2000 listeners alive between AccuWeather updates.',
      },
      dailyApiQuota: {
        'ui:widget': 'updown',
        'ui:help':
          'When usage crosses 90% the banner shows a warning; at 100% fetches pause until the rolling window drops. 0 disables tracking entirely.',
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
 * lifecycle phase is still in flight or already completed. We block on:
 *   running    : already up, nothing to do.
 *   starting   : duplicate concurrent start() would race construct/start.
 *   stopping   : cleanup is awaiting weatherService.stop(); a concurrent
 *                start() would assign new services that cleanup would then
 *                null out when its await resolves.
 * 'stopped' and 'error' are the only states that proceed.
 */
function isPluginAlreadyRunning(instance: PluginInstance): boolean {
  if (
    instance.state === 'running' ||
    instance.state === 'starting' ||
    instance.state === 'stopping'
  ) {
    instance.logger('warn', 'Plugin start blocked by current lifecycle state', {
      state: instance.state,
    });
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
  // startServices() either assigns weatherService or throws (caught upstream
  // and routed to handleStartupError, which skips this function). Reaching
  // here with weatherService still null is a programmer error.
  const { weatherService } = instance;
  if (!weatherService) {
    throw new Error('finalizePluginStart invoked before WeatherService was constructed');
  }

  instance.state = 'running';

  app.setPluginStatus(weatherService.formatStatusBanner());

  instance.logger('info', 'signalk-virtual-weather-sensors plugin started successfully', {
    emissionInterval: config.emissionInterval,
    updateFrequency: config.updateFrequency,
  });
}

async function handleStartupError(
  instance: PluginInstance,
  error: unknown,
  settings: unknown,
  app: ServerAPI
): Promise<void> {
  instance.state = 'error';
  const errorMessage = toErrorMessage(error);

  instance.logger('error', 'Failed to start plugin', {
    error: errorMessage,
    settingsProvided: typeof settings === 'object' && settings !== null,
    settingsKeys: typeof settings === 'object' && settings !== null ? Object.keys(settings) : [],
  });

  // The admin UI plugin list already prefixes banner text with the plugin's
  // display name, so no need to repeat 'signalk-virtual-weather-sensors' here.
  app.setPluginError(`Startup failed: ${errorMessage}`);

  await cleanup(instance);
}

function setupEnhancedEmissionSystem(
  instance: PluginInstance,
  config: PluginConfiguration,
  app: ServerAPI
): void {
  const emissionInterval = config.emissionInterval * 1000;
  const maxStalenessMs = PLUGIN.STALENESS_FACTOR * config.updateFrequency * 60_000;

  instance.emissionTimer = setInterval(() => {
    try {
      emitWeatherTick(instance, app, maxStalenessMs);
    } catch (error) {
      instance.logger('error', 'Error in emission timer', {
        error: toErrorMessage(error),
      });
    }
  }, emissionInterval);

  instance.logger('info', 'Emission system configured', {
    intervalSeconds: config.emissionInterval,
  });
}

/**
 * Single emission tick: refreshes the cached delta when weather data has
 * changed, builds a fresh outbound delta with the current emission timestamp
 * (not the cached observation time), and skips emission entirely when upstream
 * data has gone stale beyond `maxStalenessMs`.
 * @private
 */
function emitWeatherTick(instance: PluginInstance, app: ServerAPI, maxStalenessMs: number): void {
  if (!instance.weatherService || !instance.pathMapper) {
    return;
  }
  const weatherData = instance.weatherService.getCurrentWeatherData();
  if (!weatherData) {
    return;
  }

  // Quota-exhausted is checked BEFORE staleness so the operator sees WHY
  // fetches paused (the specific quota message), not just that data is old.
  // Once a quota pause persists long enough to cross the staleness threshold,
  // both conditions are true; the quota-specific message wins because it is
  // strictly more informative. setPluginStatus below would silently overwrite
  // the prior setPluginError, so both branches return early.
  if (instance.weatherService.isQuotaExhausted()) {
    app.setPluginError(instance.weatherService.formatQuotaExhaustedMessage());
    return;
  }

  const ageMs = instance.weatherService.getDataAgeMs();
  if (ageMs !== null && ageMs > maxStalenessMs) {
    // Floor (not round) so a delta that has crossed the threshold by, say,
    // 30 seconds reports the actual whole minute since last update, not the
    // next minute up. Pluralize for the "1 minute ago" boundary.
    const ageMin = Math.floor(ageMs / 60_000);
    const unit = ageMin === 1 ? 'minute' : 'minutes';
    app.setPluginError(`Weather data stale: last update ${ageMin} ${unit} ago`);
    return;
  }

  // Re-push the banner every fresh tick so the admin UI sees "last update Nm
  // ago" rather than the start-time "awaiting first update" string. This call
  // also clears any prior setPluginError (e.g. stale-data) as soon as the
  // next successful tick lands.
  app.setPluginStatus(instance.weatherService.formatStatusBanner());

  // Only rebuild delta when weather data changes (reference comparison).
  if (weatherData !== instance.cachedWeatherDataRef) {
    instance.cachedDelta = instance.pathMapper.mapToSignalKPaths(weatherData);
    instance.cachedWeatherDataRef = weatherData;
  }

  if (!instance.cachedDelta) {
    return;
  }

  app.handleMessage(PLUGIN.NAME, withEmissionTimestamp(instance.cachedDelta), SKVersion.v1);

  // Ship the static meta block once per plugin lifetime, AFTER the first
  // values delta so admin UIs that render units lazily attach them on first
  // paint. The Signal K spec recommends emitting meta only when it changes;
  // this plugin's meta is fully static.
  if (!instance.metaEmitted) {
    app.handleMessage(PLUGIN.NAME, instance.pathMapper.buildMetaDelta(), SKVersion.v1);
    instance.metaEmitted = true;
  }
}

/**
 * Returns a Delta clone with every update's timestamp restamped to the
 * current emission time, preserving the immutability of the cached delta
 * so handleMessage callers can safely retain references.
 * @private
 */
function withEmissionTimestamp(cached: Delta): Delta {
  const now = asTimestamp(new Date().toISOString());
  return {
    ...cached,
    updates: cached.updates.map((update) => ({ ...update, timestamp: now })),
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
        error: toErrorMessage(error),
      });
    }
    instance.weatherService = null;
  }

  // Clear path mapper and cached delta
  instance.pathMapper = null;
  instance.cachedDelta = null;
  instance.cachedWeatherDataRef = null;
  instance.metaEmitted = false;
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
    dailyApiQuota:
      typeof rawSettings.dailyApiQuota === 'number'
        ? rawSettings.dailyApiQuota
        : DEFAULT_CONFIG.DAILY_API_QUOTA,
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
    dailyApiQuota: finalConfig.dailyApiQuota,
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
  // debug/info go through app.debug (gated by DEBUG=plugin-id). warn/error
  // go through app.error so operators see them without enabling debug logging.
  // Admin UI banner state is reported separately via app.setPluginError.
  return (level, message, metadata) => {
    const hasMetadata =
      metadata !== undefined && metadata !== null && Object.keys(metadata).length > 0;
    // Sanitize metadata only for warn/error (may carry API keys etc); the
    // hot-path debug/info logs skip it to avoid recursion overhead.
    const finalMetadata =
      hasMetadata && (level === 'warn' || level === 'error')
        ? sanitizeLogMetadata(metadata as Record<string, unknown>)
        : metadata;
    const logMetadata = hasMetadata ? ` | ${JSON.stringify(finalMetadata)}` : '';
    const line = `${LOG_PREFIX[level]}[${PLUGIN.NAME}] ${message}${logMetadata}`;
    if (level === 'warn' || level === 'error') {
      app.error(line);
    } else {
      app.debug(line);
    }
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
