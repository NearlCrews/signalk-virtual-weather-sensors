/**
 * Construction registry for current-weather providers, keyed by the same ids
 * the panel-safe registry in notifications-shared.ts exposes. Splitting the
 * construction half out here keeps Node-only service imports out of the
 * panel build. Adding a provider is one entry here plus one id and label in
 * notifications-shared.ts, plus the service and its mappers.
 */
import type { WeatherProviderId } from '../constants/notifications-shared.js';
import { AccuWeatherService } from '../services/AccuWeatherService.js';
import { MetNoService } from '../services/MetNoService.js';
import { OpenMeteoService } from '../services/OpenMeteoService.js';
import type { Logger, PluginConfiguration } from '../types/index.js';
import type { CurrentWeatherProvider } from './WeatherProvider.js';

export interface ProviderCatalogEntry {
  /** Build the provider from validated config. */
  construct(config: PluginConfiguration, logger: Logger): CurrentWeatherProvider;
}

export const PROVIDER_CATALOG: Readonly<Record<WeatherProviderId, ProviderCatalogEntry>> =
  Object.freeze({
    'open-meteo': {
      construct: (config, logger) =>
        new OpenMeteoService(
          logger,
          config.openMeteoBaseUrl ? { baseUrl: config.openMeteoBaseUrl } : undefined
        ),
    },
    accuweather: {
      construct: (config, logger) =>
        new AccuWeatherService(config.accuWeatherApiKey, logger, {
          dailyApiQuota: config.dailyApiQuota,
        }),
    },
    'met-no': {
      construct: (_config, logger) => new MetNoService(logger),
    },
  });
