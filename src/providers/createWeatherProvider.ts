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
import { PROVIDER_CATALOG } from './providerCatalog.js';
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
  logger: Logger = () => {}
): CurrentWeatherProvider {
  if (resolveWeatherMode(config.weatherMode) === 'single') {
    return createCurrentWeatherProvider(config, logger);
  }
  // Honor the operator's explicit provider selection and order, intersected with
  // the providers that are actually available given the current config. A keyed
  // provider (AccuWeather) is excluded when no key is present.
  const preference = resolveMergeProviders(config.mergeProviders, config.weatherProvider);
  const available = availableProviderIds(config);
  const ordered = preference.filter((id) => available.includes(id));
  if (ordered.length <= 1) {
    // Fewer than two selected providers are available. Degrade to single rather
    // than a one-child "merge", and log it so the operator can correct the config.
    logger(
      'warn',
      'Merged mode: fewer than two selected providers are available, using single-source'
    );
    return createCurrentWeatherProvider(config, logger);
  }
  const children = ordered.map((id) => PROVIDER_CATALOG[id].construct(config, logger));
  const forecastChild = children.find(supportsForecasts);
  if (!forecastChild) {
    // No forecast-capable child. Not reachable today: Open-Meteo is always
    // available and forecast-capable (and Met.no is too since phase 2), so a
    // forecast child always exists. Degrade to single rather than a merge that
    // cannot serve the v2 forecast surface, and log it.
    logger('warn', 'Merged mode: no forecast-capable provider, using single-source');
    return createCurrentWeatherProvider(config, logger);
  }
  return new MergingWeatherProvider(children, forecastChild, logger);
}
