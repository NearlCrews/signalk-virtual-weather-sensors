/**
 * Constructs the configured current-weather provider by looking up the
 * resolved provider id in PROVIDER_CATALOG and calling its factory.
 */
import type { Logger, PluginConfiguration } from '../types/index.js';
import { PROVIDER_CATALOG, type ProviderRuntimeOptions } from './providerCatalog.js';
import type { CurrentWeatherProvider } from './WeatherProvider.js';

export function createCurrentWeatherProvider(
  config: PluginConfiguration,
  logger: Logger = () => {},
  runtime?: ProviderRuntimeOptions
): CurrentWeatherProvider {
  return PROVIDER_CATALOG[config.weatherProvider].construct(config, logger, runtime);
}
