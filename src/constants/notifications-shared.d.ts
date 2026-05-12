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
