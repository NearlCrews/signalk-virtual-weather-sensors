/**
 * Shared notification labels and defaults consumed by BOTH the TypeScript
 * plugin runtime (src/index.ts schema, src/constants/index.ts defaults) AND
 * the JSX federated config panel (src/configpanel/PluginConfigurationPanel.jsx).
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
