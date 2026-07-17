/**
 * Constructs the weather provider the config selects, honoring weatherMode.
 * In single mode this is the catalog provider for config.weatherProvider. In
 * merged mode it builds the providers the operator selected in `mergeProviders`
 * (primary first), filtered to those actually available given the current
 * config, and wraps them in a MergingWeatherProvider. Degrades to single when
 * fewer than two selected providers are available.
 */
import {
  providerRequiresApiKey,
  resolveMergeProviders,
  resolveWeatherMode,
  WEATHER_PROVIDER_IDS,
  type WeatherProviderId,
} from '../constants/notifications-shared.js';
import type { Logger, PluginConfiguration } from '../types/index.js';
import { createCurrentWeatherProvider } from './createCurrentWeatherProvider.js';
import { MergingWeatherProvider } from './MergingWeatherProvider.js';
import { PROVIDER_CATALOG, type ProviderRuntimeOptions } from './providerCatalog.js';
import { type CurrentWeatherProvider, supportsForecasts } from './WeatherProvider.js';

/** Provider ids available given the config: keyless always, keyed only when a key is present. */
function availableProviderIds(config: PluginConfiguration): WeatherProviderId[] {
  // The `id === 'accuweather'` check ties the AccuWeather key to its specific
  // provider; a future keyed provider needs its own clause here, not a generic
  // `!!config.accuWeatherApiKey` that would wrongly mark it available on the wrong key.
  return WEATHER_PROVIDER_IDS.filter(
    (id) => !providerRequiresApiKey(id) || (id === 'accuweather' && !!config.accuWeatherApiKey)
  );
}

export function createWeatherProvider(
  config: PluginConfiguration,
  logger: Logger = () => {},
  runtime?: ProviderRuntimeOptions
): CurrentWeatherProvider {
  if (resolveWeatherMode(config.weatherMode) === 'single') {
    return createCurrentWeatherProvider(config, logger, runtime);
  }
  // Honor the operator's explicit provider selection and order, intersected with
  // the providers that are actually available given the current config. A keyed
  // provider (AccuWeather) is excluded when no key is present.
  const preference = resolveMergeProviders(config.mergeProviders, config.weatherProvider);
  const available = availableProviderIds(config);
  const ordered = preference.filter((id) => available.includes(id));
  if (ordered.length === 0) {
    throw new Error(
      'INVALID_CONFIGURATION: merged mode has no available selected weather provider'
    );
  }
  if (ordered.length === 1) {
    const survivor = ordered[0];
    if (survivor === undefined) throw new Error('Unreachable provider selection state');
    logger('warn', `Merged mode: only ${survivor} is available, using it as a single source`);
    return PROVIDER_CATALOG[survivor].construct(config, logger, runtime);
  }
  const children = ordered.map((id) => PROVIDER_CATALOG[id].construct(config, logger, runtime));
  const forecastChildren = children.filter(supportsForecasts);
  if (forecastChildren.length === 0) {
    // No forecast-capable child. Not reachable today: Open-Meteo is always
    // available and forecast-capable (and Met.no is too since phase 2), so a
    // forecast child always exists. Degrade to single rather than a merge that
    // cannot serve the v2 forecast surface, and log it.
    logger('warn', 'Merged mode: no forecast-capable provider, using single-source');
    const primary = ordered[0];
    if (primary === undefined) throw new Error('Unreachable provider selection state');
    return PROVIDER_CATALOG[primary].construct(config, logger, runtime);
  }
  return new MergingWeatherProvider(children, forecastChildren, logger);
}
