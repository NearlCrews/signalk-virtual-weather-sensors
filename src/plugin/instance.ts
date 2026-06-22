/**
 * Shared plugin instance state and the banner-dedupe helper.
 * Kept in a neutral module so the lifecycle entry (index.ts) and future
 * extracted feature modules can all import one-way without creating a cycle.
 */

import type { Delta, ServerAPI, SourceRef } from '@signalk/server-api';
import type { MarinePathMapper } from '../mappers/MarinePathMapper.js';
import type { NMEA2000PathMapper } from '../mappers/NMEA2000PathMapper.js';
import type { WeatherNotifier } from '../notifications/WeatherNotifier.js';
import type { WeatherService } from '../services/WeatherService.js';
import type { Logger, MarineData, PluginState, WeatherData } from '../types/index.js';

/** Distinguishes a banner string pushed via setPluginStatus from one pushed via setPluginError. */
export type BannerKind = 'status' | 'error';

/**
 * Plugin instance state
 */
export interface PluginInstance {
  weatherService: WeatherService | null;
  pathMapper: NMEA2000PathMapper | null;
  /** Null unless the optional marine layer is enabled. */
  marinePathMapper: MarinePathMapper | null;
  /** Cached marine values delta, rebuilt only when the marine snapshot changes. */
  cachedMarineDelta: Delta | null;
  cachedMarineDataRef: MarineData | null;
  /** True once the one-shot marine meta delta has been shipped. */
  marineMetaEmitted: boolean;
  /** Null when notifications are disabled or the plugin is stopped. */
  notifier: WeatherNotifier | null;
  emissionTimer: NodeJS.Timeout | null;
  state: PluginState;
  startTime: Date | null;
  logger: Logger;
  /** Cached delta to avoid rebuilding on every emission tick */
  cachedDelta: Delta | null;
  cachedWeatherDataRef: WeatherData | null;
  /** True once the one-shot meta delta has been shipped to the server. */
  metaEmitted: boolean;
  /** True once app.registerWeatherProvider has been called this start cycle. */
  weatherProviderRegistered: boolean;
  /** `$source` of the active provider, stamped on notification and re-broadcast deltas. */
  sourceRef: SourceRef;
  /**
   * Last (kind, message) pushed to the admin UI. Used to dedupe identical
   * setPluginStatus / setPluginError calls so a flapping API doesn't oscillate
   * the banner every emission tick. Reset on stop().
   */
  lastBanner: { kind: BannerKind; message: string } | null;
}

/**
 * Single entry point for every admin-UI banner push. Dedupes consecutive
 * identical (kind, message) pairs so a flapping API or a steady-state quota
 * pause doesn't oscillate the banner every 5 seconds. Identity is tracked
 * separately for `setPluginStatus` and `setPluginError` because the server
 * treats them as distinct UI bands.
 * @private
 */
export function setBanner(
  instance: PluginInstance,
  app: ServerAPI,
  kind: BannerKind,
  message: string
): void {
  const last = instance.lastBanner;
  if (last !== null && last.kind === kind && last.message === message) {
    return;
  }
  if (kind === 'status') {
    app.setPluginStatus(message);
  } else {
    app.setPluginError(message);
  }
  instance.lastBanner = { kind, message };
}
