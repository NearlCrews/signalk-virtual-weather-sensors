/**
 * Emission tick system for the Virtual Weather Sensors plugin.
 * Drives the keep-alive NMEA2000-compatible delta broadcast on a fixed
 * interval, rebuilding the cached delta only when new weather data arrives.
 */

import { type PathValue, type ServerAPI, SKVersion } from '@signalk/server-api';
import { PLUGIN } from '../constants/index.js';
import type { NMEA2000PathMapper } from '../mappers/NMEA2000PathMapper.js';
import { isMarineDataEmpty } from '../mappers/OpenMeteoMarineMapper.js';
import type { PluginConfiguration, WeatherData } from '../types/index.js';
import { toErrorMessage } from '../utils/conversions.js';
import { buildValuesDelta } from '../utils/skDelta.js';
import { type PluginInstance, setBanner } from './instance.js';

/**
 * Wire up the interval-based emission timer. Called once per start() cycle.
 * The timer drives `emitWeatherTick` on the configured cadence; emission
 * errors surface to the admin-UI banner so operators see sustained failures
 * rather than a silent green status.
 */
export function setupEnhancedEmissionSystem(
  instance: PluginInstance,
  config: PluginConfiguration,
  app: ServerAPI
): void {
  const emissionInterval = config.emissionInterval * 1000;

  instance.emissionTimer = setInterval(() => {
    try {
      emitWeatherTick(instance, app);
    } catch (error) {
      // Surface to the operator-facing banner, not just the log: a sustained
      // emission failure would otherwise leave a green "Running" status while no
      // data reaches the bus. setBanner dedupes, so a steady failure is one
      // banner write, and the next successful tick overwrites it with live status.
      const errorMessage = toErrorMessage(error);
      instance.logger('error', 'Error in emission timer', { error: errorMessage });
      setBanner(instance, app, 'error', `Emission failed: ${errorMessage}`);
    }
  }, emissionInterval);

  instance.logger('info', 'Emission system configured', {
    intervalSeconds: config.emissionInterval,
  });
}

/**
 * Single emission tick: refreshes the cached delta when weather data has
 * changed, preserves the provider's observation timestamp on rebroadcast, and
 * skips emission entirely when the service reports the upstream data has gone stale.
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
  // keeps broadcasting cached in-window data on the configured cadence, but
  // every rebroadcast retains the original provider measurement timestamp.
  if (instance.weatherService.isDataStale()) {
    return;
  }

  // Only rebuild delta when weather data changes (reference comparison).
  // Notifications are evaluated on the same edge: transitions only fire when
  // the underlying snapshot changes, so re-evaluating on every emission tick
  // would waste CPU on the steady-state case.
  let notificationValues: PathValue[] | undefined;
  if (weatherData !== instance.cachedWeatherDataRef) {
    const refreshed = refreshCachedDelta(instance, app, weatherData, instance.pathMapper);
    if (refreshed === null) return;
    notificationValues = refreshed;
  }

  if (!instance.cachedDelta) {
    return;
  }

  app.handleMessage(PLUGIN.NAME, instance.cachedDelta, SKVersion.v1);

  // Notifications ride a separate delta so consumers walking the values delta
  // do not see a `notifications.*` leaf interleaved with measurements. The
  // notifier returned PathValues only on transition, so a non-empty list here
  // always represents an entry or exit edge.
  if (notificationValues?.length) {
    app.handleMessage(
      PLUGIN.NAME,
      buildValuesDelta(notificationValues, undefined, instance.sourceRef),
      SKVersion.v1
    );
  }

  // Ship the static meta block once per plugin lifetime, AFTER the first
  // values delta so admin UIs that render units lazily attach them on first
  // paint. The Signal K spec recommends emitting meta only when it changes;
  // this plugin's meta is fully static.
  if (!instance.metaEmitted) {
    app.handleMessage(PLUGIN.NAME, instance.pathMapper.buildMetaDelta(), SKVersion.v1);
    instance.metaEmitted = true;
  }

  // Optional sea-state layer rides the same keep-alive cadence and is reached
  // only past the staleness gate above, so marine data ages out with weather.
  emitMarineTick(instance, app);
}

/**
 * Emit the optional marine (sea-state) delta. No-op when the marine layer is
 * disabled, before the first marine fetch, or for an inland point where the
 * model has no data (so the marine meta is never shipped without real data).
 * The cached delta preserves its marine observation timestamp and distinct
 * `$source`, and the meta block ships exactly once.
 * @private
 */
function emitMarineTick(instance: PluginInstance, app: ServerAPI): void {
  const mapper = instance.marinePathMapper;
  if (!mapper) return;

  const marine = instance.weatherService?.getCurrentMarineData();
  if (!marine) return;

  // Cheap pointer compare first: the steady-state tick (unchanged snapshot)
  // skips the per-field emptiness scan, which only runs on a genuinely new
  // snapshot. An inland point with no usable sea-state pins a null delta so the
  // tick emits nothing (and the marine meta never ships without real data).
  if (marine !== instance.cachedMarineDataRef) {
    instance.cachedMarineDataRef = marine;
    instance.cachedMarineDelta = isMarineDataEmpty(marine)
      ? null
      : mapper.mapToSignalKPaths(marine);
  }
  if (!instance.cachedMarineDelta) return;

  app.handleMessage(PLUGIN.NAME, instance.cachedMarineDelta, SKVersion.v1);

  if (!instance.marineMetaEmitted) {
    app.handleMessage(PLUGIN.NAME, mapper.buildMetaDelta(), SKVersion.v1);
    instance.marineMetaEmitted = true;
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
    // Mapper failure: drop the cached delta so we stop emitting invalid data.
    // Pin cachedWeatherDataRef to this snapshot so the emission tick's ref-equality
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
