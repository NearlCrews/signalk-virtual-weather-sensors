/**
 * Signal K Virtual Weather Sensors plugin entry point.
 * Polls AccuWeather, calculates apparent wind, and emits NMEA2000-compatible
 * Signal K deltas on a fixed interval.
 */

import {
  type Delta,
  type PathValue,
  type Plugin,
  type ServerAPI,
  SKVersion,
} from '@signalk/server-api';
import type { IRouter, Request, Response } from 'express';
import {
  API_KEY_MIN_LENGTH,
  CONFIG_DEFAULTS,
  DEFAULT_CONFIG,
  ERROR_CODES,
  NOTIFICATION_LABELS,
  NOTIFICATION_MASTER_LABEL,
  PLUGIN,
  TEST_KEY_LOCATION,
} from './constants/index.js';
import { validateKeyLength } from './constants/notifications-shared.js';
import { NMEA2000PathMapper } from './mappers/NMEA2000PathMapper.js';
import { WeatherNotifier } from './notifications/WeatherNotifier.js';
import { AccuWeatherService } from './services/AccuWeatherService.js';
import { WeatherProviderAdapter } from './services/WeatherProviderAdapter.js';
import { WeatherService } from './services/WeatherService.js';
import type {
  Logger,
  LogLevel,
  PanelStatusResponse,
  PluginConfiguration,
  PluginState,
  WeatherData,
} from './types/index.js';
import { msToWholeMinutes, toErrorMessage } from './utils/conversions.js';
import { buildValuesDelta } from './utils/skDelta.js';
import { ConfigurationValidator } from './utils/validation.js';

/** Distinguishes a banner string pushed via setPluginStatus from one pushed via setPluginError. */
type BannerKind = 'status' | 'error';

/**
 * Plugin instance state
 */
interface PluginInstance {
  weatherService: WeatherService | null;
  pathMapper: NMEA2000PathMapper | null;
  /** Null when notifications are disabled or the plugin is stopped. */
  notifier: WeatherNotifier | null;
  emissionTimer: NodeJS.Timeout | null;
  state: PluginState;
  startTime: Date | null;
  logger: Logger;
  /** Cached delta to avoid rebuilding on every emission tick */
  cachedDelta: Delta | null;
  cachedWeatherDataRef: WeatherData | null;
  /** True once the one-shot meta delta has been shipped to the server. */
  metaEmitted: boolean;
  /** True once app.registerWeatherProvider has been called this start cycle. */
  weatherProviderRegistered: boolean;
  /**
   * Last (kind, message) pushed to the admin UI. Used to dedupe identical
   * setPluginStatus / setPluginError calls so a flapping API doesn't oscillate
   * the banner every emission tick. Reset on stop().
   */
  lastBanner: { kind: BannerKind; message: string } | null;
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
    notifier: null,
    emissionTimer: null,
    state: 'stopped',
    startTime: null,
    logger: createLogger(app),
    cachedDelta: null,
    cachedWeatherDataRef: null,
    metaEmitted: false,
    weatherProviderRegistered: false,
    lastBanner: null,
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

        unregisterWeatherProvider(instance, app);

        await cleanup(instance);

        const uptime = instance.startTime ? Date.now() - instance.startTime.getTime() : 0;

        instance.state = 'stopped';
        instance.startTime = null;

        setBanner(instance, app, 'status', PLUGIN.STATUS.STOPPED);

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

