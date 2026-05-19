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
import {
  kelvinToCelsius,
  radiansToDegrees,
  ratioToPercentage,
  truncateToCodePoints,
} from '../utils/conversions.js';
import { pv } from '../utils/skDelta.js';

/** Default alert presentation: visual on every band; audible from `alarm` upward. */
const VISUAL_ONLY: ReadonlyArray<NotificationMethod> = ['visual'];
const VISUAL_AND_SOUND: ReadonlyArray<NotificationMethod> = ['visual', 'sound'];
/** A resolved (`normal`) notification clears with no method: there is nothing to present. */
const NO_METHODS: ReadonlyArray<NotificationMethod> = [];

/**
 * Returns the appropriate `method` list for a given state. A `normal` (cleared)
 * notification carries an empty list so consumers do not keep a visual or
 * audible cue lit for a resolved hazard; `signalk-to-nmea2000` reads `[]` as
 * the cleared / acknowledged shape.
 */
function methodsFor(state: NotificationState): ReadonlyArray<NotificationMethod> {
  if (state === 'normal') return NO_METHODS;
  return state === 'alarm' || state === 'emergency' ? VISUAL_AND_SOUND : VISUAL_ONLY;
}

/**
 * Soft cap on emitted notification messages.
 *
 * The NMEA 2000 Alert PGNs (126983/126985 via `signalk-to-nmea2000`) carry an
 * Alert Text Description field that real-world chartplotters render at
 * 64..128 characters: Garmin GMI displays around 32, Raymarine ~80, B&G Zeus
 * around 80. 80 is a common-denominator that displays cleanly across the
 * fleet; downstream bridges may still truncate further to fit their own
 * field widths.
 *
 * Pure Signal K consumers (Freeboard, Instrument Panel webapps) have no hard
 * limit but render best when messages stay on a single visual line.
 *
 * Exported so tests can assert the same ceiling without hardcoding 80.
 */
export const MAX_MESSAGE_LENGTH = 80;

function capForChartplotter(message: string): string {
  // Count code points, not UTF-16 units, so the cap matches truncateToCodePoints.
  if (Array.from(message).length <= MAX_MESSAGE_LENGTH) return message;
  return `${truncateToCodePoints(message, MAX_MESSAGE_LENGTH - 1)}…`;
}

/**
 * Narrow `number | undefined` to `number` for optional WeatherData fields.
 * Required fields (`temperature`, `windSpeed`, etc.) are already `number` per
 * the type; this guard is only for the spread fields like `windGustSpeed`,
 * `cloudCeiling`, `precipitationCurrent` that AccuWeather may omit.
 */
function isFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

/** 16-point compass rose, indexed by floor((deg + 11.25) / 22.5). */
const CARDINAL_16 = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const;

function radiansToCardinal(radians: number): string {
  const deg = ((radiansToDegrees(radians) % 360) + 360) % 360;
  const idx = Math.floor((deg + 11.25) / 22.5) % 16;
  return CARDINAL_16[idx] ?? 'N';
}

function paToHpa(pressurePa: number): number {
  return Math.round(pressurePa / UNITS.PRESSURE.MILLIBAR_TO_PASCAL);
}

function kToCRounded(kelvin: number): number {
  return Math.round(kelvinToCelsius(kelvin));
}

function msRounded(ms: number): number {
  return Math.round(ms * 10) / 10;
}

function metersToKm(meters: number): string {
  return (meters / UNITS.LENGTH.KM_TO_M).toFixed(1);
}

/**
 * Each `format*Suffix` builder produces the right-hand side of one
 * notification message, packed with adjacent context the operator can act on
 * (reef vs run for shelter, fog vs heavy rain, etc.) without subscribing to
 * extra paths.
 *
 * Required `WeatherData` fields (temperature, pressure, windSpeed, etc.) are
 * still guarded with `Number.isFinite` because the sanitizer can in principle
 * clamp them but cannot guarantee finite outputs across all upstream-corrupted
 * inputs. Optional fields use `isFiniteNumber` to narrow `number | undefined`
 * in one step.
 */
function formatWindSuffix(data: WeatherData): string {
  const bft = data.beaufortScale;
  if (bft === undefined) return '';
  const parts: string[] = [`Bf${bft}`];
  if (Number.isFinite(data.windDirection)) {
    parts.push(`from ${radiansToCardinal(data.windDirection)}`);
  }
  const windSpeed = Number.isFinite(data.windSpeed) ? data.windSpeed : undefined;
  if (windSpeed !== undefined) {
    parts.push(`${msRounded(windSpeed)} m/s`);
  }
  // Surface the gust even when sustained wind is missing.
  if (
    isFiniteNumber(data.windGustSpeed) &&
    (windSpeed === undefined || data.windGustSpeed > windSpeed)
  ) {
    parts.push(`gusts ${msRounded(data.windGustSpeed)} m/s`);
  }
  if (Number.isFinite(data.pressure)) {
    parts.push(`${paToHpa(data.pressure)} hPa`);
  }
  return parts.join(', ');
}

