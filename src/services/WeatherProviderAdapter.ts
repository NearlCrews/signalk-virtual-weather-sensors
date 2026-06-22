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
import type { WarningsService } from './WarningsService.js';

export class WeatherProviderAdapter {
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
        getObservations: this.getObservations.bind(this),
        getForecasts: this.getForecasts.bind(this),
        getWarnings: this.getWarnings.bind(this),
      },
    };
  }

  private async getForecasts(
    position: Position,
    type: WeatherForecastType,
    options?: WeatherReqParams
  ): Promise<SKWeatherData[]> {
    this.logger('debug', 'Weather provider forecast request', { type });
    const location: GeoLocation = { latitude: position.latitude, longitude: position.longitude };
    const forecasts =
      type === 'daily'
        ? await this.provider.getDailyForecast(location)
        : await this.provider.getHourlyForecast(location);

    // Only `maxCount` is honored: the provider interface exposes no offset or
    // window parameter, so `options.startDate`/`custom` are not forwarded here
    // rather than silently approximated.
    const maxCount = options?.maxCount;
    return typeof maxCount === 'number' && maxCount > 0 ? forecasts.slice(0, maxCount) : forecasts;
  }

  private async getObservations(
    position: Position,
    // `maxCount` is moot: this returns exactly one current observation, so there
    // is nothing to cap.
    _options?: WeatherReqParams
  ): Promise<SKWeatherData[]> {
    this.logger('debug', 'Weather provider observation request');
    // Honor the caller-supplied position (the endpoint passes an arbitrary
    // lat/lon, not the vessel position), fetching current conditions there.
    const location: GeoLocation = { latitude: position.latitude, longitude: position.longitude };
    // A single current observation; descending date order is trivially satisfied.
    return [await this.provider.getObservation(location)];
  }

  private async getWarnings(position: Position): Promise<WeatherWarning[]> {
    // Warnings are keyless and region-aware (NWS for US waters), independent of
    // the forecast/observation backing. Without a warnings service wired in,
    // signal the SK-conventional "not served".
    if (!this.warningsService) {
      throw new Error('Not supported!');
    }
    this.logger('debug', 'Weather provider warnings request');
    return this.warningsService.getWarnings({
      latitude: position.latitude,
      longitude: position.longitude,
    });
  }
}