        setBanner(instance, app, 'error', `Stop failed: ${errorMessage}`);
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
          minLength: API_KEY_MIN_LENGTH,
        },
        updateFrequency: {
          type: 'integer',
          title: 'Weather Update Frequency (minutes)',
          description:
            'How often to fetch new weather data from AccuWeather. Each tick costs one API call (location lookups are cached).',
          default: CONFIG_DEFAULTS.UPDATE_FREQUENCY,
          minimum: CONFIG_DEFAULTS.UPDATE_FREQUENCY_MIN,
          maximum: CONFIG_DEFAULTS.UPDATE_FREQUENCY_MAX,
        },
        emissionInterval: {
          type: 'integer',
          title: 'Broadcast Interval (seconds)',
          description:
            'How often the cached weather payload is re-emitted to the Signal K bus so NMEA2000 listeners keep seeing fresh deltas.',
          default: CONFIG_DEFAULTS.EMISSION_INTERVAL,
          minimum: CONFIG_DEFAULTS.EMISSION_INTERVAL_MIN,
          maximum: CONFIG_DEFAULTS.EMISSION_INTERVAL_MAX,
        },
        dailyApiQuota: {
          type: 'integer',
          title: 'Daily API Call Quota',
          description:
            'Cap on AccuWeather calls in any rolling 24-hour window. AccuWeather free tier allows 50/day. Set to 0 to disable the cap and quota warnings.',
          default: CONFIG_DEFAULTS.DAILY_API_QUOTA,
          minimum: CONFIG_DEFAULTS.DAILY_API_QUOTA_MIN,
          maximum: CONFIG_DEFAULTS.DAILY_API_QUOTA_MAX,
        },
        notifications: {
          type: 'object',
          title: 'Severe-weather notifications',
          description:
            'Emit Signal K notifications on notifications.environment.* when wind, visibility, heat-stress, cold, or severe-condition thresholds are crossed. Bridges to NMEA 2000 Alert PGNs (126983/126985) only when signalk-to-nmea2000 is installed on the server.',
          properties: {
            enabled: {
              type: 'boolean',
              title: NOTIFICATION_MASTER_LABEL,
              default: DEFAULT_CONFIG.NOTIFICATIONS.ENABLED,
            },
            wind: {
              type: 'boolean',
              title: NOTIFICATION_LABELS.wind,
              default: DEFAULT_CONFIG.NOTIFICATIONS.WIND,
            },
            visibility: {
              type: 'boolean',
              title: NOTIFICATION_LABELS.visibility,
              default: DEFAULT_CONFIG.NOTIFICATIONS.VISIBILITY,
            },
            heat: {
              type: 'boolean',
              title: NOTIFICATION_LABELS.heat,
              default: DEFAULT_CONFIG.NOTIFICATIONS.HEAT,
            },
            cold: {
              type: 'boolean',
              title: NOTIFICATION_LABELS.cold,
              default: DEFAULT_CONFIG.NOTIFICATIONS.COLD,
            },
            weather: {
              type: 'boolean',
              title: NOTIFICATION_LABELS.weather,
              default: DEFAULT_CONFIG.NOTIFICATIONS.WEATHER,
            },
          },
        },
      },
    }),

    /**
     * UI schema for better form presentation
     */
    uiSchema: () => ({
      'ui:order': [
        'accuWeatherApiKey',
        'updateFrequency',
        'emissionInterval',
        'dailyApiQuota',
        'notifications',
      ],
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
      notifications: {
        'ui:help':
          'Notifications are off by default. Each category-specific toggle below only takes effect when the master enable is on. Bridging to NMEA 2000 Alert PGNs requires the separate signalk-to-nmea2000 plugin on the server.',
        'ui:order': ['enabled', 'wind', 'visibility', 'heat', 'cold', 'weather'],
      },
    }),

    /**
     * REST endpoints consumed by the federated React config panel
     * (src/configpanel/). Mounted at /plugins/<id>/api/* by signalk-server.
     *
     * The panel polls `/api/status` for live banner + quota + active-alert
     * data, and calls `/api/test-key` on demand to verify a candidate API
     * key against AccuWeather without persisting it.
     */
    registerWithRouter: (router) => {
      registerPanelRoutes(router, instance);
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
  // Route every WeatherService banner write through the entry-point dedupe so
  // a repeated quota or auth message lands one banner per unique string, not
  // one per fetch attempt. The sink updates `instance.lastBanner` so the next
  // emission tick also dedupes correctly against the WeatherService-pushed
  // state, closing the one-tick boundary glitch that bare app.setPlugin*
  // writes would create.
  const bannerSink = (kind: 'status' | 'error', message: string): void => {
    setBanner(instance, app, kind, message);
  };
  // One shared AccuWeatherService so the provider's on-demand forecast fetches
  // and the current-conditions loop draw from a single rolling-24h quota window.
  const accuWeatherService = new AccuWeatherService(config.accuWeatherApiKey, instance.logger, {
    dailyApiQuota: config.dailyApiQuota,
  });
  instance.weatherService = new WeatherService(
    app,
    config,
    instance.logger,
    undefined,
    accuWeatherService,
    undefined,
    bannerSink
  );
  instance.pathMapper = new NMEA2000PathMapper(instance.logger);
  // Construct the notifier even when notifications are disabled at the master
  // level so a hot-reload from disabled -> enabled does not need a restart.
  // `evaluate()` short-circuits when `config.notifications.enabled` is false.
  instance.notifier = new WeatherNotifier(config.notifications, instance.logger);
  await instance.weatherService.start();

  // Register the Signal K Weather API provider. The typeof guard tolerates a
  // server older than the 2.24 peer floor that lacks the registry method.
  if (typeof app.registerWeatherProvider === 'function') {
    const adapter = new WeatherProviderAdapter(accuWeatherService, instance.logger);
    app.registerWeatherProvider(adapter.toProvider());
    instance.weatherProviderRegistered = true;
    instance.logger('info', 'Registered Signal K weather provider', {
      provider: PLUGIN.PROVIDER_NAME,
    });
  } else {
    instance.logger('warn', 'Server lacks registerWeatherProvider; weather API not exposed');
  }

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

  setBanner(instance, app, 'status', weatherService.formatStatusBanner());

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
  setBanner(instance, app, 'error', `Startup failed: ${errorMessage}`);

  // Unregister before cleanup: if registration succeeded but a later start step
  // threw, cleanup alone would reset the flag without unregistering, leaking the
  // provider in the server (a later stop() would then skip unregistration).
  unregisterWeatherProvider(instance, app);

  await cleanup(instance);
}

