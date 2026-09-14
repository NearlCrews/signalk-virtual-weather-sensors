/**
 * Pure merge engine for the synthesis provider. Blends a priority-ordered list
 * of WeatherData survivors into a single synthetic WeatherData according to the
 * field policy table declared in FIELD_MERGE_KINDS. No I/O, no provider coupling.
 *
 * Policy summary:
 *   mean                  - arithmetic mean of present values (temperatures, pressure, etc.)
 *   circular              - speed-weighted circular mean for wind direction
 *   hazard-max            - highest present value (precipitation, gusts, severe condition)
 *   hazard-min            - lowest present value (visibility)
 *   conservative-tendency - falling (-1) wins; else priority first-present
 *   priority-present      - first element that supplies the field (WBGT, categorical)
 *   categorical           - same as priority-present for string/number labels
 *   primary               - always from dataList[0] (timestamp, which
 *                           MergingWeatherProvider then replaces with the
 *                           oldest surviving child's)
 *   derived               - recomputed from the merged base through shared helpers
 *   excluded              - omitted (apparent-wind fields added downstream in WeatherService)
 *
 * Hazard drivers vs published measurements:
 *   Every value a notification band reads is taken conservatively from the
 *   survivors, never from the mean, because averaging two providers can cancel
 *   a band that either one alone would raise: 18.0 m/s (Bf8, gale) blended with
 *   15.0 m/s (Bf7) yields 16.5 m/s (Bf7) and no gale warning. Which fields
 *   those are, and why each one is what it is, is stated per entry in
 *   FIELD_MERGE_KINDS below; that table is the only place a field's policy is
 *   declared, and `reduceNumeric` runs the kind it declares. A conservative
 *   category can therefore sit beside a lower merged measurement (Bf8 next to
 *   16.5 m/s); that is deliberate, and it is the same trade
 *   `windGustSpeed: hazard-max` beside `windSpeed: mean` already makes.
 */
import { deriveBaseWeatherFields } from '../calculators/deriveWeatherFields.js';
import type { SevereCondition, WeatherData } from '../types/index.js';
import type { NotificationState } from '../types/plugin.js';
import { calculateGustFactor, normalizeAngle0To2Pi } from '../utils/conversions.js';

// ---- Public types ----

export type MergeKind =
  | 'mean'
  | 'circular'
  | 'hazard-max'
  | 'hazard-min'
  | 'priority-present'
  | 'conservative-tendency'
  | 'categorical'
  | 'primary'
  | 'derived'
  | 'excluded';

/**
 * The declared merge kind for every WeatherData field. The
 * Readonly<Record<keyof WeatherData, MergeKind>> type makes a missing key a
 * compile error, so adding a field to WeatherData without a declared policy
 * is caught at build time. The coverage test asserts the runtime key set
 * matches a fully-populated WeatherData sample as a second safety net.
 */
export const FIELD_MERGE_KINDS = {
  // Core required fields
  temperature: 'mean',
  pressure: 'mean',
  humidity: 'mean',
  windSpeed: 'mean',
  windDirection: 'circular',
  dewPoint: 'mean',
  // Cold-exposure band driver: the coldest survivor wins rather than a value
  // recomputed from the merged base, so a second provider reporting milder wind
  // cannot cancel a cold-exposure alarm the first one raises.
  windChill: 'hazard-min',
  heatIndex: 'derived',
  // Taken from the primary here, then replaced by MergingWeatherProvider with
  // the oldest surviving child's timestamp: a blend is only as fresh as its
  // stalest input, and the staleness gate reads this value. Nothing between the
  // two steps consumes it, so this stays 'primary' rather than growing a kind
  // that only the caller could implement.
  timestamp: 'primary',
  // Enhanced temperatures
  realFeel: 'mean',
  realFeelShade: 'mean',
  wetBulbTemperature: 'mean',
  // WBGT: priority first-present, NOT averaged. A measured globe temperature and
  // a shade-estimated one are different quantities. Set AccuWeather as the primary
  // to prefer its measured globe temperature over an Open-Meteo estimate.
  wetBulbGlobeTemperature: 'priority-present',
  apparentTemperature: 'mean',
  // Wind
  windGustSpeed: 'hazard-max',
  windGustFactor: 'derived',
  // Atmospheric
  uvIndex: 'mean',
  visibility: 'hazard-min',
  cloudCover: 'mean',
  cloudCeiling: 'mean',
  // Precipitation. Every contributor here reports a genuine preceding-hour
  // accumulation, so the max is a quantity of one kind. Keep forecast
  // precipitation out of it for the same reason WBGT is not averaged above: a
  // forecast for a coming hour and an accumulation over an elapsed one are
  // different quantities, and blending them yields a number that is neither.
  precipitationLastHour: 'hazard-max',
  // Temperature trend
  temperatureDeparture24h: 'mean',
  // Apparent wind: excluded (added downstream in WeatherService.enhanceWeatherData)
  apparentWindSpeed: 'excluded',
  apparentWindAngle: 'excluded',
  apparentWindChill: 'excluded',
  // Metadata
  description: 'categorical',
  weatherIcon: 'categorical',
  severeCondition: 'hazard-max',
  // Derived synthetics
  // Wind-band driver: the highest survivor's own Beaufort force, not the force
  // of the averaged wind speed. See the hazard-driver note in the file header.
  beaufortScale: 'hazard-max',
  airDensityEnhanced: 'derived',
  absoluteHumidity: 'derived',
  // Heat-band driver: the highest survivor's own index, so a sibling reporting
  // more heat stress than the primary is not discarded by priority order.
  heatStressIndex: 'hazard-max',
  // Condition detail
  pressureTendency: 'conservative-tendency',
  precipitationType: 'categorical',
  visibilityObstruction: 'categorical',
} as const satisfies Readonly<Record<keyof WeatherData, MergeKind>>;

