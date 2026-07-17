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
  construct(
    config: PluginConfiguration,
    logger: Logger,
    runtime?: ProviderRuntimeOptions
  ): CurrentWeatherProvider;
}

export interface ProviderRuntimeOptions {
  readonly signal?: AbortSignal | undefined;
  readonly quotaStatePath?: string | undefined;
}

export const PROVIDER_CATALOG: Readonly<Record<WeatherProviderId, ProviderCatalogEntry>> =
  Object.freeze({
    'open-meteo': {
      construct: (config, logger, runtime) =>
        new OpenMeteoService(logger, {
          ...(config.openMeteoBaseUrl && { baseUrl: config.openMeteoBaseUrl }),
          signal: runtime?.signal,
        }),
    },
    accuweather: {
      construct: (config, logger, runtime) =>
        new AccuWeatherService(config.accuWeatherApiKey, logger, {
          dailyApiQuota: config.dailyApiQuota,
          quotaStatePath: runtime?.quotaStatePath,
          signal: runtime?.signal,
        }),
    },
    'met-no': {
      construct: (_config, logger, runtime) =>
        new MetNoService(logger, { signal: runtime?.signal }),
    },
  });