function formatVisibilitySuffix(data: WeatherData): string {
  const vis = data.visibility;
  if (vis === undefined) return '';
  const parts: string[] = [`${metersToKm(vis)} km`];
  if (isFiniteNumber(data.cloudCeiling)) {
    parts.push(`ceiling ${Math.round(data.cloudCeiling)} m`);
  }
  if (isFiniteNumber(data.precipitationCurrent) && data.precipitationCurrent > 0) {
    parts.push(`rain ${data.precipitationCurrent.toFixed(1)} mm/h`);
  }
  return parts.join(', ');
}

function formatHeatSuffix(data: WeatherData): string {
  const hsi = data.heatStressIndex;
  if (hsi === undefined) return '';
  const parts: string[] = [`HSI ${hsi}`];
  if (isFiniteNumber(data.wetBulbGlobeTemperature)) {
    parts.push(`WBGT ${kToCRounded(data.wetBulbGlobeTemperature)} C`);
  }
  if (Number.isFinite(data.humidity)) {
    parts.push(`RH ${Math.round(ratioToPercentage(data.humidity))}%`);
  }
  if (isFiniteNumber(data.realFeelShade)) {
    parts.push(`RealFeel ${kToCRounded(data.realFeelShade)} C`);
  }
  return parts.join(', ');
}

/**
 * Wind chill alone undersells the exposure risk on a windy day: a calm -10 C
 * is far less dangerous than a windy -2 C. Air temp and sustained wind speed
 * give the operator the missing context.
 */
function formatColdSuffix(data: WeatherData): string {
  const parts: string[] = [`wind chill ${kToCRounded(data.windChill)} C`];
  if (Number.isFinite(data.temperature)) {
    parts.push(`air ${kToCRounded(data.temperature)} C`);
  }
  if (Number.isFinite(data.windSpeed)) {
    parts.push(`wind ${msRounded(data.windSpeed)} m/s`);
  }
  return parts.join(', ');
}

/**
 * AccuWeather's WeatherText drives the lead phrase; pressure is appended
 * because a falling barometer alongside a thunderstorm icon is a useful
 * operational signal beyond what the icon alone conveys.
 */
