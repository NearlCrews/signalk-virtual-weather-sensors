/**
 * Pure Met.no Locationforecast 2.0 timeseries to SK v2 WeatherData mapping.
 *
 * The Met.no forecast shape is a TIMESERIES OF OBJECTS (not columnar arrays
 * like Open-Meteo): each entry carries `data.instant.details` for the current
 * snapshot and `data.next_1_hours` / `data.next_6_hours` for period summaries.
 * These three functions go directly from the Met.no response shape to the SK
 * v2 `WeatherData` envelope without touching the internal `WeatherData` type.
 *
 * Met.no has no visibility and no apparent temperature: those leaves are omitted.
 *
 * Units:
 *   wind speeds   m/s   (Met.no always uses m/s)
 *   pressure      hPa   (millibarsToPA converts to Pa)
 *   temperatures  C     (optionalCelsiusToKelvin)
 *   humidity      %     (optionalPercentageToRatio)
 *   cloud cover   %     (optionalPercentageToRatio)
 *   precipitation mm    (* UNITS.PRECIPITATION.MM_TO_M)
 *   wind dir      deg   (handled inside buildWindFromMs via degreesToRadians)
 */

import type { WeatherData as SKWeatherData } from '@signalk/server-api';
import { UNITS } from '../constants/index.js';
import { metNoSymbolBase } from '../providers/met-no-severity.js';
import type { MetNoLocationforecastResponse, MetNoTimeseriesEntry } from '../types/index.js';
import {
  asOptionalNumber,
  millibarsToPA,
  optionalCelsiusToKelvin,
  optionalPercentageToRatio,
} from '../utils/conversions.js';
import { MET_NO_DESCRIPTIONS } from './MetNoMapper.js';
import { buildSkOutsideSI, buildWindFromMs } from './skV2Envelope.js';

const GRID_HOURS = [0, 6, 12, 18];

/** Per-day accumulator for the daily derivation. */
interface DayAcc {
  maxC: number;
  minC: number;
  precipMm: number;
  hasPrecip: boolean;
  description: string | undefined;
  has12: boolean;
}

/**
 * Build one SK v2 entry (point or observation) from a timeseries entry's instant block plus next_1_hours.
 * The first timeseries entry usually carries next_1_hours, but may not when a fresh model run starts
 * on a 6-hour boundary. In that case the next_1_hours-derived fields (precipitation, description) are
 * simply omitted via the optional chaining below.
 */
function mapEntry(entry: MetNoTimeseriesEntry, type: 'point' | 'observation'): SKWeatherData {
  const instant = entry.data?.instant?.details;
  const next1 = entry.data?.next_1_hours;

  const pressureMbar = asOptionalNumber(instant?.air_pressure_at_sea_level);
  const precipitationMm = asOptionalNumber(next1?.details?.precipitation_amount);
  const outside = buildSkOutsideSI({
    temperatureK: optionalCelsiusToKelvin(instant?.air_temperature),
    dewPointK: optionalCelsiusToKelvin(instant?.dew_point_temperature),
    rhRatio: optionalPercentageToRatio(instant?.relative_humidity),
    pressurePa: pressureMbar !== undefined ? millibarsToPA(pressureMbar) : undefined,
    cloudCover: optionalPercentageToRatio(instant?.cloud_area_fraction),
    uvIndex: asOptionalNumber(instant?.ultraviolet_index_clear_sky),
    precipitationVolumeM:
      precipitationMm !== undefined ? precipitationMm * UNITS.PRECIPITATION.MM_TO_M : undefined,
  });
  const wind = buildWindFromMs(
    asOptionalNumber(instant?.wind_speed),
    asOptionalNumber(instant?.wind_from_direction),
    asOptionalNumber(instant?.wind_speed_of_gust)
  );
  const base = metNoSymbolBase(next1?.summary?.symbol_code);
  const description = base !== undefined ? MET_NO_DESCRIPTIONS.get(base) : undefined;

  return {
    date: entry.time ?? '',
    type,
    ...(description !== undefined && { description }),
    outside,
    ...(wind !== undefined && { wind }),
  };
}

/**
 * Merge one canonical 6-hour grid window into the per-day accumulator.
 * Prefer the 12:00 UTC window for description; fall back to the first window seen.
 * Note: air_temperature_max and air_temperature_min live ONLY on
 * next_6_hours.details, not on next_1_hours.details (even though the shared
 * MetNoPeriod type declares them on both shapes).
 */
function accumulateWindow(
  acc: DayAcc,
  hour: number,
  maxC: number | undefined,
  minC: number | undefined,
  precipMm: number,
  precipPresent: boolean,
  desc: string | undefined
): void {
  if (maxC !== undefined && maxC > acc.maxC) acc.maxC = maxC;
  if (minC !== undefined && minC < acc.minC) acc.minC = minC;
  acc.precipMm += precipMm;
  if (precipPresent) acc.hasPrecip = true;
  if (hour === 12) {
    acc.description = desc;
    acc.has12 = true;
  } else if (!acc.has12 && acc.description === undefined && desc !== undefined) {
    acc.description = desc;
  }
}