/**
 * Unregister the Signal K weather provider if it was registered this cycle.
 * Lives outside cleanup() because it needs `app` in scope; shared by stop() and
 * handleStartupError so a throw after registration cannot leak the provider in
 * the server. unRegister lives on app.weatherApi with a capital R; the optional
 * chain tolerates an older server.
 * @private
 */
function unregisterWeatherProvider(instance: PluginInstance, app: ServerAPI): void {
  if (!instance.weatherProviderRegistered) return;
  try {
    app.weatherApi?.unRegister(PLUGIN.NAME);
  } catch (error) {
    instance.logger('error', 'Error unregistering weather provider', {
      error: toErrorMessage(error),
    });
  }
  instance.weatherProviderRegistered = false;
}

/**
 * Single entry point for every admin-UI banner push. Dedupes consecutive
 * identical (kind, message) pairs so a flapping API or a steady-state quota
 * pause doesn't oscillate the banner every 5 seconds. Identity is tracked
 * separately for `setPluginStatus` and `setPluginError` because the server
 * treats them as distinct UI bands.
 * @private
 */
function setBanner(
  instance: PluginInstance,
  app: ServerAPI,
  kind: BannerKind,
  message: string
): void {
  const last = instance.lastBanner;
  if (last !== null && last.kind === kind && last.message === message) {
    return;
  }
  if (kind === 'status') {
    app.setPluginStatus(message);
  } else {
    app.setPluginError(message);
  }
  instance.lastBanner = { kind, message };
}

