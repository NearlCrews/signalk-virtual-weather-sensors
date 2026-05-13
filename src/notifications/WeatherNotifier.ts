/**
 * Severe-weather notification state machine.
 *
 * Translates `WeatherData` snapshots into Signal K notifications under
 * `notifications.environment.*` (spec 1.8.2). Each hazard band owns its own
 * path so consumers that cache by path+id (Garmin plotters, signalk-to-nmea2000)
 * see distinct alerts rather than a single rising/falling state ladder.
 *
 * The notifier emits a delta only when a band transitions in or out: a Map of
 * last-seen states ensures the 5 s emission tick stays idempotent and the bus
 * does not see repeated identical notifications.
 *
 * Bridging to NMEA 2000 Alert PGNs (126983/126985) requires the server-side
 * `signalk-to-nmea2000` plugin: this notifier only produces SK-native deltas.
 */

import type { PathValue } from '@signalk/server-api';
import { NOTIFICATION_PATHS, NOTIFICATION_THRESHOLDS, UNITS } from '../constants/index.js';
import type {
  Logger,
  NotificationMethod,
  NotificationState,
  NotificationsConfig,
  NotificationValue,
  WeatherData,
} from '../types/index.js';
import { kelvinToCelsius } from '../utils/conversions.js';
import { pv } from '../utils/skDelta.js';

/** Default alert presentation: visual on every band; audible from `alarm` upward. */
const VISUAL_ONLY: ReadonlyArray<NotificationMethod> = ['visual'];
const VISUAL_AND_SOUND: ReadonlyArray<NotificationMethod> = ['visual', 'sound'];

/** Returns the appropriate `method` list for a given state. */
function methodsFor(state: NotificationState): ReadonlyArray<NotificationMethod> {
  return state === 'alarm' || state === 'emergency' ? VISUAL_AND_SOUND : VISUAL_ONLY;
}

/**
 * Severity mapping for AccuWeather `WeatherIcon` codes (1..44). Only codes
 * that warrant a marine-relevant alert appear here; codes 1..10 (sunny/cloudy
 * variants) and the fog/wind/hot/cold codes 30..32 are absent because their
 * hazards are surfaced through the dedicated visibility, temperature, and
 * wind-band notifications. Codes 33..40 (clear/cloudy night variants) are
 * deliberately absent for the same reason.
 *
 * AccuWeather icon catalogue: https://developer.accuweather.com/weather-icons
 */
interface IconSeverity {
  readonly state: NotificationState;
  readonly label: string;
}

const WEATHER_ICON_SEVERITY: ReadonlyMap<number, IconSeverity> = new Map([
  [15, { state: 'warn', label: 'Thunderstorms' }],
  [16, { state: 'warn', label: 'Thunderstorms' }],
  [17, { state: 'warn', label: 'Thunderstorms' }],
  [22, { state: 'warn', label: 'Snow' }],
  [23, { state: 'warn', label: 'Snow' }],
  [24, { state: 'alarm', label: 'Ice' }],
  [25, { state: 'warn', label: 'Sleet' }],
  [26, { state: 'warn', label: 'Freezing rain' }],
  [29, { state: 'warn', label: 'Rain and snow' }],
  [41, { state: 'warn', label: 'Thunderstorms' }],
  [42, { state: 'warn', label: 'Thunderstorms' }],
  [43, { state: 'warn', label: 'Snow' }],
  [44, { state: 'warn', label: 'Snow' }],
]);

/**
 * One row of the ascending-band table consumed by
 * {@link WeatherNotifier.evaluateAscendingBands}. The reading is compared
 * `>= threshold`; when true the band activates with `state`, otherwise the
 * band clears with `normal`. `prefix` is the human-readable lead-in for the
 * notification message (e.g. `Gale-force wind`).
 */
interface AscendingBand {
  readonly path: string;
  readonly threshold: number;
  readonly state: NotificationState;
  readonly prefix: string;
}

const WIND_BANDS: ReadonlyArray<AscendingBand> = [
  {
    path: NOTIFICATION_PATHS.WIND_GALE,
    threshold: NOTIFICATION_THRESHOLDS.WIND.GALE_BEAUFORT,
    state: 'warn',
    prefix: 'Gale-force wind',
  },
  {
    path: NOTIFICATION_PATHS.WIND_STORM,
    threshold: NOTIFICATION_THRESHOLDS.WIND.STORM_BEAUFORT,
    state: 'alarm',
    prefix: 'Storm-force wind',
  },
  {
    path: NOTIFICATION_PATHS.WIND_HURRICANE,
    threshold: NOTIFICATION_THRESHOLDS.WIND.HURRICANE_BEAUFORT,
    state: 'emergency',
    prefix: 'Hurricane-force wind',
  },
];