// ---- Severity ladder (compile-exhaustive) ----

/**
 * Rank map for NotificationState. The Record type forces every member of the
 * union to be ranked, so adding a new state without ranking it fails type-check.
 */
const STATE_RANK: Readonly<Record<NotificationState, number>> = {
  normal: 0,
  alert: 1,
  warn: 2,
  alarm: 3,
  emergency: 4,
};

// ---- Pure local helpers ----

/** Arithmetic mean of a non-empty array. */
function mean(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/**
 * Speed-weighted circular mean for wind direction. When the resultant magnitude
 * is below epsilon (opposing winds cancel out), returns the first present
 * direction from the priority-ordered list rather than a meaningless 180-degree
 * flip.
 *
 * Note: atan2 can return a tiny negative value (floating-point noise near zero)
 * which normalizeAngle0To2Pi converts to a value just below 2π. We snap that
 * back to 0 since 2π and 0 are equivalent in circular arithmetic.
 *
 * Alignment invariant: windDirection and windSpeed are both REQUIRED WeatherData
 * fields, so the collected dirs and speeds arrays are index-aligned and
 * equal-length. The defensive ?? 0 and ?? 1 fallbacks never fire today; if
 * windDirection ever becomes optional, collect the pairs in a single pass so a
 * speed cannot misalign with the wrong direction.
 */
function circularMean(dirs: number[], speeds: number[], fallback: number): number {
  let sinSum = 0;
  let cosSum = 0;
  for (let i = 0; i < dirs.length; i++) {
    const s = speeds[i] ?? 1;
    sinSum += s * Math.sin(dirs[i] ?? 0);
    cosSum += s * Math.cos(dirs[i] ?? 0);
  }
  const magnitude = Math.sqrt(sinSum * sinSum + cosSum * cosSum);
  if (magnitude < 1e-9) return fallback;
  const angle = normalizeAngle0To2Pi(Math.atan2(sinSum, cosSum));
  // Snap floating-point values within 1e-9 of 2π back to 0 (they are equal in circular arithmetic).
  return angle >= 2 * Math.PI - 1e-9 ? 0 : angle;
}

/** Highest present numeric value. */
function hazardMax(values: number[]): number {
  return Math.max(...values);
}

/** Lowest present numeric value. */
function hazardMin(values: number[]): number {
  return Math.min(...values);
}

/**
 * First element in the priority-ordered list that supplies the given optional
 * field. Returns undefined when none present.
 */
function firstPresent<K extends keyof WeatherData>(
  dataList: ReadonlyArray<WeatherData>,
  key: K
): WeatherData[K] {
  for (const d of dataList) {
    if (d[key] !== undefined) return d[key];
  }
  return undefined as WeatherData[K];
}

/**
 * Highest-severity present condition, tie-broken by priority order (earlier
 * list element wins). Returns undefined when no element supplies the field.
 */
function maxSeverity(dataList: ReadonlyArray<WeatherData>): SevereCondition | undefined {
  let best: SevereCondition | undefined;
  let bestRank = -1;
  for (const d of dataList) {
    const c = d.severeCondition;
    if (c === undefined) continue;
    const rank = STATE_RANK[c.state];
    if (rank > bestRank) {
      best = c;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Collect all present numeric values for a WeatherData field across the list.
 * The intermediate `as unknown` cast is needed because TypeScript's strict index
 * access types `WeatherData[keyof WeatherData]` as a union that includes
 * non-numeric members; casting through `unknown` before filtering to `number`
 * is the narrowest safe route.
 */
function collectNums(dataList: ReadonlyArray<WeatherData>, key: keyof WeatherData): number[] {
  const values: number[] = [];
  for (const d of dataList) {
    const value = d[key] as unknown;
    if (typeof value === 'number') values.push(value);
  }
  return values;
}

/** The merge kinds that reduce a list of survivor numbers to one number. */
type NumericMergeKind = 'mean' | 'hazard-max' | 'hazard-min';

/**
 * Reducer per numeric merge kind. `reduceNumeric` looks the reducer up from the
 * field's declared kind instead of naming one at the call site, so the table is
 * the mechanism rather than a parallel spec: change a field's kind and the
 * merge changes with it, and a field whose kind has no numeric reducer is a
 * compile error rather than a silently unchanged rule.
 */
const NUMERIC_REDUCERS: Readonly<Record<NumericMergeKind, (values: number[]) => number>> = {
  mean,
  'hazard-max': hazardMax,
  'hazard-min': hazardMin,
};

/** A numeric WeatherData field whose declared kind has a reducer. */
type ReducedField = {
  [K in keyof WeatherData]-?: (typeof FIELD_MERGE_KINDS)[K] extends NumericMergeKind
    ? NonNullable<WeatherData[K]> extends number
      ? K
      : never
    : never;
}[keyof WeatherData];

/**
 * Merge one numeric field across the survivors under its declared kind, or
 * undefined when no survivor supplied it. The empty-list policy is stated here
 * once: an optional field stays absent, and the two required hazard drivers
 * name their own fallback at the call site.
 */
function reduceNumeric(
  dataList: ReadonlyArray<WeatherData>,
  key: ReducedField
): number | undefined {
  const values = collectNums(dataList, key);
  if (values.length === 0) return undefined;
  return NUMERIC_REDUCERS[FIELD_MERGE_KINDS[key]](values);
}

/**
 * Conservative-tendency merge: falling (-1) overrides all; else the priority
 * first-present value. Returns undefined when no element supplies the field.
 * `vals` comes from collectNums, which preserves priority order, so vals[0]
 * IS the highest-priority present value; no second scan needed.
 */
function mergeTendency(vals: number[]): number | undefined {
  if (vals.length === 0) return undefined;
  if (vals.includes(-1)) return -1;
  return vals[0];
}

/** Mutable accumulator used inside helper builders; spread into the final readonly result. */
type MutablePartialWeatherData = { -readonly [K in keyof WeatherData]?: WeatherData[K] };

/**
 * Write `value` under `key` when it is present. Absent stays absent, stated
 * once here rather than guarded at every optional field, so no field can be
 * emitted as a real 0 by a forgotten check.
 */
function optionalWriter(opt: MutablePartialWeatherData) {
  return (key: keyof WeatherData, value: unknown): void => {
    if (value !== undefined) (opt as Record<keyof WeatherData, unknown>)[key] = value;
  };
}

/**
 * Optional fields reduced from the survivors' numeric values. The reducer per
 * field is whatever FIELD_MERGE_KINDS declares, so this list decides only WHICH
 * fields are optional numerics, never how they blend.
 */
const REDUCED_OPTIONAL_FIELDS = [
  'realFeel',
  'realFeelShade',
  'wetBulbTemperature',
  'apparentTemperature',
  'uvIndex',
  'cloudCover',
  'cloudCeiling',
  'temperatureDeparture24h',
  'precipitationLastHour',
  'visibility',
  'heatStressIndex',
] as const satisfies ReadonlyArray<ReducedField>;

/**
 * Optional fields taken from the first survivor that supplies them
 * (priority-present and categorical). The published WBGT is here rather than
 * averaged because a measured globe temperature and a shade-estimated one are
 * different quantities; the heat band reads `heatStressIndex` instead, which
 * every survivor derived from its own WBGT.
 */
const FIRST_PRESENT_OPTIONAL_FIELDS = [
  'wetBulbGlobeTemperature',
  'description',
  'weatherIcon',
  'precipitationType',
  'visibilityObstruction',
] as const satisfies ReadonlyArray<keyof WeatherData>;

/**
 * Every optional field of the merged result, spread into the output object.
 * An entry appears only when at least one survivor supplied the field.
 */
function optionalFields(
  dataList: ReadonlyArray<WeatherData>,
  mergedWindSpeed: number
): MutablePartialWeatherData {
  const opt: MutablePartialWeatherData = {};
  const add = optionalWriter(opt);

  for (const key of REDUCED_OPTIONAL_FIELDS) add(key, reduceNumeric(dataList, key));
  for (const key of FIRST_PRESENT_OPTIONAL_FIELDS) add(key, firstPresent(dataList, key));

  const gustSpeed = reduceNumeric(dataList, 'windGustSpeed');
  add('windGustSpeed', gustSpeed);
  add('windGustFactor', calculateGustFactor(gustSpeed, mergedWindSpeed));

  add('pressureTendency', mergeTendency(collectNums(dataList, 'pressureTendency')));
  add('severeCondition', maxSeverity(dataList));

  return opt;
}

// ---- Public API ----

/**
 * Blend a priority-ordered list of WeatherData survivors into one synthetic
 * WeatherData per the FIELD_MERGE_KINDS policy. The primary (dataList[0]) sets
 * the timestamp; the merged result carries no provider-specific source ref
 * (the MergingWeatherProvider stamps 'vws-merged' on its delta). The list must
 * contain at least one element; the provider is responsible for the empty-list
 * guard.
 */
export function mergeWeatherData(dataList: ReadonlyArray<WeatherData>): WeatherData {
  // dataList is guaranteed non-empty by the caller contract (length >= 1)
  // biome-ignore lint/style/noNonNullAssertion: length >= 1 is the caller contract
  const primary = dataList[0]!;

  // SCALAR MEAN: required base fields
  const mergedTemperature = mean(collectNums(dataList, 'temperature'));
  const mergedPressure = mean(collectNums(dataList, 'pressure'));
  const mergedHumidity = mean(collectNums(dataList, 'humidity'));
  const windSpeeds = collectNums(dataList, 'windSpeed');
  const mergedWindSpeed = mean(windSpeeds);
  const mergedDewPoint = mean(collectNums(dataList, 'dewPoint'));

  // CIRCULAR MEAN: speed-weighted wind direction (reuses the windSpeeds array computed above)
  const fallbackDir = firstPresent(dataList, 'windDirection') ?? 0;
  const mergedWindDirection = circularMean(
    collectNums(dataList, 'windDirection'),
    windSpeeds,
    fallbackDir
  );

  // DERIVED: recompute the five base-derived fields from the merged base
  const derived = deriveBaseWeatherFields(
    mergedTemperature,
    mergedPressure,
    mergedHumidity,
    mergedWindSpeed
  );

  // REQUIRED HAZARD DRIVERS: reduced under the kind FIELD_MERGE_KINDS declares.
  // The fallbacks never fire today (both fields come from deriveBaseWeatherFields
  // on every provider path) and exist so a future provider that omits them still
  // yields a complete WeatherData.
  const mergedWindChill = reduceNumeric(dataList, 'windChill') ?? derived.windChill;
  const mergedBeaufortScale = reduceNumeric(dataList, 'beaufortScale') ?? derived.beaufortScale;

  const optional = optionalFields(dataList, mergedWindSpeed);

  // Assemble. apparentWindSpeed, apparentWindAngle, and apparentWindChill are
  // EXCLUDED: they are added downstream in WeatherService.enhanceWeatherData.
  return {
    // Required base
    temperature: mergedTemperature,
    pressure: mergedPressure,
    humidity: mergedHumidity,
    windSpeed: mergedWindSpeed,
    windDirection: mergedWindDirection,
    dewPoint: mergedDewPoint,
    // Conservative hazard drivers (survivor extremes, never averaged)
    windChill: mergedWindChill,
    beaufortScale: mergedBeaufortScale,
    // Derived base (recomputed, never averaged)
    heatIndex: derived.heatIndex,
    absoluteHumidity: derived.absoluteHumidity,
    airDensityEnhanced: derived.airDensityEnhanced,
    // Primary timestamp
    timestamp: primary.timestamp,
    // Optional fields
    ...optional,
  };
}
