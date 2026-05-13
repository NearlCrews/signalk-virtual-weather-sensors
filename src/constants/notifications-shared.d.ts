/**
 * Type declarations for notifications-shared.js. Kept in sync with the .js
 * file manually since allowJs is false in tsconfig.
 */

export const NOTIFICATION_LABELS: Readonly<{
  wind: string;
  visibility: string;
  heat: string;
  cold: string;
  weather: string;
}>;

export const DEFAULT_NOTIFICATIONS: Readonly<{
  enabled: boolean;
  wind: boolean;
  visibility: boolean;
  heat: boolean;
  cold: boolean;
  weather: boolean;
}>;

export const CONFIG_DEFAULTS: Readonly<{
  UPDATE_FREQUENCY_MIN: number;
  UPDATE_FREQUENCY_MAX: number;
  UPDATE_FREQUENCY: number;
  EMISSION_INTERVAL_MIN: number;
  EMISSION_INTERVAL_MAX: number;
  EMISSION_INTERVAL: number;
  DAILY_API_QUOTA_MIN: number;
  DAILY_API_QUOTA_MAX: number;
  DAILY_API_QUOTA: number;
}>;

export const API_KEY_MIN_LENGTH: number;
