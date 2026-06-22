import type { Logger, PluginConfiguration } from '../types/index.js';
import { PROVIDER_CATALOG } from './providerCatalog.js';
import type { CurrentWeatherProvider } from './WeatherProvider.js';

export function createCurrentWeatherProvider(
  config: PluginConfiguration,
  logger: Logger = () => {}
): CurrentWeatherProvider {
  return PROVIDER_CATALOG[config.weatherProvider].construct(config, logger);
}
