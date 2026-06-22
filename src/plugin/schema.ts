/**
 * rjsf schema and uiSchema for the Signal K admin UI config form.
 *
 * The objects returned here are exactly what the inline `schema`/`uiSchema`
 * arrow functions in `index.ts` returned, except the `notifications.properties`
 * band toggles and the `notifications` `ui:order` are generated from the shared
 * band registry so the schema cannot drift from the federated panel.
 */

import {
  CONFIG_DEFAULTS,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_WEATHER_PROVIDER,
  NOTIFICATION_BAND_KEYS,
  NOTIFICATION_LABELS,
  NOTIFICATION_MASTER_LABEL,
  WEATHER_PROVIDER_IDS,
  WEATHER_PROVIDER_LABELS,
} from '../constants/notifications-shared.js';

/** Per-band boolean toggles, generated from the shared band registry so the schema cannot drift from the panel. */
function notificationBandProperties(): Record<
  string,
  { type: 'boolean'; title: string; default: boolean }
> {
  return Object.fromEntries(
    NOTIFICATION_BAND_KEYS.map((key) => [
      key,
      { type: 'boolean', title: NOTIFICATION_LABELS[key], default: DEFAULT_NOTIFICATIONS[key] },
    ])
  );
}

/**
 * Plugin configuration schema for Signal K server UI.
 *
 * Notes on what the admin UI actually consumes:
 *  - Outer `title` is discarded: the SK admin UI wraps the schema and
 *    forces the wrapper title to a single space. The displayed name
 *    comes from `plugin.name` (PLUGIN.DISPLAY_NAME).
 *  - Outer `required` is also discarded by the wrapper. The API key is
 *    optional (it is only needed for AccuWeather), so it is enforced at
 *    runtime via `ConfigurationValidator.validateConfiguration` when
 *    AccuWeather is the active provider, not by a schema `minLength`. We
 *    therefore do not declare an outer `required` array (it would be dead UI).
 */
export const pluginSchema = () => ({
  type: 'object',
  description:
    'Weather to Signal K with NMEA2000-compatible environmental measurements. Open-Meteo (default) is free and needs no API key; AccuWeather needs a key and adds extra fields.',
  properties: {
    weatherProvider: {
      type: 'string',
      title: 'Weather source',
      description:
        'Open-Meteo is free, global, and needs no API key. AccuWeather requires a key and adds RealFeel, plain-language conditions text, pressure tendency, and precipitation type.',
      enum: [...WEATHER_PROVIDER_IDS],
      enumNames: WEATHER_PROVIDER_IDS.map((id) => WEATHER_PROVIDER_LABELS[id]),
      default: DEFAULT_WEATHER_PROVIDER,
    },
    accuWeatherApiKey: {
      type: 'string',
      title: 'AccuWeather API Key',
      description:
        'Required only when the weather source is AccuWeather. Get your API key at https://developer.accuweather.com/',
      default: '',
    },
    openMeteoBaseUrl: {
      type: 'string',
      title: 'Open-Meteo base URL (optional)',
      description:
        'Leave blank to use the free public Open-Meteo service (non-commercial use only). Commercial users can self-host the open-source server or use a paid plan and enter its URL here.',
      default: '',
    },
    marineData: {
      type: 'boolean',
      title: 'Emit sea state (waves, swell, sea temperature, current)',
      description:
        'Adds a keyless Open-Meteo Marine layer on environment.water.* and environment.current. Coastal and offshore only; inland points have no data.',
      default: false,
    },
    updateFrequency: {
      type: 'integer',
      title: 'Weather Update Frequency (minutes)',
      description:
        'How often to fetch new weather data. Under AccuWeather each fetch costs one API call (location lookups are cached); Open-Meteo is keyless and unmetered.',
      default: CONFIG_DEFAULTS.UPDATE_FREQUENCY,
      minimum: CONFIG_DEFAULTS.UPDATE_FREQUENCY_MIN,
      maximum: CONFIG_DEFAULTS.UPDATE_FREQUENCY_MAX,
    },
    emissionInterval: {
      type: 'integer',
      title: 'Broadcast Interval (seconds)',
      description:
        'How often the cached weather payload is re-emitted to the Signal K bus so NMEA2000 listeners keep seeing fresh deltas.',
      default: CONFIG_DEFAULTS.EMISSION_INTERVAL,
      minimum: CONFIG_DEFAULTS.EMISSION_INTERVAL_MIN,
      maximum: CONFIG_DEFAULTS.EMISSION_INTERVAL_MAX,
    },
    dailyApiQuota: {
      type: 'integer',
      title: 'Daily API Call Quota',
      description:
        'Cap on AccuWeather calls in any rolling 24-hour window (applies only when AccuWeather is the weather source). Defaults to 50/day; set to 0 to disable the cap and quota warnings.',
      default: CONFIG_DEFAULTS.DAILY_API_QUOTA,
      minimum: CONFIG_DEFAULTS.DAILY_API_QUOTA_MIN,
      maximum: CONFIG_DEFAULTS.DAILY_API_QUOTA_MAX,
    },
    notifications: {
      type: 'object',
      title: 'Severe-weather notifications',
      description:
        'Emit Signal K notifications on notifications.environment.* when wind, visibility, heat-stress, cold, or severe-condition thresholds are crossed. Bridges to NMEA 2000 Alert PGNs (126983/126985) only when signalk-to-nmea2000 is installed on the server.',
      properties: {
        enabled: {
          type: 'boolean',
          title: NOTIFICATION_MASTER_LABEL,
          default: DEFAULT_NOTIFICATIONS.enabled,
        },
        ...notificationBandProperties(),
      },
    },
  },
});

/**
 * UI schema for better form presentation
 */
export const pluginUiSchema = () => ({
  'ui:order': [
    'weatherProvider',
    'accuWeatherApiKey',
    'openMeteoBaseUrl',
    'marineData',
    'updateFrequency',
    'emissionInterval',
    'dailyApiQuota',
    'notifications',
  ],
  accuWeatherApiKey: {
    'ui:widget': 'password',
    'ui:autocomplete': 'off',
    'ui:placeholder': 'paste your AccuWeather developer API key',
  },
  updateFrequency: {
    'ui:widget': 'updown',
    'ui:help':
      'Free-tier keys get 50 calls/day, so 30 minutes (48/day) is the safe default. Raise the cadence on paid tiers.',
  },
  emissionInterval: {
    'ui:widget': 'updown',
    'ui:help':
      'Independent of the fetch cadence: keeps NMEA2000 listeners alive between AccuWeather updates.',
  },
  dailyApiQuota: {
    'ui:widget': 'updown',
    'ui:help':
      'When usage crosses 90% the banner shows a warning; at 100% fetches pause until the rolling window drops. 0 disables tracking entirely.',
  },
  notifications: {
    'ui:help':
      'Notifications are off by default. Each category-specific toggle below only takes effect when the master enable is on. Bridging to NMEA 2000 Alert PGNs requires the separate signalk-to-nmea2000 plugin on the server.',
    'ui:order': ['enabled', ...NOTIFICATION_BAND_KEYS],
  },
});
