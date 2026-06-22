/**
 * Plugin lifecycle, logging, and notification types for signalk-virtual-weather-sensors.
 */

/**
 * Signal K notification state values per spec 1.8.2 (notifications.html).
 * `normal` is the resolved-state sentinel that clears an active notification;
 * `alert`, `warn`, `alarm`, `emergency` form the ascending hazard ladder.
 */
export type NotificationState = 'normal' | 'alert' | 'warn' | 'alarm' | 'emergency';

/** Methods a notification consumer is asked to invoke (visual cue, audible alert). */
export type NotificationMethod = 'visual' | 'sound';

/**
 * Value object placed at a `notifications.environment.*` path. Matches the
 * shape consumed by `signalk-to-nmea2000`'s notification to Alert PGN bridge
 * (PGN 126983 + Alert Text 126985); fields not in the spec are intentionally
 * omitted to keep the payload simple.
 */
export interface NotificationValue {
  readonly state: NotificationState;
  readonly method: ReadonlyArray<NotificationMethod>;
  readonly message: string;
  /** ISO 8601 timestamp of the state transition. */
  readonly timestamp: string;
}

/**
 * Shape returned by the admin-UI panel's `/api/status` REST endpoint. Shared
 * between the producer (src/index.ts:registerPanelRoutes) and the consumer
 * (src/configpanel/PluginConfigurationPanel.jsx via JSDoc) so a typo on the
 * producer side fails compile-time rather than silently shipping.
 */
export interface PanelStatusResponse {
  readonly running: boolean;
  readonly banner: string;
  readonly updates: number;
  readonly quotaUsedLast24h: number;
  /** Whole-minute integer; null until the first successful fetch. */
  readonly lastUpdateMinutesAgo: number | null;
  readonly activeNotifications: number;
  /**
   * True once the Signal K v2 Weather API provider has been registered this
   * start cycle (so the server advertises `weather` in /signalk/v2/features and
   * forecast endpoints are live). False on older servers that lack
   * `registerWeatherProvider`, or when the plugin is stopped.
   */
  readonly weatherProviderRegistered: boolean;
}

/**
 * Plugin lifecycle states
 */
export type PluginState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

/**
 * Logging levels for structured logging
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger function signature used across all services
 */
export type Logger = (level: LogLevel, message: string, metadata?: Record<string, unknown>) => void;
