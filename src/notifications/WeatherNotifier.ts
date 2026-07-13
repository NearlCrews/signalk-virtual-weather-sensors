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
  asOptionalNumber,
  kelvinToCelsius,
  normalizeAngle0To2Pi,
  pascalsToMillibars,
  radiansToDegrees,
  ratioToPercentage,
} from '../utils/conversions.js';
import { pv } from '../utils/skDelta.js';

/**
 * Default alert presentation: visual on every band; audible from `alarm`
 * upward. The arrays are `Object.freeze`d so a downstream consumer that casts
 * away the readonly contract cannot mutate the shared instance and corrupt
 * every subsequent notification using the same `methodsFor` branch.
 */
const VISUAL_ONLY: ReadonlyArray<NotificationMethod> = Object.freeze(['visual']);
const VISUAL_AND_SOUND: ReadonlyArray<NotificationMethod> = Object.freeze(['visual', 'sound']);
/** A resolved (`normal`) notification clears with no method: there is nothing to present. */
const NO_METHODS: ReadonlyArray<NotificationMethod> = Object.freeze([]);
const ALL_NOTIFICATION_PATHS: ReadonlyArray<string> = Object.freeze(
  Object.values(NOTIFICATION_PATHS)
);

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
  // UTF-16 length is an upper bound on code-point count: a string within the
  // cap by UTF-16 units is within it by code points too.
  if (message.length <= MAX_MESSAGE_LENGTH) return message;
  const points = Array.from(message);
  if (points.length <= MAX_MESSAGE_LENGTH) return message;
  // Trim to MAX_MESSAGE_LENGTH - 1 code points and append the ellipsis so the
  // result is exactly MAX_MESSAGE_LENGTH code points (ellipsis replaces, not adds).
  return `${points.slice(0, MAX_MESSAGE_LENGTH - 1).join('')}…`;
}

/** 16-point compass rose, indexed by floor((deg + 11.25) / 22.5) % 16 (the wrap maps [348.75, 360) back to N). */
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
  const deg = radiansToDegrees(normalizeAngle0To2Pi(radians));
  const idx = Math.floor((deg + 11.25) / 22.5) % 16;
  return CARDINAL_16[idx] ?? 'N';
}

function paToHpaRounded(pressurePa: number): number {
  return Math.round(pascalsToMillibars(pressurePa));
}

function kToCRounded(kelvin: number): number {
  return Math.round(kelvinToCelsius(kelvin));
}

function msRounded(ms: number): number {
  // `Math.round(ms * 10) / 10` carries an IEEE-754 wart at exact midpoints
  // (19.05 * 10 reaches 190.49999... due to the FP representation), but in
  // V8 / Node 20 the formatted-string path through `toFixed(1)` rounds the
  // SAME midpoints in the opposite direction (12.95 -> '12.9', 20.45 -> '20.4'),
  // which is also wrong by the user's expectation. Math.round is the lesser
  // surprise across the input distribution we actually emit: integer-rounded
  // upstream wind speeds round trivially, and the few midpoints that diverge
  // skew toward the user's expected "round half up" behaviour.
  return Math.round(ms * 10) / 10;
}

// Returns a number like the sibling unit helpers (paToHpaRounded, kToCRounded,
// msRounded); the call site applies the one-decimal presentation.
function metersToKm(meters: number): number {
  return meters / UNITS.LENGTH.KM_TO_M;
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
 * inputs. Optional fields use `asOptionalNumber` to narrow `number | undefined`
 * to a finite number.
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
  const gustSpeed = asOptionalNumber(data.windGustSpeed);
  if (gustSpeed !== undefined && (windSpeed === undefined || gustSpeed > windSpeed)) {
    parts.push(`gusts ${msRounded(gustSpeed)} m/s`);
  }
  if (Number.isFinite(data.pressure)) {
    parts.push(`${paToHpaRounded(data.pressure)} hPa`);
  }
  return parts.join(', ');
}

