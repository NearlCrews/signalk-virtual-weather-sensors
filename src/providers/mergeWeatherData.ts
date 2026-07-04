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
 *   primary               - always from dataList[0] (timestamp)
 *   derived               - recomputed from the merged base through shared helpers
 *   excluded              - omitted (apparent-wind fields added downstream in WeatherService)
 */
import { deriveBaseWeatherFields } from '../calculators/deriveWeatherFields.js';
import type { SevereCondition, WeatherData } from '../types/index.js';
import type { NotificationState } from '../types/plugin.js';
import {
  calculateGustFactor,
  calculateHeatStressIndex,
  normalizeAngle0To2Pi,
} from '../utils/conversions.js';

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
export const FIELD_MERGE_KINDS: Readonly<Record<keyof WeatherData, MergeKind>> = {
  // Core required fields
  temperature: 'mean',
  pressure: 'mean',
  humidity: 'mean',
  windSpeed: 'mean',
  windDirection: 'circular',
  dewPoint: 'mean',
  windChill: 'derived',
  heatIndex: 'derived',
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
  // Precipitation
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
  beaufortScale: 'derived',
  airDensityEnhanced: 'derived',
  absoluteHumidity: 'derived',
  heatStressIndex: 'derived',
  // Condition detail
  pressureTendency: 'conservative-tendency',
  precipitationType: 'categorical',
  visibilityObstruction: 'categorical',
};

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
  return dataList.map((d) => d[key] as unknown).filter((v): v is number => typeof v === 'number');
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
 * Optional mean fields spread into the output object. Each entry is only
 * present when at least one provider supplied the field.
 */
function meanOptionals(dataList: ReadonlyArray<WeatherData>): MutablePartialWeatherData {
  const opt: MutablePartialWeatherData = {};
  const addMean = (key: keyof WeatherData, vals: number[]): void => {
    if (vals.length > 0) (opt as Record<keyof WeatherData, unknown>)[key] = mean(vals);
  };
  addMean('realFeel', collectNums(dataList, 'realFeel'));
  addMean('realFeelShade', collectNums(dataList, 'realFeelShade'));
  addMean('wetBulbTemperature', collectNums(dataList, 'wetBulbTemperature'));
  addMean('apparentTemperature', collectNums(dataList, 'apparentTemperature'));
  addMean('uvIndex', collectNums(dataList, 'uvIndex'));
  addMean('cloudCover', collectNums(dataList, 'cloudCover'));
  addMean('cloudCeiling', collectNums(dataList, 'cloudCeiling'));
  addMean('temperatureDeparture24h', collectNums(dataList, 'temperatureDeparture24h'));
  return opt;
}

/**
 * Hazard and categorical optional fields spread into the output object. Covers
 * hazard-max, hazard-min, conservative-tendency, priority-present, and categorical
 * fields that are absent from some providers.
 */
function hazardAndCategoricalOptionals(
  dataList: ReadonlyArray<WeatherData>,
  mergedWindSpeed: number
): MutablePartialWeatherData {
  const opt: MutablePartialWeatherData = {};

  const precipVals = collectNums(dataList, 'precipitationLastHour');
  if (precipVals.length > 0) opt.precipitationLastHour = hazardMax(precipVals);

  const gustVals = collectNums(dataList, 'windGustSpeed');
  const gustSpeed = gustVals.length > 0 ? hazardMax(gustVals) : undefined;
  if (gustSpeed !== undefined) opt.windGustSpeed = gustSpeed;

  const gustFactor = calculateGustFactor(gustSpeed, mergedWindSpeed);
  if (gustFactor !== undefined) opt.windGustFactor = gustFactor;

  const visVals = collectNums(dataList, 'visibility');
  if (visVals.length > 0) opt.visibility = hazardMin(visVals);

  const tendency = mergeTendency(collectNums(dataList, 'pressureTendency'));
  if (tendency !== undefined) opt.pressureTendency = tendency;

  const wbgt = firstPresent(dataList, 'wetBulbGlobeTemperature');
  if (wbgt !== undefined) {
    opt.wetBulbGlobeTemperature = wbgt;
    // heatStressIndex from the SELECTED WBGT, not a re-estimate from merged base.
    opt.heatStressIndex = calculateHeatStressIndex(wbgt);
  }

  const severe = maxSeverity(dataList);
  if (severe !== undefined) opt.severeCondition = severe;

  const desc = firstPresent(dataList, 'description');
  if (desc !== undefined) opt.description = desc;

  const icon = firstPresent(dataList, 'weatherIcon');
  if (icon !== undefined) opt.weatherIcon = icon;

  const precipType = firstPresent(dataList, 'precipitationType');
  if (precipType !== undefined) opt.precipitationType = precipType;

  const visObs = firstPresent(dataList, 'visibilityObstruction');
  if (visObs !== undefined) opt.visibilityObstruction = visObs;

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

  // Optional fields by policy kind
  const optMeans = meanOptionals(dataList);
  const optHazard = hazardAndCategoricalOptionals(dataList, mergedWindSpeed);

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
    // Derived base (recomputed, never averaged)
    windChill: derived.windChill,
    heatIndex: derived.heatIndex,
    beaufortScale: derived.beaufortScale,
    absoluteHumidity: derived.absoluteHumidity,
    airDensityEnhanced: derived.airDensityEnhanced,
    // Primary timestamp
    timestamp: primary.timestamp,
    // Optional fields
    ...optMeans,
    ...optHazard,
  };
}
