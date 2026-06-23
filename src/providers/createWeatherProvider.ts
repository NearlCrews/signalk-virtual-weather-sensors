/**
 * Constructs the weather provider the config selects, honoring weatherMode.
 * In single mode this is the catalog provider for config.weatherProvider. In
 * merged mode it builds every available provider (the primary first, then the
 * rest in catalog order) and wraps them in a MergingWeatherProvider, degrading
 * to the single available provider when only one exists.
 */
import {
  providerRequiresApiKey,
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
  // Priority order: the configured provider is the primary ONLY when it is
  // actually available (a keyed provider needs its key). Guard against prepending
  // a primary that was filtered out of `available`: an explicit `weatherProvider`
  // wins in `resolveWeatherProvider` even without a key (for example AccuWeather
  // via a hand-edited config), and constructing that keyless child would fail
  // every fetch and log noise on every tick. When the primary is unavailable,
  // merge over the available set in catalog order instead.
  const available = availableProviderIds(config);
  const primary = config.weatherProvider;
  const ordered: WeatherProviderId[] = available.includes(primary)
    ? [primary, ...available.filter((id) => id !== primary)]
    : [...available];
  if (ordered.length <= 1) {
    // Only one provider available (not reachable while Open-Meteo and Met.no are
    // both keyless and always present). Degrade to single rather than a one-child
    // "merge", and log it so a future single-keyless config is visible.
    logger('warn', 'Merged mode: only one provider available, using it single-source');
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
