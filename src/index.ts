/**
 * Signal K Virtual Weather Sensors plugin entry point.
 * Polls the configured weather provider (Open-Meteo or AccuWeather), optionally
 * fetches sea state, calculates apparent wind, and emits NMEA2000-compatible
 * Signal K deltas on a fixed interval.
 */

import type { Plugin, ServerAPI } from '@signalk/server-api';
import { DEFAULT_CONFIG, ERROR_CODES, PLUGIN } from './constants/index.js';
import { MarinePathMapper } from './mappers/MarinePathMapper.js';
import { NMEA2000PathMapper } from './mappers/NMEA2000PathMapper.js';
import { WeatherNotifier } from './notifications/WeatherNotifier.js';
import { setupEnhancedEmissionSystem } from './plugin/emission.js';
import { type PluginInstance, setBanner } from './plugin/instance.js';
import { createLogger } from './plugin/logging.js';
import { registerPanelRoutes } from './plugin/panelRoutes.js';
import { pluginSchema, pluginUiSchema } from './plugin/schema.js';
import { createCurrentWeatherProvider } from './providers/createCurrentWeatherProvider.js';
import { supportsForecasts } from './providers/WeatherProvider.js';
import { OpenMeteoMarineService } from './services/OpenMeteoMarineService.js';
import { WarningsService } from './services/WarningsService.js';
import { WeatherProviderAdapter } from './services/WeatherProviderAdapter.js';
import { WeatherService } from './services/WeatherService.js';
import type { Logger, PluginConfiguration } from './types/index.js';
import { toErrorMessage } from './utils/conversions.js';
import { toSourceRef } from './utils/skDelta.js';
import { ConfigurationValidator } from './utils/validation.js';

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
    marinePathMapper: null,
    cachedMarineDelta: null,
    cachedMarineDataRef: null,
    marineMetaEmitted: false,
    notifier: null,
    emissionTimer: null,
    state: 'stopped',
    startTime: null,
    logger: createLogger(app),
    cachedDelta: null,
    cachedWeatherDataRef: null,
    metaEmitted: false,
    weatherProviderRegistered: false,
    // Pre-start placeholder, overwritten in startServices with the resolved
    // provider's sourceRef before the first delta. Open-Meteo is the default
    // install source, so it is the honest placeholder here.
    sourceRef: toSourceRef('open-meteo'),
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
     * Plugin configuration schema and uiSchema for the Signal K admin UI.
     * Both live in `./plugin/schema.js`; the notifications block is generated
     * from the shared band registry so the schema cannot drift from the panel.
     */
    schema: pluginSchema,

    uiSchema: pluginUiSchema,

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
  // Construct the provider the config selects (keyless Open-Meteo by default,
  // AccuWeather when chosen with a key). For AccuWeather this is one shared
  // instance so the current-conditions loop and the on-demand forecast adapter
  // draw from a single rolling-24h quota window.
  const provider = createCurrentWeatherProvider(config, instance.logger);
  instance.sourceRef = toSourceRef(provider.sourceRef);
  // Optional sea-state layer (keyless Open-Meteo Marine), independent of the
  // atmospheric provider. A self-hosted Open-Meteo instance serves /v1/marine on
  // the same host, so pass the configured base URL through when it is set.
  const marineService = config.marineData
    ? new OpenMeteoMarineService(
        instance.logger,
        config.openMeteoBaseUrl ? { baseUrl: config.openMeteoBaseUrl } : undefined
      )
    : undefined;
  if (marineService) {
    instance.marinePathMapper = new MarinePathMapper(instance.logger);
  }
  instance.weatherService = new WeatherService(
    app,
    config,
    instance.logger,
    undefined,
    provider,
    undefined,
    bannerSink,
    marineService
  );
  instance.pathMapper = new NMEA2000PathMapper(instance.logger, instance.sourceRef);
  // Construct the notifier even when notifications are disabled at the master
  // level so a hot-reload from disabled -> enabled does not need a restart.
  // `evaluate()` short-circuits when `config.notifications.enabled` is false.
  instance.notifier = new WeatherNotifier(config.notifications, instance.logger);
  await instance.weatherService.start();

  // Register the Signal K v2 Weather API provider. Only forecast-capable
  // providers advertise it; under Open-Meteo (not yet forecast-capable)
  // the emission path still works and forecasts are a later addition. The
  // typeof guard tolerates a server older than the 2.24 peer floor that
  // lacks the registry method.
  if (typeof app.registerWeatherProvider !== 'function') {
    instance.logger('warn', 'Server lacks registerWeatherProvider; weather API not exposed');
  } else if (supportsForecasts(provider)) {
    // Warnings are keyless and region-aware (NWS for US waters), served through
    // the v2 provider alongside forecasts and observations.
    const adapter = new WeatherProviderAdapter(
      provider,
      new WarningsService(instance.logger),
      instance.logger
    );
    app.registerWeatherProvider(adapter.toProvider());
    instance.weatherProviderRegistered = true;
    instance.logger('info', 'Registered Signal K weather provider', { provider: provider.name });
  } else {
    instance.logger('info', 'Weather API forecasts not advertised for the selected provider', {
      provider: provider.name,
    });
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
  instance.marinePathMapper = null;
  if (instance.notifier) {
    instance.notifier.reset();
    instance.notifier = null;
  }
  instance.cachedDelta = null;
  instance.cachedWeatherDataRef = null;
  instance.metaEmitted = false;
  instance.cachedMarineDelta = null;
  instance.cachedMarineDataRef = null;
  instance.marineMetaEmitted = false;
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
    // Provider and base URL are spread in only when present so legacy config
    // (written before these options existed) leaves them absent, letting
    // resolveWeatherProvider apply the migration-safe default. An invalid
    // provider string is caught by validation.
    ...(typeof rawSettings.weatherProvider === 'string' && {
      weatherProvider: rawSettings.weatherProvider as PluginConfiguration['weatherProvider'],
    }),
    ...(typeof rawSettings.weatherMode === 'string' && {
      weatherMode: rawSettings.weatherMode as PluginConfiguration['weatherMode'],
    }),
    ...(typeof rawSettings.openMeteoBaseUrl === 'string' && {
      openMeteoBaseUrl: rawSettings.openMeteoBaseUrl,
    }),
    marineData: rawSettings.marineData === true,
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