function formatSevereSuffix(data: WeatherData, label: string): string {
  const description = data.description?.trim() ?? '';
  const lead = description ? `${label}: ${description}` : label;
  if (Number.isFinite(data.pressure)) {
    return `${lead}, ${paToHpa(data.pressure)} hPa`;
  }
  return lead;
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
 * One row of a hazard-band table. The band activates with `state` when the
 * reading crosses `threshold` (compared `>= threshold` for ascending bands
 * like wind and heat, `< threshold` for descending bands like visibility and
 * cold); otherwise it clears with `normal`. `prefix` is the human-readable
 * lead-in for the notification message (e.g. `Gale-force wind`).
 */
interface Band {
  readonly path: string;
  readonly threshold: number;
  readonly state: NotificationState;
  readonly prefix: string;
}

const WIND_BANDS: ReadonlyArray<Band> = [
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

const HEAT_BANDS: ReadonlyArray<Band> = [
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

const VISIBILITY_BANDS: ReadonlyArray<Band> = [
  {
    path: NOTIFICATION_PATHS.VISIBILITY_LOW,
    threshold: NOTIFICATION_THRESHOLDS.VISIBILITY.LOW_M,
    state: 'warn',
    prefix: 'Reduced visibility',
  },
  {
    path: NOTIFICATION_PATHS.VISIBILITY_VERY_LOW,
    threshold: NOTIFICATION_THRESHOLDS.VISIBILITY.VERY_LOW_M,
    state: 'alarm',
    prefix: 'Very low visibility',
  },
];

const COLD_BANDS: ReadonlyArray<Band> = [
  {
    path: NOTIFICATION_PATHS.COLD_CAUTION,
    threshold: NOTIFICATION_THRESHOLDS.COLD.CAUTION_K,
    state: 'warn',
    prefix: 'Cold exposure caution',
  },
  {
    path: NOTIFICATION_PATHS.COLD_EXTREME,
    threshold: NOTIFICATION_THRESHOLDS.COLD.EXTREME_K,
    state: 'alarm',
    prefix: 'Extreme cold exposure',
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
   * during a hurricane all three are concurrently active. The shared suffix
   * surfaces sustained wind, gust, cardinal direction, and pressure so the
   * operator sees what to actually do (reef, run, hold) from the banner alone.
   */
  private evaluateWind(data: WeatherData, out: PathValue[]): void {
    const bft = data.beaufortScale;
    if (bft === undefined) return;
    this.evaluateAscendingBands(WIND_BANDS, bft, () => formatWindSuffix(data), out);
  }

  /**
   * Visibility: low (1 nm, warn) and very-low (0.5 nm, alarm) tracked
   * independently. 1 nm is the plugin's chosen restricted-visibility
   * threshold; neither SOLAS nor the COLREGs define a numeric value.
   */
  private evaluateVisibility(data: WeatherData, out: PathValue[]): void {
    const vis = data.visibility;
    if (vis === undefined) return;
    this.evaluateDescendingBands(VISIBILITY_BANDS, vis, () => formatVisibilitySuffix(data), out);
  }

  /**
   * Heat stress: caution (HSI 2, warn), high (HSI 3, alarm), extreme
   * (HSI 4, emergency). Driven by AccuWeather wet-bulb globe temperature;
   * the suffix surfaces WBGT, RH, and RealFeel-in-shade so the operator
   * sees both the index and the underlying physiology drivers.
   */
  private evaluateHeat(data: WeatherData, out: PathValue[]): void {
    const hsi = data.heatStressIndex;
    if (hsi === undefined) return;
    this.evaluateAscendingBands(HEAT_BANDS, hsi, () => formatHeatSuffix(data), out);
  }

  /**
   * Drive a set of ascending bands against one numeric reading. Each band
   * activates with its declared state when `value >= band.threshold`,
   * clears with `normal` otherwise. The scalar-suffix producer is invoked
   * lazily inside `maybeTransition` only when a transition actually fires,
   * so steady-state evaluations skip string formatting entirely.
   */
  private evaluateAscendingBands(
    bands: ReadonlyArray<Band>,
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
   * Descending counterpart to {@link evaluateAscendingBands}: each band
   * activates when `value < band.threshold` (visibility and cold both fall
   * into hazard as the reading drops). The suffix producer is invoked lazily.
   */
  private evaluateDescendingBands(
    bands: ReadonlyArray<Band>,
    value: number,
    scalarSuffix: () => string,
    out: PathValue[]
  ): void {
    for (const band of bands) {
      this.maybeTransition(
        band.path,
        value < band.threshold ? band.state : 'normal',
        () => `${band.prefix}: ${scalarSuffix()}`,
        out
      );
    }
  }

  /**
   * Cold: caution (wind chill < 0 C, warn) and extreme (< -20 C, alarm).
   * Wind chill stored in Kelvin; thresholds compare directly. The suffix
   * adds air temp and wind speed because wind chill alone undersells the
   * exposure risk on a windy day.
   */
  private evaluateCold(data: WeatherData, out: PathValue[]): void {
    const windChillK = data.windChill;
    if (!Number.isFinite(windChillK)) return;
    this.evaluateDescendingBands(COLD_BANDS, windChillK, () => formatColdSuffix(data), out);
  }

  /**
   * Severe weather condition: single path whose state varies by icon code.
   * Returns to `normal` whenever the current icon falls outside the severity
   * table. Description comes from the response's `WeatherText` so consumers
   * see the operator-friendly phrase rather than a numeric code; on exit
   * the message is empty so consumers see `state: 'normal'` without a fake
   * "No severe weather" phrase being parsed as a real condition. Barometric
   * pressure is appended when finite: a thunderstorm icon paired with a
   * falling barometer is a useful operational signal.
   */
  private evaluateSevereCondition(data: WeatherData, out: PathValue[]): void {
    const icon = data.weatherIcon;
    const severity = icon !== undefined ? WEATHER_ICON_SEVERITY.get(icon) : undefined;

    if (severity === undefined) {
      this.maybeTransition(NOTIFICATION_PATHS.WEATHER_SEVERE, 'normal', () => '', out);
      return;
    }

    this.maybeTransition(
      NOTIFICATION_PATHS.WEATHER_SEVERE,
      severity.state,
      () => formatSevereSuffix(data, severity.label),
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
      message: capForChartplotter(message()),
      timestamp: new Date().toISOString(),
    };
    out.push(pv(path, value));
  }
}
