/**
 * Shared notification labels, configuration defaults, and validation constants
 * consumed by BOTH the TypeScript plugin runtime (src/index.ts schema,
 * src/constants/index.ts defaults, src/utils/validation.ts) AND the JSX
 * federated config panel (src/configpanel/PluginConfigurationPanel.jsx).
 *
 * Plain ESM JavaScript so the JSX webpack bundle (which only has
 * @babel/preset-react, no TypeScript loader) can import it directly.
 * A co-located notifications-shared.d.ts declares the types for TypeScript
 * consumers under the project's NodeNext module resolution with
 * `allowJs: false`.
 *
 * Property declaration order in NOTIFICATION_LABELS doubles as the rendering
 * order in the panel's toggle list (derived via Object.entries) and SHOULD
 * match the property order in the JSON schema's `notifications.properties`
 * so the rjsf fallback shows the same order as the federated panel.
 */

export const NOTIFICATION_LABELS = Object.freeze({
  wind: 'Wind alerts (gale / storm / hurricane)',
  visibility: 'Reduced-visibility alerts',
  heat: 'Heat-stress alerts',
  cold: 'Cold-exposure alerts',
  weather: 'Severe-condition alerts (thunderstorm / ice / freezing rain)',
});

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

/** Minimum length for any plausible AccuWeather API key. */
export const API_KEY_MIN_LENGTH = 20;