function formatVisibilitySuffix(data: WeatherData): string {
  const vis = data.visibility;
  if (vis === undefined) return '';
  const parts: string[] = [`${metersToKm(vis).toFixed(1)} km`];
  const ceilingVal = asOptionalNumber(data.cloudCeiling);
  if (ceilingVal !== undefined) {
    parts.push(`ceiling ${Math.round(ceilingVal)} m`);
  }
  // precipitationLastHour is a past-hour accumulation in mm; over a 1-hour
  // window that equals an average rate in mm/h.
  const precipVal = asOptionalNumber(data.precipitationLastHour);
  if (precipVal !== undefined && precipVal > 0) {
    parts.push(`rain ${precipVal.toFixed(1)} mm/h`);
  }
  return parts.join(', ');
}

function formatHeatSuffix(data: WeatherData): string {
  const hsi = data.heatStressIndex;
  if (hsi === undefined) return '';
  const parts: string[] = [`HSI ${hsi}`];
  const wbgtVal = asOptionalNumber(data.wetBulbGlobeTemperature);
  if (wbgtVal !== undefined) {
    parts.push(`WBGT ${kToCRounded(wbgtVal)} C`);
  }
  if (Number.isFinite(data.humidity)) {
    parts.push(`RH ${Math.round(ratioToPercentage(data.humidity))}%`);
  }
  const realFeelShadeVal = asOptionalNumber(data.realFeelShade);
  if (realFeelShadeVal !== undefined) {
    // Labeled like the REAL_FEEL_SHADE meta displayName so the operator does
    // not mistake the shade value for the full-sun environment.weather.realFeel.
    parts.push(`RealFeel (shade) ${kToCRounded(realFeelShadeVal)} C`);
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
 * The provider's weather description drives the lead phrase; pressure is
 * appended because a falling barometer alongside a thunderstorm condition is a
 * useful operational signal beyond what the condition alone conveys.
 */
function formatSevereSuffix(data: WeatherData, label: string): string {
  const description = data.description?.trim() ?? '';
  const lead = description ? `${label}: ${description}` : label;
  if (Number.isFinite(data.pressure)) {
    return `${lead}, ${paToHpaRounded(data.pressure)} hPa`;
  }
  return lead;
}

/**
 * One row of a hazard-band table. The band activates with `state` when the
 * reading crosses `threshold` (in the direction its owning {@link BandSet}
 * declares); otherwise it clears with `normal`. `prefix` is the
 * human-readable lead-in for the notification message (e.g. `Gale-force wind`).
 */
interface Band {
  readonly path: string;
  readonly threshold: number;
  readonly state: NotificationState;
  readonly prefix: string;
}

/**
 * A hazard category's bands together with the comparison direction they share.
 * Carrying the direction on the set (rather than as an `evaluateBands`
 * argument) makes a mismatched call impossible: ascending sets (wind, heat)
 * activate as the reading rises (`>= threshold`), descending sets (visibility,
 * cold) as it falls (`< threshold`).
 */
interface BandSet {
  readonly direction: 'ascending' | 'descending';
  readonly bands: ReadonlyArray<Band>;
}

const WIND_BANDS: BandSet = {
  direction: 'ascending',
  bands: [
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
  ],
};

const HEAT_BANDS: BandSet = {
  direction: 'ascending',
  bands: [
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
  ],
};

const VISIBILITY_BANDS: BandSet = {
  direction: 'descending',
  bands: [
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
  ],
};

const COLD_BANDS: BandSet = {
  direction: 'descending',
  bands: [
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
  ],
};

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
  /**
   * False until the first evaluate() after construction or reset(). While
   * unprimed, leading `normal` states ARE emitted: a previous plugin instance
   * (stopped by a config change, or crashed) may have left an active
   * notification latched in the server's full model, and only a fresh
   * `normal` write can clear it. Once primed, leading normals are suppressed
   * again because the bus is known to have nothing to clear.
   */
  private primed = false;

  constructor(config: NotificationsConfig, logger: Logger = () => {}) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Severe-condition messages include the provider's weather description
   * (e.g. `Thunderstorms: Severe thunderstorms approaching`) so the operator
   * sees the underlying condition rather than just the code-derived label.
   * Empty array is the common case: no enabled band transitioned this tick.
   *
   * Timestamps and per-band message strings are computed lazily inside
   * `maybeTransition`: when no band transitions (the steady-state norm) the
   * notifier allocates nothing.
   */
  public evaluate(data: WeatherData): PathValue[] {
    if (!this.config.enabled) {
      return this.primed ? [] : this.clearAll();
    }

    const transitions: PathValue[] = [];

    if (this.config.wind) this.evaluateWind(data, transitions);
    else this.clearBands(WIND_BANDS, transitions);
    if (this.config.visibility) this.evaluateVisibility(data, transitions);
    else this.clearBands(VISIBILITY_BANDS, transitions);
    if (this.config.heat) this.evaluateHeat(data, transitions);
    else this.clearBands(HEAT_BANDS, transitions);
    if (this.config.cold) this.evaluateCold(data, transitions);
    else this.clearBands(COLD_BANDS, transitions);
    if (this.config.weather) this.evaluateSevereCondition(data, transitions);
    else this.maybeTransition(NOTIFICATION_PATHS.WEATHER_SEVERE, 'normal', () => '', transitions);

    if (transitions.length > 0) {
      this.logger('info', 'Weather notifications transitioned', {
        count: transitions.length,
        paths: transitions.map((t) => t.path),
      });
    }

    this.primed = true;
    return transitions;
  }

  /**
   * Reset all band state so a fresh start() begins with every band inactive
   * and unprimed: the first evaluate() after the restart re-emits each
   * enabled band's state (including `normal`) so a hazard that cleared while
   * the plugin was stopped does not stay latched in the server model.
   */
  public reset(): void {
    this.lastState.clear();
    this.primed = false;
  }

  /**
   * Emit an explicit normal state for every path owned by this plugin. This is
   * used on disable and stop so alarms cannot remain latched in the server's
   * full model when their category is no longer evaluated.
   */
  public clearAll(): PathValue[] {
    const transitions: PathValue[] = [];
    for (const path of ALL_NOTIFICATION_PATHS) {
      this.lastState.set(path, 'normal');
      transitions.push(
        pv(path, {
          state: 'normal',
          method: NO_METHODS,
          message: '',
          timestamp: new Date().toISOString(),
        } satisfies NotificationValue)
      );
    }
    this.primed = true;
    return transitions;
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
    if (bft === undefined) {
      this.clearBands(WIND_BANDS, out);
      return;
    }
    this.evaluateBands(WIND_BANDS, bft, () => formatWindSuffix(data), out);
  }

  /**
   * Visibility: low (1 nm, warn) and very-low (0.5 nm, alarm) tracked
   * independently. 1 nm is the plugin's chosen restricted-visibility
   * threshold; neither SOLAS nor the COLREGs define a numeric value.
   */
  private evaluateVisibility(data: WeatherData, out: PathValue[]): void {
    const vis = data.visibility;
    if (vis === undefined) {
      this.clearBands(VISIBILITY_BANDS, out);
      return;
    }
    this.evaluateBands(VISIBILITY_BANDS, vis, () => formatVisibilitySuffix(data), out);
  }

  /**
   * Heat stress: caution (HSI 2, warn), high (HSI 3, alarm), extreme
   * (HSI 4, emergency). Driven by the provider's wet-bulb globe temperature
   * (measured by AccuWeather, estimated for Open-Meteo); the suffix surfaces
   * WBGT, RH, and RealFeel-in-shade (when present) so the operator sees both
   * the index and the underlying physiology drivers.
   */
  private evaluateHeat(data: WeatherData, out: PathValue[]): void {
    const hsi = data.heatStressIndex;
    if (hsi === undefined) {
      this.clearBands(HEAT_BANDS, out);
      return;
    }
    this.evaluateBands(HEAT_BANDS, hsi, () => formatHeatSuffix(data), out);
  }

  /**
   * Drive a band set against one numeric reading, using the comparison
   * direction the set declares (ascending: `value >= threshold`; descending:
   * `value < threshold`). Each band clears with `normal` otherwise. The
   * scalar-suffix producer is invoked lazily inside `maybeTransition` only
   * when a transition actually fires, so steady-state evaluations skip string
   * formatting entirely.
   */
  private evaluateBands(
    set: BandSet,
    value: number,
    scalarSuffix: () => string,
    out: PathValue[]
  ): void {
    for (const band of set.bands) {
      const active =
        set.direction === 'ascending' ? value >= band.threshold : value < band.threshold;
      const desired = active ? band.state : 'normal';
      // On exit (desired 'normal') pass an empty message so a cleared alert
      // does not carry stale hazard text, matching clearBands and
      // evaluateSevereCondition.
      this.maybeTransition(
        band.path,
        desired,
        desired === 'normal' ? () => '' : () => `${band.prefix}: ${scalarSuffix()}`,
        out
      );
    }
  }

  /**
   * Drive every band in a set to `normal`. Used when the band's numeric driver
   * is missing from a partial provider response: without this the bands
   * would latch in their last active state with no exit edge, leaving a stale
   * alarm on the bus until a later response happens to carry the driver again.
   * Mirrors the clear-to-normal path in {@link evaluateSevereCondition}.
   */
  private clearBands(set: BandSet, out: PathValue[]): void {
    for (const band of set.bands) {
      this.maybeTransition(band.path, 'normal', () => '', out);
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
    if (!Number.isFinite(windChillK)) {
      this.clearBands(COLD_BANDS, out);
      return;
    }
    this.evaluateBands(COLD_BANDS, windChillK, () => formatColdSuffix(data), out);
  }

  /**
   * Severe weather condition: single path whose state varies by the
   * provider-agnostic `severeCondition` each provider's transform supplies.
   * Returns to `normal` whenever the current condition is benign (no
   * `severeCondition`). Description comes from the provider's weather
   * description so consumers see the operator-friendly phrase; on exit the message is
   * empty so consumers see `state: 'normal'` without a fake "No severe
   * weather" phrase being parsed as a real condition. Barometric pressure is
   * appended when finite: a thunderstorm paired with a falling barometer is a
   * useful operational signal.
   */
  private evaluateSevereCondition(data: WeatherData, out: PathValue[]): void {
    const severity = data.severeCondition;

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
   * differs from the last state emitted for this path. Once primed, the first
   * evaluation against `normal` records `normal` in lastState (so a later
   * transition to an active band correctly emits the entry delta) but does
   * NOT emit a delta: the bus has nothing to clear. Result: `lastState` may
   * contain many paths in `normal` state, but `getActiveCount` still returns
   * 0 because it counts only non-normal entries. On the unprimed first
   * evaluate after a (re)start the leading `normal` IS emitted, clearing any
   * notification a previous plugin instance left latched. Disabled categories
   * are explicitly evaluated as normal so configuration changes also clear them.
   *
   * The message producer and the transition timestamp are computed lazily so
   * the steady-state case allocates no strings.
   */
  private maybeTransition(
    path: string,
    desired: NotificationState,
    message: () => string,
    out: PathValue[]
  ): void {
    const prior = this.lastState.get(path);
    if (prior === undefined && desired === 'normal' && this.primed) {
      // Suppress the leading `normal`: the band has never been active since
      // priming, so the bus has nothing to clear. Record the state so a later
      // transition to an active band correctly emits the entry delta.
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
