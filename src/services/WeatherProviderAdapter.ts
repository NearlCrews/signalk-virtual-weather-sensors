/**
 * Adapts AccuWeather data to the Signal K v2 Weather API provider contract.
 * Registration of the returned provider advertises the provider in
 * /signalk/v2/api/weather/_providers, which is what lets consumers like
 * signalk-open-binnacle show their weather UI. Forecasts and observations are
 * AccuWeather-backed; warnings come from the region-aware (keyless) WarningsService
 * when one is supplied, otherwise warnings throw the SK-conventional 'Not supported!'.
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
import {
  mapCurrentToObservation,
  mapDailyToForecasts,
  mapHourlyToForecasts,
} from '../mappers/WeatherProviderMapper.js';
import type { GeoLocation, Logger } from '../types/index.js';
import type { AccuWeatherService } from './AccuWeatherService.js';
import type { WarningsService } from './WarningsService.js';

export class WeatherProviderAdapter {
  constructor(
    private readonly accuWeather: AccuWeatherService,
    private readonly warningsService?: WarningsService,
    private readonly logger: Logger = () => {}
  ) {}

  /** Build the WeatherProvider object passed to app.registerWeatherProvider. */
  public toProvider(): WeatherProvider {
    return {
      name: PLUGIN.PROVIDER_NAME,
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
        ? mapDailyToForecasts(await this.accuWeather.getDailyForecast(location))
        : mapHourlyToForecasts(await this.accuWeather.getHourlyForecast(location));

    // Only `maxCount` is honored: the AccuWeather 12-hour/5-day endpoints expose
    // no start-date or custom-window knob, so `options.startDate`/`custom` are
    // intentionally unsupported here rather than silently approximated.
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
    const observation = mapCurrentToObservation(
      await this.accuWeather.getCurrentConditionsForLocation(location)
    );
    // A single current observation; descending date order is trivially satisfied.
    return [observation];
  }

  private async getWarnings(position: Position): Promise<WeatherWarning[]> {
    // Warnings are keyless and region-aware (NWS for US waters), independent of
    // the AccuWeather forecast/observation backing. Without a warnings service
    // wired in, signal the SK-conventional "not served".
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
