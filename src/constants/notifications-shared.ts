/**
 * Shared labels, plugin identity, configuration defaults, and validation
 * constants consumed by BOTH the TypeScript plugin runtime (src/index.ts
 * schema, src/constants/index.ts defaults, src/utils/validation.ts) AND the
 * federated config panel (src/configpanel/). Single source of truth so the
 * panel and the rjsf fallback form cannot drift on label wording, numeric
 * defaults, or key validation bounds.
 *
 * Lives in plain TypeScript: the panel's webpack build resolves it through
 * @babel/preset-typescript plus the `extensionAlias` mapping of `.js`
 * specifiers onto `.ts` sources, and the Node runtime build (esbuild, tsc)
 * compiles it like any other module.
 *
 * Property declaration order in NOTIFICATION_LABELS doubles as the rendering
 * order in the panel's toggle list and SHOULD match the property order in the
 * JSON schema's `notifications.properties` so the rjsf fallback shows the
 * same order as the federated panel.
 */

/** npm package name, plugin id, and the panel API route prefix segment. */
export const PLUGIN_NAME = 'signalk-virtual-weather-sensors';

/** Human-readable plugin name shown in the admin UI and the panel header. */
export const PLUGIN_DISPLAY_NAME = 'Virtual Weather Sensors';

export const NOTIFICATION_LABELS = Object.freeze({
  wind: 'Wind alerts (gale / storm / hurricane)',
  visibility: 'Reduced-visibility alerts',
  heat: 'Heat-stress alerts',
  cold: 'Cold-exposure alerts',
  weather: 'Severe-condition alerts (thunderstorm / ice / freezing rain)',
});

/** The five per-band toggle keys, in NOTIFICATION_LABELS declaration order. */
export type NotificationBandKey = keyof typeof NOTIFICATION_LABELS;

/**
 * Band keys as a list, for call sites that count or iterate the bands (the
 * panel's "N of M bands" summary, the toggle list) without hardcoding five.
 */
export const NOTIFICATION_BAND_KEYS = Object.freeze(
  Object.keys(NOTIFICATION_LABELS) as NotificationBandKey[]
);

/** Master-toggle wording, shared by the rjsf schema title and the panel label. */
export const NOTIFICATION_MASTER_LABEL = 'Enable severe-weather notifications';

export const DEFAULT_NOTIFICATIONS = Object.freeze({
  enabled: false,
  wind: true,
  visibility: true,
  heat: true,
  cold: true,
  weather: true,
});

/**
 * Numeric config defaults and bounds shared by the rjsf schema, the runtime
 * sanitizer, and the federated panel. Single source of truth: the panel and
 * the TS runtime cannot drift on the default fetch cadence, broadcast cadence,
 * or quota cap.
 */
export const CONFIG_DEFAULTS = Object.freeze({
  UPDATE_FREQUENCY_MIN: 1,
  UPDATE_FREQUENCY_MAX: 60,
  UPDATE_FREQUENCY: 30,
  EMISSION_INTERVAL_MIN: 1,
  EMISSION_INTERVAL_MAX: 60,
  EMISSION_INTERVAL: 5,
  DAILY_API_QUOTA_MIN: 0,
  DAILY_API_QUOTA_MAX: 1000,
  DAILY_API_QUOTA: 50,
});

/**
 * 24h quota usage ratio that flips the status banner into its warning prefix.
 * Shared so the runtime banner (`API_QUOTA.WARN_RATIO`, the warning prefix
 * text) and the panel's help prose derive the same percentage.
 */
export const QUOTA_WARN_RATIO = 0.9;

/**
 * Selectable weather source. `open-meteo` is keyless, global, and the default
 * for new installs; `accuweather` requires an API key and supplies exclusive
 * fields (RealFeel, plain-language text, pressure tendency, precipitation type);
 * `met-no` is keyless, global, and provides Nordic and European alerts.
 */