/** Build the SK v2 daily entry from a finalized per-day accumulator. */
function buildDailyEntry(day: string, acc: DayAcc): SKWeatherData {
  const maxTemperatureK = acc.maxC !== -Infinity ? optionalCelsiusToKelvin(acc.maxC) : undefined;
  const minTemperatureK = acc.minC !== Infinity ? optionalCelsiusToKelvin(acc.minC) : undefined;
  return {
    date: day,
    type: 'daily',
    ...(acc.description !== undefined && { description: acc.description }),
    outside: {
      ...(maxTemperatureK !== undefined && { maxTemperature: maxTemperatureK }),
      ...(minTemperatureK !== undefined && { minTemperature: minTemperatureK }),
      ...(acc.hasPrecip && { precipitationVolume: acc.precipMm * UNITS.PRECIPITATION.MM_TO_M }),
    },
  };
}

/**
 * Process one timeseries entry into the byDay accumulator map. Returns early
 * when the entry is not a canonical-grid 6-hour window (missing next_6_hours,
 * or UTC hour is not 0, 6, 12, or 18). Extracted to keep mapMetNoToDailyForecasts
 * within the cognitive-complexity limit.
 */
function processGridWindow(entry: MetNoTimeseriesEntry, byDay: Map<string, DayAcc>): void {
  const time = entry.time;
  if (typeof time !== 'string') return;

  const next6 = entry.data?.next_6_hours;
  if (next6?.details === undefined) return;

  // Parse UTC hour as a number so '06' matches 6 in the numeric set.
  const hour = Number(time.slice(11, 13));
  if (!GRID_HOURS.includes(hour)) return;

  const day = time.slice(0, 10);
  const maxC = asOptionalNumber(next6.details.air_temperature_max);
  const minC = asOptionalNumber(next6.details.air_temperature_min);
  const rawPrecip = asOptionalNumber(next6.details.precipitation_amount);
  const precipMm = rawPrecip ?? 0;
  const precipPresent = rawPrecip !== undefined;
  const base = metNoSymbolBase(next6.summary?.symbol_code);
  const desc = base !== undefined ? MET_NO_DESCRIPTIONS.get(base) : undefined;

  const existing = byDay.get(day);
  if (existing === undefined) {
    byDay.set(day, {
      maxC: maxC ?? -Infinity,
      minC: minC ?? Infinity,
      precipMm,
      hasPrecip: precipPresent,
      description: desc,
      has12: hour === 12,
    });
  } else {
    accumulateWindow(existing, hour, maxC, minC, precipMm, precipPresent, desc);
  }
}

/** Map the Met.no timeseries entries that carry next_1_hours to ascending `point` WeatherData entries. */
export function mapMetNoToHourlyForecasts(
  response: MetNoLocationforecastResponse
): SKWeatherData[] {
  const timeseries = response.properties?.timeseries ?? [];
  return timeseries
    .filter((e) => e.data?.next_1_hours !== undefined)
    .map((e) => mapEntry(e, 'point'));
}

/**
 * Map the first timeseries entry to a single `observation` WeatherData entry.
 * Returns a degenerate envelope when the timeseries is empty so the v2 surface
 * degrades gracefully rather than throwing.
 */
export function mapMetNoToObservation(response: MetNoLocationforecastResponse): SKWeatherData {
  const first = response.properties?.timeseries?.[0];
  if (first === undefined) {
    return { date: '', type: 'observation', outside: {} };
  }
  return mapEntry(first, 'observation');
}

/**
 * Map the Met.no timeseries to ascending `daily` WeatherData entries.
 *
 * Only canonical-grid 6-hour windows are used: an entry qualifies when it
 * carries next_6_hours.details AND its UTC hour is 0, 6, 12, or 18.
 * Near-term entries at non-grid hours (01:00, 02:00, etc.) also carry an
 * overlapping next_6_hours block; they are deliberately excluded here to avoid
 * double-counting precipitation across overlapping windows.
 *
 * Per day: maxTemperature = max of next_6_hours.details.air_temperature_max,
 * minTemperature = min of next_6_hours.details.air_temperature_min, and
 * precipitationVolume = sum of next_6_hours.details.precipitation_amount * MM_TO_M.
 * The description comes from the 12:00 UTC window, falling back to the earliest
 * window seen for the day. The hour is parsed from the ISO 8601 string with slice
 * (UTC, so string-slicing is timezone-safe and avoids new Date).
 */
export function mapMetNoToDailyForecasts(response: MetNoLocationforecastResponse): SKWeatherData[] {
  const timeseries = response.properties?.timeseries ?? [];
  const byDay = new Map<string, DayAcc>();
  for (const entry of timeseries) {
    processGridWindow(entry, byDay);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, acc]) => buildDailyEntry(day, acc));
}