function setupEnhancedEmissionSystem(
  instance: PluginInstance,
  config: PluginConfiguration,
  app: ServerAPI
): void {
  const emissionInterval = config.emissionInterval * 1000;

  instance.emissionTimer = setInterval(() => {
    try {
      emitWeatherTick(instance, app);
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
 * (not the cached observation time), and skips emission entirely when the
 * service reports the upstream data has gone stale.
 * @private
 */
function emitWeatherTick(instance: PluginInstance, app: ServerAPI): void {
  if (!instance.weatherService || !instance.pathMapper) {
    return;
  }
  const weatherData = instance.weatherService.getCurrentWeatherData();
  if (!weatherData) {
    return;
  }

  // Banner precedence (quota-exhausted, then stale, then live status) is
  // owned by WeatherService.getTickBanner; this tick just routes the result
  // through the setBanner dedupe, so identical ticks within the same minute
  // are no-ops and only message changes hit the SK API.
  const banner = instance.weatherService.getTickBanner();
  setBanner(instance, app, banner.kind, banner.message);

  // Staleness gates emission, not just the banner: quota exhaustion alone
  // keeps broadcasting cached in-window data on the keep-alive cadence so
  // NMEA2000 consumers do not drop the virtual sensor, but data past the
  // staleness watchdog must stop being restamped with fresh timestamps.
  if (instance.weatherService.isDataStale()) {
    return;
  }

  // Only rebuild delta when weather data changes (reference comparison).
  // Notifications are evaluated on the same edge: transitions only fire when
  // the underlying snapshot changes, so re-evaluating on every emission tick
  // would waste CPU on the steady-state case.
  let notificationValues: PathValue[] = [];
  if (weatherData !== instance.cachedWeatherDataRef) {
    const refreshed = refreshCachedDelta(instance, app, weatherData, instance.pathMapper);
    if (refreshed === null) return;
    notificationValues = refreshed;
  }

  if (!instance.cachedDelta) {
    return;
  }

  app.handleMessage(PLUGIN.NAME, withEmissionTimestamp(instance.cachedDelta), SKVersion.v1);

  // Notifications ride a separate delta so consumers walking the values delta
  // do not see a `notifications.*` leaf interleaved with measurements. The
  // notifier returned PathValues only on transition, so a non-empty list here
  // always represents an entry or exit edge.
  if (notificationValues.length > 0) {
    app.handleMessage(PLUGIN.NAME, buildValuesDelta(notificationValues), SKVersion.v1);
  }

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
 * Rebuild the cached values delta from new weather data and run the notifier.
 * Returns the notifier's transitions, or `null` if mapping failed (in which
 * case the cached delta is cleared and an error banner is published so the
 * caller can short-circuit the tick).
 * @private
 */
function refreshCachedDelta(
  instance: PluginInstance,
  app: ServerAPI,
  weatherData: WeatherData,
  pathMapper: NMEA2000PathMapper
): PathValue[] | null {
  try {
    instance.cachedDelta = pathMapper.mapToSignalKPaths(weatherData);
    instance.cachedWeatherDataRef = weatherData;
    return instance.notifier?.evaluate(weatherData) ?? [];
  } catch (error) {
    // Mapper failure: drop the cached delta so we stop emitting stale data with
    // a fresh timestamp (which would hide the failure from operators). Pin
    // cachedWeatherDataRef to this snapshot so the emission tick's ref-equality
    // guard skips re-mapping (and re-logging) the same failing data every tick;
    // the next fetch yields a new snapshot that re-attempts the mapping.
    const errorMessage = toErrorMessage(error);
    instance.logger('error', 'Mapping weather data to Signal K paths failed', {
      error: errorMessage,
    });
    instance.cachedDelta = null;
    instance.cachedWeatherDataRef = weatherData;
    setBanner(instance, app, 'error', `Weather mapping failed: ${errorMessage}`);
    return null;
  }
}

/**
 * Returns a Delta clone with every update's timestamp restamped to the
 * current emission time, preserving the immutability of the cached delta
 * so handleMessage callers can safely retain references.
 * @private
 */
function withEmissionTimestamp(cached: Delta): Delta {
  // The cached delta is always a single-update values delta built by
  // `buildValuesDelta`, so restamping is a rebuild through the same helper,
  // which stamps the current wall-clock time when no timestamp is passed.
  const update = cached.updates[0];
  if (update === undefined || !('values' in update)) return cached;
  return buildValuesDelta(update.values);
}

/**
 * Cleanup plugin resources
 * @private
 */
async function cleanup(instance: PluginInstance): Promise<void> {
  if (instance.emissionTimer) {
    clearInterval(instance.emissionTimer);
    instance.emissionTimer = null;
  }

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

  instance.pathMapper = null;
  if (instance.notifier) {
    instance.notifier.reset();
    instance.notifier = null;
  }
  instance.cachedDelta = null;
  instance.cachedWeatherDataRef = null;
  instance.metaEmitted = false;
  instance.weatherProviderRegistered = false;
  instance.lastBanner = null;
}

/**
 * Validate and normalize plugin settings
 * @private
 */
function validateAndNormalizeSettings(settings: unknown, logger: Logger): PluginConfiguration {
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
    // `sanitizeConfiguration` coerces a missing or partial notifications
    // subobject into the canonical NotificationsConfig with documented defaults,
    // so we forward whatever the operator submitted and let the sanitizer fill
    // in the rest. Routed through `unknown` so the cast cannot pretend the
    // raw value is already a validated NotificationsConfig.
    notifications: rawSettings.notifications as unknown as PluginConfiguration['notifications'],
  };

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

  const finalConfig = ConfigurationValidator.sanitizeConfiguration(partialConfig);

  logger('info', 'Plugin configuration validated and normalized', {
    updateFrequency: finalConfig.updateFrequency,
    emissionInterval: finalConfig.emissionInterval,
    dailyApiQuota: finalConfig.dailyApiQuota,
    notifications: finalConfig.notifications,
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

/**
 * Single regex matching any sensitive key substring. `accuweatherapikey` is
 * covered by the `apikey` alternation (substring match) so it does not need its
 * own branch.
 */
const SENSITIVE_LOG_KEY_PATTERN = /apikey|api_key|password|secret|token/;

/**
 * Cap on metadata nesting (objects and arrays alike) before recursion is
 * truncated. A container AT this depth becomes the `'[depth-truncated]'`
 * marker, so the cap names the deepest level whose contents are still walked.
 */
const SANITIZE_MAX_DEPTH = 5;

/**
 * Sanitize log metadata to remove sensitive information. Thin typed entry
 * point: `sanitizeLogValue` is the sole recursive walker and owns the depth
 * cap, the circular-reference guard, and the sensitive-key redaction. The
 * top-level metadata bag is a fresh object at depth 0, so the walker always
 * returns an object here; the cast restores the entry point's record type.
 * @private
 */
function sanitizeLogMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return sanitizeLogValue(metadata, 0, new WeakSet()) as Record<string, unknown>;
}

/**
 * Recursively sanitize one metadata value. Primitives pass through; any
 * container past the depth cap collapses to a marker string (a cyclic or
 * pathologically deep metadata bag must not stack-overflow the Node process
 * when a warn / error is logged); objects redact sensitive keys, and arrays
 * walk each element so a nested `{ items: [{ apiKey }] }` cannot bypass
 * redaction.
 * @private
 */
function sanitizeLogValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (depth >= SANITIZE_MAX_DEPTH) {
    return '[depth-truncated]';
  }
  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeLogValue(entry, depth + 1, seen));
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_LOG_KEY_PATTERN.test(key.toLowerCase())
      ? '[REDACTED]'
      : sanitizeLogValue(entry, depth + 1, seen);
  }
  return sanitized;
}

/**
 * Mount the panel's REST endpoints onto the express router signalk-server
 * passes in. Endpoints live under `/plugins/signalk-virtual-weather-sensors/api/`.
 *
 * `/api/status` is read-only and safe to expose; `/api/test-key` accepts a
 * candidate key in a POST body and makes one AccuWeather location-search
 * call without persisting it. Neither endpoint mutates plugin state.
 * @private
 */
function registerPanelRoutes(router: IRouter, instance: PluginInstance): void {
  router.get('/api/status', (_req: Request, res: Response) => {
    const ws = instance.weatherService;
    if (!ws) {
      const payload: PanelStatusResponse = {
        running: false,
        banner: instance.lastBanner?.message ?? 'Plugin stopped',
        updates: 0,
        quotaUsedLast24h: 0,
        lastUpdateMinutesAgo: null,
        activeNotifications: 0,
        weatherProviderRegistered: false,
      };
      res.json(payload);
      return;
    }
    const snapshot = ws.getServiceStatus();
    const ageMs = ws.getDataAgeMs();
    // A rejected API key is a terminal state: the update timer is cleared
    // and no further fetches will fire until config changes. Reflect that on
    // the `running` flag so the panel does not show a green indicator on a
    // plugin that has effectively stopped.
    const running = instance.state === 'running' && !ws.isApiKeyRejected();
    const payload: PanelStatusResponse = {
      running,
      banner: ws.formatStatusBanner(),
      updates: snapshot.updateCount,
      quotaUsedLast24h: ws.getRequestCountLast24h(),
      lastUpdateMinutesAgo: ageMs === null ? null : msToWholeMinutes(ageMs),
      activeNotifications: instance.notifier?.getActiveCount() ?? 0,
      weatherProviderRegistered: instance.weatherProviderRegistered,
    };
    res.json(payload);
  });

  // Token-bucket-style rate limiter for /api/test-key. signalk-server does NOT
  // apply its security strategy to plugin routers, so this endpoint is
  // effectively unauthenticated: any client that can reach the server can
  // drive it, and each call costs one upstream AccuWeather request. The
  // limiter caps a flood at 10 calls/minute, well under the free-tier daily
  // allowance. /api/status is likewise unauthenticated but strictly read-only.
  const TEST_KEY_RATE_LIMIT = 10;
  const TEST_KEY_WINDOW_MS = 60_000;
  const testKeyHits: number[] = [];

  router.post('/api/test-key', async (req: Request, res: Response) => {
    const now = Date.now();
    while (testKeyHits.length > 0 && now - (testKeyHits[0] as number) > TEST_KEY_WINDOW_MS) {
      testKeyHits.shift();
    }
    if (testKeyHits.length >= TEST_KEY_RATE_LIMIT) {
      res.status(429).json({
        ok: false,
        message: 'Too many key-test requests. Try again in a minute.',
      });
      return;
    }

    // express.json() body-parser is wired by signalk-server before plugin
    // routers run; the body is therefore the parsed JSON object.
    const body = (req.body ?? {}) as { apiKey?: unknown };
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const keyLengthError = validateKeyLength(apiKey);
    if (keyLengthError) {
      res.status(400).json({ ok: false, message: keyLengthError });
      return;
    }
    testKeyHits.push(now);
    try {
      const result = await testApiKey(apiKey);
      res.json(result);
    } catch (error) {
      // testApiKey already catches and sanitizes verifyApiKey failures, so this
      // outer catch only fires on an unexpected throw (e.g. AccuWeatherService
      // construction). Server-side log carries the full error; the client gets a
      // sanitized, length-bounded single-line message so no URL fragments or
      // stack-derived text leak to a LAN-side caller.
      const fullMessage = toErrorMessage(error);
      instance.logger('error', 'Test-key endpoint failed', { error: fullMessage });
      res.status(500).json({ ok: false, message: sanitizeClientErrorMessage(fullMessage) });
    }
  });
}

/**
 * Trim and bound an error message before returning it to a panel client.
 * Strips control characters that could break JSON-encoded log viewers and
 * caps the length so any URL fragments or stack traces never reach the wire.
 * @private
 */
function sanitizeClientErrorMessage(raw: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately strip control chars
  const stripped = raw.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  const MAX_LEN = 256;
  return stripped.length > MAX_LEN ? `${stripped.slice(0, MAX_LEN)}...` : stripped;
}

/**
 * Probe a candidate AccuWeather API key with exactly one location-search call
 * (via {@link AccuWeatherService.verifyApiKey}). Returns a `{ok, message}`
 * shape consumed by the admin-UI panel; no key persistence, no plugin-state
 * mutation. Costs one AccuWeather API call per test, half what a full
 * currentconditions probe would.
 * @private
 */
async function testApiKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  const probe = new AccuWeatherService(apiKey, () => {}, {
    // Tight retry budget: the panel should surface failure fast, not chew
    // through the user's quota retrying a bad key.
    retryAttempts: 1,
    requestTimeout: 8000,
  });
  try {
    await probe.verifyApiKey(TEST_KEY_LOCATION);
    return { ok: true, message: 'API key verified against AccuWeather.' };
  } catch (error) {
    return { ok: false, message: sanitizeClientErrorMessage(toErrorMessage(error)) };
  }
}