const HEAT_BANDS: ReadonlyArray<AscendingBand> = [
  {
    path: NOTIFICATION_PATHS.HEAT_CAUTION,
    threshold: NOTIFICATION_THRESHOLDS.HEAT_STRESS.CAUTION_INDEX,
    state: 'warn',
    prefix: 'Heat stress caution',
  },
  {
    path: NOTIFICATION_PATHS.HEAT_HIGH,
    threshold: NOTIFICATION_THRESHOLDS.HEAT_STRESS.HIGH_INDEX,
    state: 'alarm',
    prefix: 'High heat stress',
  },
  {
    path: NOTIFICATION_PATHS.HEAT_EXTREME,
    threshold: NOTIFICATION_THRESHOLDS.HEAT_STRESS.EXTREME_INDEX,
    state: 'emergency',
    prefix: 'Extreme heat stress',
  },
];

/**
 * Translates `WeatherData` snapshots into Signal K notification deltas under
 * `notifications.environment.*`. Pure transition emitter: a band is reported
 * only when its active flag flips, with `state: 'normal'` written on exit so
 * plotter UIs clear the alert.
 */
export class WeatherNotifier {
  private readonly config: NotificationsConfig;
  private readonly logger: Logger;
  /** Last state emitted per notification path; default `normal` until set. */
  private readonly lastState = new Map<string, NotificationState>();

  constructor(config: NotificationsConfig, logger: Logger = () => {}) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Severe-condition messages include AccuWeather's `WeatherText` phrase
   * (e.g. `Thunderstorms: Severe thunderstorms approaching`) so the operator
   * sees the underlying condition rather than just the icon-derived label.
   * Empty array is the common case: no enabled band transitioned this tick.
   *
   * Timestamps and per-band message strings are computed lazily inside
   * `maybeTransition`: when no band transitions (the steady-state norm) the
   * notifier allocates nothing.
   */
  public evaluate(data: WeatherData): PathValue[] {
    if (!this.config.enabled) return [];

    const transitions: PathValue[] = [];

    if (this.config.wind) this.evaluateWind(data, transitions);
    if (this.config.visibility) this.evaluateVisibility(data, transitions);
    if (this.config.heat) this.evaluateHeat(data, transitions);
    if (this.config.cold) this.evaluateCold(data, transitions);
    if (this.config.weather) this.evaluateSevereCondition(data, transitions);

    if (transitions.length > 0) {
      this.logger('info', 'Weather notifications transitioned', {
        count: transitions.length,
        paths: transitions.map((t) => t.path),
      });
    }

    return transitions;
  }

  /**
   * Reset all band state so a fresh start() begins with every band inactive.
   * Avoids ghost `normal` transitions on the first evaluate() after stop().
   */
  public reset(): void {
    this.lastState.clear();
  }

  /**
   * Count notification paths currently in a non-`normal` state. Consumed by
   * the admin-UI panel's `/api/status` endpoint so operators see how many
   * alerts are active without subscribing to the bus.
   */
  public getActiveCount(): number {
    let count = 0;
    for (const state of this.lastState.values()) {
      if (state !== 'normal') count++;
    }
    return count;
  }

  /**
   * Wind: gale (warn) / storm (alarm) / hurricane (emergency) tracked
   * independently. Each band is active when Beaufort >= its threshold, so
   * during a hurricane all three are concurrently active.
   */
  private evaluateWind(data: WeatherData, out: PathValue[]): void {
    const bft = data.beaufortScale;
    if (bft === undefined) return;
    this.evaluateAscendingBands(WIND_BANDS, bft, () => `Beaufort ${bft}`, out);
  }

  /**
   * Visibility: low (1 nm, warn) and very-low (0.5 nm, alarm) tracked
   * independently. SOLAS uses 1 nm as the restricted-visibility threshold.
   */
  private evaluateVisibility(data: WeatherData, out: PathValue[]): void {
    const vis = data.visibility;
    if (vis === undefined) return;

    const { LOW_M, VERY_LOW_M } = NOTIFICATION_THRESHOLDS.VISIBILITY;
    const visKm = () => (vis / UNITS.LENGTH.KM_TO_M).toFixed(1);

    this.maybeTransition(
      NOTIFICATION_PATHS.VISIBILITY_LOW,
      vis < LOW_M ? 'warn' : 'normal',
      () => `Reduced visibility: ${visKm()} km`,
      out
    );
    this.maybeTransition(
      NOTIFICATION_PATHS.VISIBILITY_VERY_LOW,
      vis < VERY_LOW_M ? 'alarm' : 'normal',
      () => `Very low visibility: ${visKm()} km`,
      out
    );
  }