export type WeatherProviderId = 'open-meteo' | 'accuweather' | 'met-no';

/** Valid provider ids, in panel display order (keyless default first). */
export const WEATHER_PROVIDER_IDS: ReadonlyArray<WeatherProviderId> = Object.freeze([
  'open-meteo',
  'accuweather',
  'met-no',
]);

/** Default provider for a fresh install: keyless so the plugin works out of the box. */
export const DEFAULT_WEATHER_PROVIDER: WeatherProviderId = 'open-meteo';

/** Panel and schema labels for the provider picker. */
export const WEATHER_PROVIDER_LABELS: Readonly<Record<WeatherProviderId, string>> = Object.freeze({
  'open-meteo': 'Open-Meteo (free, no API key, global)',
  accuweather: 'AccuWeather (requires an API key)',
  'met-no': 'Met.no (free, no API key, global; Nordic and European alerts)',
});

/**
 * Resolve the effective provider from saved config. An explicit, valid
 * `weatherProvider` always wins. Otherwise (legacy config written before this
 * option existed) an existing AccuWeather key keeps AccuWeather active so an
 * upgrade does not silently switch a working install or change its `$source`;
 * a fresh install with no key defaults to Open-Meteo.
 */
export function resolveWeatherProvider(
  explicit: unknown,
  hasAccuWeatherKey: boolean
): WeatherProviderId {
  if (
    typeof explicit === 'string' &&
    (WEATHER_PROVIDER_IDS as ReadonlyArray<string>).includes(explicit)
  ) {
    return explicit as WeatherProviderId;
  }
  return hasAccuWeatherKey ? 'accuweather' : 'open-meteo';
}

/**
 * Whether a provider needs an API key. Panel-safe single source consumed by the
 * runtime validator, the rjsf schema, and the federated panel, so the keyed and
 * keyless distinction cannot drift. A new keyed provider adds one entry here.
 */
export const WEATHER_PROVIDER_REQUIRES_KEY: Readonly<Record<WeatherProviderId, boolean>> =
  Object.freeze({
    'open-meteo': false,
    accuweather: true,
    'met-no': false,
  });

/** True when the provider needs an API key. */
export function providerRequiresApiKey(id: WeatherProviderId): boolean {
  return WEATHER_PROVIDER_REQUIRES_KEY[id];
}

/** How configured providers are combined: one source, or a synthetic blend. */
export type WeatherMode = 'single' | 'merged';

/** Valid modes, single first. */
export const WEATHER_MODE_IDS: ReadonlyArray<WeatherMode> = Object.freeze(['single', 'merged']);

/** Default mode for a fresh or legacy install: a single source, today's behavior. */
export const DEFAULT_WEATHER_MODE: WeatherMode = 'single';

/** Panel and schema labels for the mode picker. */
export const WEATHER_MODE_LABELS: Readonly<Record<WeatherMode, string>> = Object.freeze({
  single: 'Single provider',
  merged: 'Merge available providers (synthetic blend)',
});

/** Resolve the effective mode; anything but a known value falls back to single. */
export function resolveWeatherMode(explicit: unknown): WeatherMode {
  return typeof explicit === 'string' &&
    (WEATHER_MODE_IDS as ReadonlyArray<string>).includes(explicit)
    ? (explicit as WeatherMode)
    : 'single';
}

/** Minimum length for any plausible AccuWeather API key. */
export const API_KEY_MIN_LENGTH = 20;

/**
 * Shared minimum-length gate for a candidate API key. Returns the
 * operator-facing blocker message, or null when the key is long enough.
 * Used by the panel's Save and Test gates and the /api/test-key endpoint so
 * the wording cannot drift between them.
 */
export function validateKeyLength(key: string): string | null {
  return key.length < API_KEY_MIN_LENGTH
    ? `API key must be at least ${API_KEY_MIN_LENGTH} characters.`
    : null;
}
