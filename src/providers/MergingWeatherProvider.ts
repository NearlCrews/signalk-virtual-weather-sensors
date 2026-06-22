/**
 * Synthesis merge provider.
 *
 * Fetches current conditions from all child providers concurrently, collects
 * survivors in priority order, and blends them via mergeWeatherData. A single
 * survivor is returned unchanged (no synthesis). Zero survivors throws,
 * preserving the same failure contract as a plain provider.
 *
 * Forecasts and observations are delegated to a designated forecast-capable
 * child so the v2 Weather API envelope is internally coherent. Blending a
 * single observation's pressure across providers is a noted deferred enhancement.
 */

import type { WeatherData as SKWeatherData } from '@signalk/server-api';
import type { GeoLocation, Logger, WeatherData } from '../types/index.js';
import { mergeWeatherData } from './mergeWeatherData.js';
import type {
  CurrentWeatherProvider,
  ForecastCapabilities,
  ForecastCapableProvider,
} from './WeatherProvider.js';

export const MERGED_PROVIDER_NAME = 'Virtual Weather Sensors (merged)';

/** Collect fulfilled values from allSettled results in their original order. */
function collectSurvivors(
  children: ReadonlyArray<CurrentWeatherProvider>,
  results: PromiseSettledResult<WeatherData>[],
  logger: Logger
): WeatherData[] {
  const survivors: WeatherData[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result?.status === 'fulfilled') {
      survivors.push(result.value);
    } else if (result?.status === 'rejected') {
      logger(
        'warn',
        `Weather provider "${children[i]?.name ?? 'unknown'}" failed: ${String(result.reason)}`
      );
    }
  }
  return survivors;
}

export class MergingWeatherProvider implements ForecastCapableProvider {
  readonly name = MERGED_PROVIDER_NAME;
  readonly sourceRef = 'merged';
  readonly forecastCapabilities: ForecastCapabilities;

  private readonly children: ReadonlyArray<CurrentWeatherProvider>;
  private readonly forecastChild: ForecastCapableProvider;
  private readonly logger: Logger;

  constructor(
    children: ReadonlyArray<CurrentWeatherProvider>,
    forecastChild: ForecastCapableProvider,
    logger: Logger = () => {}
  ) {
    if (children.some((c) => c instanceof MergingWeatherProvider)) {
      throw new Error(
        'MergingWeatherProvider does not support nesting: a child may not itself be a MergingWeatherProvider'
      );
    }
    this.children = children;
    this.forecastChild = forecastChild;
    this.logger = logger;
    this.forecastCapabilities = forecastChild.forecastCapabilities;
  }

  async fetchCurrentWeather(location: GeoLocation): Promise<WeatherData> {
    const results = await Promise.allSettled(
      this.children.map((c) => c.fetchCurrentWeather(location))
    );
    const survivors = collectSurvivors(this.children, results, this.logger);
    if (survivors.length === 0) {
      throw new Error('All weather providers failed: no current conditions available');
    }
    if (survivors.length === 1) {
      // Single survivor returned unchanged, no synthesis.
      // biome-ignore lint/style/noNonNullAssertion: length === 1 checked above
      return survivors[0]!;
    }
    return mergeWeatherData(survivors);
  }

  getObservation(location: GeoLocation): Promise<SKWeatherData> {
    return this.forecastChild.getObservation(location);
  }

  getHourlyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
    return this.forecastChild.getHourlyForecast(location);
  }

  getDailyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
    return this.forecastChild.getDailyForecast(location);
  }

  getRequestCount(): number {
    return this.children.reduce((sum, c) => sum + c.getRequestCount(), 0);
  }

  getRequestCountLast24h(): number {
    return this.children.reduce((sum, c) => sum + c.getRequestCountLast24h(), 0);
  }

  getCacheStats(): { size: number } {
    return { size: this.children.reduce((sum, c) => sum + c.getCacheStats().size, 0) };
  }
}