  /**
   * Heat stress: caution (HSI 2, warn), high (HSI 3, alarm), extreme
   * (HSI 4, emergency). Driven by AccuWeather wet-bulb globe temperature.
   */
  private evaluateHeat(data: WeatherData, out: PathValue[]): void {
    const hsi = data.heatStressIndex;
    if (hsi === undefined) return;
    this.evaluateAscendingBands(HEAT_BANDS, hsi, () => `index ${hsi}`, out);
  }

  /**
   * Drive a set of ascending bands against one numeric reading. Each band
   * activates with its declared state when `value >= band.threshold`,
   * clears with `normal` otherwise. The scalar-suffix producer is invoked
   * lazily inside `maybeTransition` only when a transition actually fires,
   * so steady-state evaluations skip string formatting entirely.
   */
  private evaluateAscendingBands(
    bands: ReadonlyArray<AscendingBand>,
    value: number,
    scalarSuffix: () => string,
    out: PathValue[]
  ): void {
    for (const band of bands) {
      this.maybeTransition(
        band.path,
        value >= band.threshold ? band.state : 'normal',
        () => `${band.prefix}: ${scalarSuffix()}`,
        out
      );
    }
  }

  /**
   * Cold: caution (wind chill < 0 C, warn) and extreme (< -20 C, alarm).
   * Wind chill stored in Kelvin; thresholds compare directly.
   */
  private evaluateCold(data: WeatherData, out: PathValue[]): void {
    const windChillK = data.windChill;
    if (!Number.isFinite(windChillK)) return;

    const { CAUTION_K, EXTREME_K } = NOTIFICATION_THRESHOLDS.COLD;
    const tempC = () => kelvinToCelsius(windChillK).toFixed(0);

    this.maybeTransition(
      NOTIFICATION_PATHS.COLD_CAUTION,
      windChillK < CAUTION_K ? 'warn' : 'normal',
      () => `Cold exposure caution: wind chill ${tempC()} C`,
      out
    );
    this.maybeTransition(
      NOTIFICATION_PATHS.COLD_EXTREME,
      windChillK < EXTREME_K ? 'alarm' : 'normal',
      () => `Extreme cold exposure: wind chill ${tempC()} C`,
      out
    );
  }

  /**
   * Severe weather condition: single path whose state varies by icon code.
   * Returns to `normal` whenever the current icon falls outside the severity
   * table. Description comes from the response's `WeatherText` so consumers
   * see the operator-friendly phrase rather than a numeric code; on exit
   * the message is empty so consumers see `state: 'normal'` without a fake
   * "No severe weather" phrase being parsed as a real condition.
   */
  private evaluateSevereCondition(data: WeatherData, out: PathValue[]): void {
    const icon = data.weatherIcon;
    const severity = icon !== undefined ? WEATHER_ICON_SEVERITY.get(icon) : undefined;
    const description = data.description?.trim() ?? '';

    if (severity === undefined) {
      this.maybeTransition(NOTIFICATION_PATHS.WEATHER_SEVERE, 'normal', () => '', out);
      return;
    }

    this.maybeTransition(
      NOTIFICATION_PATHS.WEATHER_SEVERE,
      severity.state,
      () => (description ? `${severity.label}: ${description}` : severity.label),
      out
    );
  }

  /**
   * Push a notification PathValue onto `out` if and only if the desired state
   * differs from the last state emitted for this path. The very first
   * evaluation against `normal` is a no-op (we have not emitted anything yet,
   * so there is nothing to clear): only true entries / exits surface. The
   * message producer and the transition timestamp are computed lazily so the
   * steady-state case allocates no strings.
   */
  private maybeTransition(
    path: string,
    desired: NotificationState,
    message: () => string,
    out: PathValue[]
  ): void {
    const prior = this.lastState.get(path);
    if (prior === undefined && desired === 'normal') {
      // Never emit a leading `normal`: the band has never been active, so the
      // bus has nothing to clear. Record the state so a later transition to
      // an active band correctly emits the entry delta.
      this.lastState.set(path, desired);
      return;
    }
    if (prior === desired) return;

    this.lastState.set(path, desired);
    const value: NotificationValue = {
      state: desired,
      method: methodsFor(desired),
      message: message(),
      timestamp: new Date().toISOString(),
    };
    out.push(pv(path, value));
  }
}
