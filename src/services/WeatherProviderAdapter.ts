/**
 * Adapts a ForecastCapableProvider to the Signal K v2 Weather API provider contract.
 * Registration of the returned provider advertises the provider in
 * /signalk/v2/api/weather/_providers, which is what lets consumers like
 * signalk-open-binnacle show their weather UI. Forecasts and observations are
 * delegated to the injected provider; warnings come from the region-aware (keyless)
 * WarningsService when one is supplied, otherwise warnings throw the SK-conventional
 * 'Not supported!'.
 */
import type {
  Position,
  WeatherData as SKWeatherData,
  WeatherForecastType,
  WeatherProvider,
  WeatherReqParams,
  WeatherWarning,
} from '@signalk/server-api';
import { PLUGIN } from '../constants/index.js';
import type { ForecastCapableProvider } from '../providers/WeatherProvider.js';
import type { GeoLocation, Logger } from '../types/index.js';
import { isValidCoordinates } from '../utils/conversions.js';
import type { WarningsService } from './WarningsService.js';

export class WeatherProviderAdapter {
  private readonly activeRequests = new Set<Promise<unknown>>();
  constructor(
    private readonly provider: ForecastCapableProvider,
    private readonly warningsService?: WarningsService,
    private readonly logger: Logger = () => {}
  ) {}

  /** Build the WeatherProvider object passed to app.registerWeatherProvider. */
  public toProvider(): WeatherProvider {
    return {
      name: this.provider.name,
      methods: {
        pluginId: PLUGIN.NAME,
        getObservations: (...args) => this.track(this.getObservations(...args)),
        getForecasts: (...args) => this.track(this.getForecasts(...args)),
        getWarnings: (...args) => this.track(this.getWarnings(...args)),
      },
    };
  }

  public async waitForIdle(timeoutMs = 1000): Promise<void> {
    if (this.activeRequests.size === 0) return;
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...this.activeRequests]),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
  }

  private track<T>(request: Promise<T>): Promise<T> {
    this.activeRequests.add(request);
    request.finally(() => this.activeRequests.delete(request)).catch(() => {});
    return request;
  }

  private async getForecasts(
    position: Position,
    type: WeatherForecastType,
    options?: WeatherReqParams
  ): Promise<SKWeatherData[]> {
    this.logger('debug', 'Weather provider forecast request', { type });
    const location = this.toLocation(position);
    this.validateOptions(options);
    if (type !== 'daily' && type !== 'point') {
      throw new Error('Invalid weather forecast type');
    }
    const forecasts =
      type === 'daily'
        ? await this.provider.getDailyForecast(location)
        : await this.provider.getHourlyForecast(location);

    return this.applyOptions(forecasts, options, 'ascending');
  }

  private async getObservations(
    position: Position,
    options?: WeatherReqParams
  ): Promise<SKWeatherData[]> {
    this.logger('debug', 'Weather provider observation request');
    // Honor the caller-supplied position (the endpoint passes an arbitrary
    // lat/lon, not the vessel position), fetching current conditions there.
    const location = this.toLocation(position);
    this.validateOptions(options);
    // A single current observation; descending date order is trivially satisfied.
    return this.applyOptions([await this.provider.getObservation(location)], options, 'descending');
  }

  private async getWarnings(position: Position): Promise<WeatherWarning[]> {
    // Warnings are keyless and region-aware (NWS for US waters, MetAlerts for
    // Norwegian waters), independent of the forecast/observation backing. Without
    // a warnings service wired in, signal the SK-conventional "not served".
    if (!this.warningsService) {
      throw new Error('Not supported!');
    }
    this.logger('debug', 'Weather provider warnings request');
    return this.warningsService.getWarnings({
      ...this.toLocation(position),
    });
  }

  private toLocation(position: Position): GeoLocation {
    if (!isValidCoordinates(position.latitude, position.longitude)) {
      throw new Error('Invalid weather request position');
    }
    return { latitude: position.latitude, longitude: position.longitude };
  }

  private applyOptions(
    records: SKWeatherData[],
    options: WeatherReqParams | undefined,
    order: 'ascending' | 'descending'
  ): SKWeatherData[] {
    const datedRecords = records.map((record) => {
      const timestampMs = Date.parse(record.date);
      if (!Number.isFinite(timestampMs)) {
        throw new Error('Weather provider returned a record with an invalid date');
      }
      return { record, timestampMs };
    });
    datedRecords.sort((a, b) =>
      order === 'ascending' ? a.timestampMs - b.timestampMs : b.timestampMs - a.timestampMs
    );

    let filtered = datedRecords;
    if (options?.startDate !== undefined) {
      const startMs = Date.parse(options.startDate);
      if (!Number.isFinite(startMs)) {
        throw new Error('Invalid weather request startDate');
      }
      filtered = filtered.filter(({ timestampMs }) => timestampMs >= startMs);
    }

    if (options?.maxCount !== undefined) {
      if (!Number.isInteger(options.maxCount) || options.maxCount < 0) {
        throw new Error('Invalid weather request maxCount');
      }
      filtered = filtered.slice(0, options.maxCount);
    }

    return filtered.map(({ record }) => record);
  }

  private validateOptions(options: WeatherReqParams | undefined): void {
    if (options?.custom && Object.keys(options.custom).length > 0) {
      throw new Error('Not supported! Custom weather request parameters are not supported.');
    }
    if (options?.startDate !== undefined && !Number.isFinite(Date.parse(options.startDate))) {
      throw new Error('Invalid weather request startDate');
    }
    if (
      options?.maxCount !== undefined &&
      (!Number.isInteger(options.maxCount) || options.maxCount < 0)
    ) {
      throw new Error('Invalid weather request maxCount');
    }
  }
}
