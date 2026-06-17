/**
 * Construct the current-conditions provider the config selects.
 *
 * Central place that maps `config.weatherProvider` onto a concrete
 * `CurrentWeatherProvider`, so the plugin entry and the orchestration only ever
 * see the interface. AccuWeather carries its key and shared daily-quota budget;
 * Open-Meteo is keyless and takes only its (optional) base-URL override.
 */

import { AccuWeatherService } from '../services/AccuWeatherService.js';
import { OpenMeteoService } from '../services/OpenMeteoService.js';
import type { Logger, PluginConfiguration } from '../types/index.js';
import type { CurrentWeatherProvider } from './WeatherProvider.js';

export function createCurrentWeatherProvider(
  config: PluginConfiguration,
  logger: Logger = () => {}
): CurrentWeatherProvider {
  if (config.weatherProvider === 'accuweather') {
    return new AccuWeatherService(config.accuWeatherApiKey, logger, {
      dailyApiQuota: config.dailyApiQuota,
    });
  }
  // Open-Meteo: keyless. Pass the base-URL override only when set so the
  // service applies its own default host otherwise.
  return new OpenMeteoService(
    logger,
    config.openMeteoBaseUrl ? { baseUrl: config.openMeteoBaseUrl } : undefined
  );
}
