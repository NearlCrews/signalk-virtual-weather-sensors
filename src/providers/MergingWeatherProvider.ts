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

import type { WeatherData as SKWeatherData } from '@signalk/server-api'; // aliased to avoid collision with the internal WeatherData type
import type { GeoLocation, Logger, WeatherData } from '../types/index.js';
import { isAbortError, normalizeIsoTimestamp, toErrorMessage } from '../utils/conversions.js';
import { mergeWeatherData } from './mergeWeatherData.js';
import type {
  CurrentWeatherProvider,
  ForecastCapabilities,
  ForecastCapableProvider,
} from './WeatherProvider.js';

export const MERGED_PROVIDER_NAME = 'Virtual Weather Sensors (merged)';
export const MERGE_MAX_OBSERVATION_SKEW_MS = 60 * 60 * 1000;
const DEFAULT_MAX_OBSERVATION_AGE_MS = 3 * 60 * 60 * 1000;

/** Collect fulfilled values from allSettled results in their original order. */
function collectSurvivors(
  children: ReadonlyArray<CurrentWeatherProvider>,
  results: PromiseSettledResult<WeatherData>[],
  logger: Logger,
  now = Date.now()
): WeatherData[] {
  const candidates: Array<{ data: WeatherData; timestampMs: number }> = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result?.status === 'fulfilled') {
      const normalized = normalizeIsoTimestamp(result.value.timestamp);
      const timestampMs = Date.parse(normalized);
      const maxAge = children[i]?.maxObservationAgeMs ?? DEFAULT_MAX_OBSERVATION_AGE_MS;
      if (
        normalized === '' ||
        !Number.isFinite(timestampMs) ||
        timestampMs > now + 5 * 60 * 1000 ||
        now - timestampMs > maxAge
      ) {
        logger(
          'warn',
          `Ignoring stale or invalid observation from ${children[i]?.name ?? 'unknown'}`
        );
        continue;
      }
      candidates.push({ data: { ...result.value, timestamp: normalized }, timestampMs });
    } else if (result?.status === 'rejected') {
      logger('warn', `Weather provider "${children[i]?.name ?? 'unknown'}" failed`, {
        error: toErrorMessage(result.reason),
      });
    }
  }
  const newest = Math.max(...candidates.map(({ timestampMs }) => timestampMs));
  const survivors = candidates.filter(
    ({ timestampMs }) => newest - timestampMs <= MERGE_MAX_OBSERVATION_SKEW_MS
  );
  if (survivors.length < candidates.length) {
    logger('warn', 'Ignoring weather observations outside the merge time-skew window', {
      ignored: candidates.length - survivors.length,
    });
  }
  return survivors.map(({ data }) => data);
}

export class MergingWeatherProvider implements ForecastCapableProvider {
  readonly name = MERGED_PROVIDER_NAME;
  // `vws-` namespaces the synthetic blend in the data browser so it is clearly
  // this plugin's merge and does not collide with a generic `merged` source.
  readonly sourceRef = 'vws-merged';
  readonly maxObservationAgeMs = DEFAULT_MAX_OBSERVATION_AGE_MS;
  readonly forecastCapabilities: ForecastCapabilities;

  private readonly children: ReadonlyArray<CurrentWeatherProvider>;
  private readonly forecastChildren: ReadonlyArray<ForecastCapableProvider>;
  private readonly logger: Logger;

  constructor(
    children: ReadonlyArray<CurrentWeatherProvider>,
    forecastChildren: ForecastCapableProvider | ReadonlyArray<ForecastCapableProvider>,
    logger: Logger = () => {}
  ) {
    if (children.some((c) => c instanceof MergingWeatherProvider)) {
      throw new Error(
        'MergingWeatherProvider does not support nesting: a child may not itself be a MergingWeatherProvider'
      );
    }
    this.children = children;
    this.forecastChildren = Array.isArray(forecastChildren)
      ? forecastChildren
      : [forecastChildren as ForecastCapableProvider];
    this.logger = logger;
    if (this.forecastChildren.length === 0) {
      throw new Error('MergingWeatherProvider requires at least one forecast-capable child');
    }
    this.forecastCapabilities = {
      hourlyHours: Math.min(
        ...this.forecastChildren.map((child) => child.forecastCapabilities.hourlyHours)
      ),
      dailyDays: Math.min(
        ...this.forecastChildren.map((child) => child.forecastCapabilities.dailyDays)
      ),
    };
  }

  async fetchCurrentWeather(location: GeoLocation): Promise<WeatherData> {
    const results = await Promise.allSettled(
      this.children.map((c) => c.fetchCurrentWeather(location))
    );
    const cancelled = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected' && isAbortError(result.reason)
    );
    if (cancelled) throw cancelled.reason;
    const survivors = collectSurvivors(this.children, results, this.logger);
    if (survivors.length === 0) {
      throw new Error('All weather providers failed: no current conditions available');
    }
    if (survivors.length === 1) {
      // Single survivor returned unchanged, no synthesis.
      // biome-ignore lint/style/noNonNullAssertion: length === 1 checked above
      return survivors[0]!;
    }
    const merged = mergeWeatherData(survivors);
    const oldestTimestamp = survivors.reduce(
      (oldest, data) => (Date.parse(data.timestamp) < Date.parse(oldest) ? data.timestamp : oldest),
      survivors[0]?.timestamp ?? merged.timestamp
    );
    return { ...merged, timestamp: oldestTimestamp };
  }

  getObservation(location: GeoLocation): Promise<SKWeatherData> {
    return this.withForecastFailover('observation', (child) => child.getObservation(location));
  }

  getHourlyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
    return this.withForecastFailover(
      'hourly forecast',
      (child) => child.getHourlyForecast(location),
      true
    );
  }

  getDailyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
    return this.withForecastFailover(
      'daily forecast',
      (child) => child.getDailyForecast(location),
      true
    );
  }

  private async withForecastFailover<T>(
    operation: string,
    run: (child: ForecastCapableProvider) => Promise<T>,
    requireNonEmptyArray = false
  ): Promise<T> {
    for (const child of this.forecastChildren) {
      try {
        const result = await run(child);
        if (requireNonEmptyArray && Array.isArray(result) && result.length === 0) {
          throw new Error('provider returned no records');
        }
        return result;
      } catch (error) {
        if (isAbortError(error)) throw error;
        this.logger('warn', `${child.name} ${operation} failed, trying next provider`, {
          error: toErrorMessage(error),
        });
      }
    }
    throw new Error(`All weather providers failed to supply ${operation}`);
  }

  /** Sum a numeric accessor across every child provider. */
  private sumAcrossChildren(read: (child: CurrentWeatherProvider) => number): number {
    return this.children.reduce((sum, c) => sum + read(c), 0);
  }

  getRequestCount(): number {
    return this.sumAcrossChildren((c) => c.getRequestCount());
  }

  getRequestCountLast24h(): number {
    return this.sumAcrossChildren((c) => c.getRequestCountLast24h());
  }

  getCacheStats(): { size: number } {
    return { size: this.sumAcrossChildren((c) => c.getCacheStats().size) };
  }

  isCurrentWeatherFetchBlocked(): boolean {
    return false;
  }
}
