/**
 * Adapts AccuWeather forecast data to the Signal K v2 Weather API provider
 * contract. Registration of the returned provider makes the server advertise
 * `weather` in /signalk/v2/features, which is what lets consumers like
 * signalk-open-binnacle show their weather UI. Phase 1 implements forecasts
 * only; observations and warnings throw the SK-conventional 'Not supported!'.
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
import { mapDailyToForecasts, mapHourlyToForecasts } from '../mappers/WeatherProviderMapper.js';
import type { GeoLocation, Logger } from '../types/index.js';
import type { AccuWeatherService } from './AccuWeatherService.js';

export class WeatherProviderAdapter {
  constructor(
    private readonly accuWeather: AccuWeatherService,
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

    const maxCount = options?.maxCount;
    return typeof maxCount === 'number' && maxCount > 0 ? forecasts.slice(0, maxCount) : forecasts;
  }

  private async getObservations(): Promise<SKWeatherData[]> {
    // Phase 2: map the latest current-conditions observation. Until then, the
    // SK-conventional signal that this provider does not serve observations.
    throw new Error('Not supported!');
  }

  private async getWarnings(): Promise<WeatherWarning[]> {
    // Phase 3: map the AccuWeather alerts endpoint (best-effort, 403-tolerant
    // on the free tier). Until then, signal that warnings are not served.
    throw new Error('Not supported!');
  }
}
