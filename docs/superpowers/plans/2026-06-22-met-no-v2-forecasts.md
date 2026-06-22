# Met.no v2 Forecasts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Met.no forecast-capable in the Signal K v2 Weather API (observations, hourly point forecasts, and daily forecasts), so selecting Met.no registers a weather provider, `/signalk/v2/api/weather/_providers` is non-empty, and the panel "Weather API" card shows On under Met.no.

**Architecture:** Phase 2 of three (phase 1 added the keyless current-conditions provider; phase 3 adds MetAlerts warnings). It follows the exact pattern Plan 2 used for Open-Meteo: `MetNoService` gains `getObservation`, `getHourlyForecast`, `getDailyForecast`, and a declared `forecastCapabilities`, which makes `supportsForecasts(provider)` true, so the existing registration gate in `index.ts` auto-registers the v2 provider with NO change to `index.ts` or `WeatherProviderAdapter`. A new pure `MetNoForecastMapper` converts the Met.no Locationforecast timeseries into the SK v2 `WeatherData` envelope, paralleling `OpenMeteoForecastMapper`. One Met.no difference drives the design: a single `/complete` fetch returns the current entry AND the full multi-day forecast, so the three v2 methods share one memoized document instead of three param-specific requests. The shared SK-v2 `outside`-block assembly (currently duplicated inside `OpenMeteoForecastMapper`) is hoisted into `skV2Envelope.ts` and reused by both providers.

**Tech Stack:** TypeScript (strict, ES2023), ESM (NodeNext), Vitest, Biome, `@signalk/server-api` (peer, types only).

## Global Constraints

- ESM NodeNext: import sibling modules with the `.js` specifier even from `.ts` source.
- Node floor 20.18; `@signalk/server-api` is a types-only peer dependency.
- The SK v2 envelope is SI: temperatures K, pressure Pa, speeds m/s, angles radians in [0, 2π), humidity and cloud as 0..1 ratio, visibility m, precipitationVolume m. Met.no `/complete` source units (verified against the data model and a live response): `air_temperature` and `dew_point_temperature` Celsius (`optionalCelsiusToKelvin`), `air_pressure_at_sea_level` hPa (`millibarsToPA`), `relative_humidity` and `cloud_area_fraction` percent (`optionalPercentageToRatio`), `wind_speed` and `wind_speed_of_gust` m/s (no conversion, handed straight to `buildWindFromMs`), `wind_from_direction` degrees (converted inside `buildWindFromMs`), `ultraviolet_index_clear_sky` a dimensionless index, `next_1_hours.details.precipitation_amount` and `next_6_hours.details.precipitation_amount` mm (`* UNITS.PRECIPITATION.MM_TO_M` for the v2 `precipitationVolume`). Met.no provides NO visibility, NO apparent temperature, and NO sunrise/sunset, so those leaves are unset.
- v2 ordering contract: `getHourlyForecast` and `getDailyForecast` return ASCENDING by date (the Met.no timeseries is already ascending); `getObservation` returns a single value (the adapter wraps it). The v2 `date` field is a REQUIRED string: use `entry.time ?? ''` for hourly and observation (the timeseries `time` is always present in practice, but the type is optional), and the `YYYY-MM-DD` UTC day string for daily.
- Met.no facts (verified June 2026): one `GET /weatherapi/locationforecast/2.0/complete?lat=&lon=` returns the full ~10-day timeseries including the current-hour entry, so it serves observation, hourly, AND daily from one fetch. Entries within roughly the first 53 hours carry `next_1_hours` (1-hour resolution); beyond that the steps are 6-hourly. Three instant fields (`ultraviolet_index_clear_sky`, `wind_speed_of_gust`, `fog_area_fraction`) drop off past about +60 hours, so every field must be read defensively (conditional spread). The "observation" is the model nowcast (first timeseries entry), not a station reading; this matches Open-Meteo, whose observation is also model output, so no special flagging is needed. Coordinates use at most 4 decimals (the existing `buildUrl` already does `toFixed(4)`), and the identifying contact User-Agent is already in place. Full `Expires` and `If-Modified-Since` conditional polling stays a deferred politeness item; phase 2 adds a short in-memory document memo so the three v2 methods do not refetch the identical document.
- Daily derivation (Met.no has no native daily block): group the canonical non-overlapping 6-hour windows (UTC hours 00, 06, 12, and 18, each carrying `next_6_hours.details`) by UTC calendar day. Per day: `maxTemperature` is the max of the windows' `air_temperature_max`, `minTemperature` is the min of their `air_temperature_min`, `precipitationVolume` is the summed `precipitation_amount`, and the description comes from the 12:00 UTC window's `symbol_code` (falling back to the earliest window of the day). UTC day boundaries match Open-Meteo's `timezone=GMT` daily boundaries, so the two providers are consistent and no timezone source is needed. Filtering to the 00/06/12/18 grid keeps the precipitation sum non-overlapping (near-term hourly entries also carry an overlapping `next_6_hours`, which would double-count if summed). Daily wind is omitted: Met.no provides no daily wind aggregate, and approximating one from instant samples would mislead.
- Reuse, do not re-derive: use the hoisted `conversions.ts` helpers (`optionalCelsiusToKelvin`, `optionalPercentageToRatio`, `millibarsToPA`, `asOptionalNumber`, `calculateAbsoluteHumidity`), the shared `buildWindFromMs` and the new `buildSkOutsideSI` from `skV2Envelope.ts`, and the phase-1 `MET_NO_DESCRIPTIONS` (exported from `MetNoMapper.ts`) plus `metNoSymbolBase` (exported from `met-no-severity.ts`). Do not add a second copy of the wind-block, the outside-block, or the symbol-to-description idioms.
- Text rule for all comments, commit messages, and docs: no em dashes (use a colon, a comma, or two sentences), use the Oxford comma, write the word "and" never "&", and never mention any AI or review process.
- Gate after every task: `npm run validate` (type-check including the panel, Biome, full Vitest). The suite is at 483 tests; only add tests, never reduce the count.
- Commit types: `refactor:` for the shared-helper hoist (Task 1), `feat:` for the Met.no v2 capability (Tasks 2 and 3), `test:` for the registration proof (Task 4).

Note on phase boundary: phase 2 does NOT change `index.ts`, `WeatherProviderAdapter`, the panel, or the schema. The registration gate at `index.ts` already registers any forecast-capable provider, so making `MetNoService` satisfy `ForecastCapableProvider` is the whole integration. Confirm the diff leaves those files untouched.

---

### Task 1: Hoist the SK-v2 outside-block builder and rename the helper module

The SK-v2 `outside` assembly (the conditional spreads plus the `absoluteHumidity` derivation) appears twice in `OpenMeteoForecastMapper.ts` (the hourly mapper and the observation mapper) and is about to appear again in the Met.no mapper. Hoist it into one shared `buildSkOutsideSI`, and rename the misnamed `skV2WindHelper.ts` (it already exports the `SKOutside`/`SKWind`/`SKSun` aliases and will now hold the outside builder too) to `skV2Envelope.ts`. This task is behavior-preserving: the existing Open-Meteo forecast-mapper tests must pass UNCHANGED.

**Files:**
- Rename: `src/mappers/skV2WindHelper.ts` to `src/mappers/skV2Envelope.ts` (and add the builder)
- Rename: `src/__tests__/mappers/skV2WindHelper.test.ts` to `src/__tests__/mappers/skV2Envelope.test.ts` (update its import path)
- Modify: `src/mappers/WeatherProviderMapper.ts` (import path only)
- Modify: `src/mappers/OpenMeteoForecastMapper.ts` (import path, plus delegate the two `outside` assemblies to the helper)

**Interfaces:**
- Produces: `buildSkOutsideSI(values: SkOutsideInputs): SKOutside` in `skV2Envelope.ts`, where `SkOutsideInputs` is an all-optional, all-SI input record. It conditionally spreads each present field and derives `absoluteHumidity` when both `temperatureK` and `rhRatio` are present, exactly reproducing the current Open-Meteo assembly. `buildWindFromMs` and the `SKOutside`/`SKWind`/`SKSun` aliases keep their current signatures, only the module filename changes.

- [ ] **Step 1: Rename the module and its test, fix import paths**

```bash
git mv src/mappers/skV2WindHelper.ts src/mappers/skV2Envelope.ts
git mv src/__tests__/mappers/skV2WindHelper.test.ts src/__tests__/mappers/skV2Envelope.test.ts
```

In `skV2Envelope.test.ts`, update the import to `'../../mappers/skV2Envelope.js'`. In `WeatherProviderMapper.ts` and `OpenMeteoForecastMapper.ts`, update the `from './skV2WindHelper.js'` specifier to `'./skV2Envelope.js'`. Update the module's top doc comment so it describes the SK v2 envelope helpers (wind block and outside block), not only the wind block.

- [ ] **Step 2: Write the failing test for the new builder**

Append to `skV2Envelope.test.ts`:

```ts
import { buildSkOutsideSI } from '../../mappers/skV2Envelope.js';

describe('buildSkOutsideSI', () => {
  it('spreads present SI fields and derives absoluteHumidity from temperature and humidity', () => {
    const out = buildSkOutsideSI({ temperatureK: 293.15, rhRatio: 0.5, pressurePa: 101300, cloudCover: 0.25 });
    expect(out.temperature).toBeCloseTo(293.15, 5);
    expect(out.relativeHumidity).toBeCloseTo(0.5, 5);
    expect(out.pressure).toBeCloseTo(101300, 0);
    expect(out.cloudCover).toBeCloseTo(0.25, 5);
    expect(typeof out.absoluteHumidity).toBe('number');
  });
  it('omits absent fields and omits absoluteHumidity when temperature is missing', () => {
    const out = buildSkOutsideSI({ rhRatio: 0.5 });
    expect(out.relativeHumidity).toBeCloseTo(0.5, 5);
    expect(out.absoluteHumidity).toBeUndefined();
    expect(out.temperature).toBeUndefined();
    expect(Object.keys(out)).toEqual(['relativeHumidity']);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/mappers/skV2Envelope.test.ts`
Expected: FAIL, `buildSkOutsideSI` is not exported.

- [ ] **Step 4: Add `buildSkOutsideSI` to `skV2Envelope.ts`**

Add the import of `calculateAbsoluteHumidity` to the conversions import, then:

```ts
/** All-optional, all-SI inputs for the shared SK v2 `outside` block. */
export interface SkOutsideInputs {
  readonly temperatureK?: number;
  readonly dewPointK?: number;
  readonly feelsLikeK?: number;
  readonly pressurePa?: number;
  readonly rhRatio?: number;
  readonly visibilityM?: number;
  readonly cloudCover?: number;
  readonly uvIndex?: number;
  readonly precipitationVolumeM?: number;
}

/**
 * Build the SK v2 `outside` block from SI values, omitting absent fields and
 * deriving `absoluteHumidity` when both temperature and relative humidity are
 * present. Callers do their own provider-specific unit conversion and hand SI
 * values here, so the assembly and the humidity derivation live in one place.
 */
export function buildSkOutsideSI(v: SkOutsideInputs): SKOutside {
  return {
    ...(v.temperatureK !== undefined && { temperature: v.temperatureK }),
    ...(v.dewPointK !== undefined && { dewPointTemperature: v.dewPointK }),
    ...(v.feelsLikeK !== undefined && { feelsLikeTemperature: v.feelsLikeK }),
    ...(v.rhRatio !== undefined && {
      relativeHumidity: v.rhRatio,
      ...(v.temperatureK !== undefined && {
        absoluteHumidity: calculateAbsoluteHumidity(v.temperatureK, v.rhRatio),
      }),
    }),
    ...(v.pressurePa !== undefined && { pressure: v.pressurePa }),
    ...(v.visibilityM !== undefined && { horizontalVisibility: v.visibilityM }),
    ...(v.cloudCover !== undefined && { cloudCover: v.cloudCover }),
    ...(v.uvIndex !== undefined && { uvIndex: v.uvIndex }),
    ...(v.precipitationVolumeM !== undefined && { precipitationVolume: v.precipitationVolumeM }),
  };
}
```

- [ ] **Step 5: Delegate the two Open-Meteo `outside` assemblies to the helper**

In `OpenMeteoForecastMapper.ts`, in BOTH `mapOpenMeteoHourlyToForecasts` and `mapOpenMeteoCurrentToObservation`, replace the inline `const outside: SKOutside = { ... }` with a `buildSkOutsideSI(...)` call. Compute the precipitation volume (and, for the observation, the pressure) as locals first, so every value handed to the builder is already SI:

Hourly (replaces lines 52 to 68):
```ts
const precipitationVolumeM =
  precipitationMm !== undefined ? precipitationMm * UNITS.PRECIPITATION.MM_TO_M : undefined;
const outside = buildSkOutsideSI({
  temperatureK,
  dewPointK,
  feelsLikeK,
  rhRatio,
  visibilityM,
  cloudCover,
  uvIndex,
  precipitationVolumeM,
});
```

Observation (replaces lines 158 to 175): same as hourly plus the pressure local:
```ts
const pressurePa = pressureMbar !== undefined ? millibarsToPA(pressureMbar) : undefined;
const precipitationVolumeM =
  precipitationMm !== undefined ? precipitationMm * UNITS.PRECIPITATION.MM_TO_M : undefined;
const outside = buildSkOutsideSI({
  temperatureK,
  dewPointK,
  feelsLikeK,
  rhRatio,
  pressurePa,
  visibilityM,
  cloudCover,
  uvIndex,
  precipitationVolumeM,
});
```

Update the import from `skV2Envelope.js` to add `buildSkOutsideSI` (alongside `buildWindFromMs`, `type SKOutside`, `type SKSun`). After delegating, `calculateAbsoluteHumidity` is no longer used directly in `OpenMeteoForecastMapper.ts` (the helper owns it now), so REMOVE it from the conversions import or Biome `noUnusedVariables: error` fails the gate. `millibarsToPA`, `UNITS`, and the `SKOutside`/`SKSun` aliases are still used (the daily mapper builds its own `outside: SKOutside` inline, unchanged), so keep them.

The daily mapper (`mapOpenMeteoDailyToForecasts`) is NOT changed: its `outside` carries `minTemperature`/`maxTemperature`, a different field set from the point/observation block, so it stays inline.

- [ ] **Step 6: Run the gate**

Run: `npm run validate`
Expected: green. The existing `OpenMeteoForecastMapper.test.ts` passes UNCHANGED (the hourly and observation outputs are byte-identical, just routed through the shared builder), plus the two new `buildSkOutsideSI` tests.

- [ ] **Step 7: Commit**

```bash
git add src/mappers/skV2Envelope.ts src/__tests__/mappers/skV2Envelope.test.ts src/mappers/WeatherProviderMapper.ts src/mappers/OpenMeteoForecastMapper.ts
git commit -m "refactor: hoist the SK v2 outside-block builder into a shared envelope helper"
```

---

### Task 2: Create the Met.no v2 forecast mapper

**Files:**
- Create: `src/mappers/MetNoForecastMapper.ts`
- Test: `src/__tests__/mappers/MetNoForecastMapper.test.ts` (create)

**Interfaces:**
- Consumes: `MetNoLocationforecastResponse`, `MetNoTimeseriesEntry` (types); `buildWindFromMs`, `buildSkOutsideSI`, `SKOutside` from `./skV2Envelope.js` (Task 1); `MET_NO_DESCRIPTIONS` from `./MetNoMapper.js`; `metNoSymbolBase` from `../providers/met-no-severity.js`; the `conversions.ts` helpers (`optionalCelsiusToKelvin`, `optionalPercentageToRatio`, `millibarsToPA`, `asOptionalNumber`); and `UNITS` from `../constants/index.js`.
- Produces three pure functions returning the SK v2 envelope (`WeatherData` from `@signalk/server-api`, aliased `SKWeatherData`):
  - `mapMetNoToObservation(response: MetNoLocationforecastResponse): SKWeatherData` (`type: 'observation'`, the first timeseries entry, with pressure)
  - `mapMetNoToHourlyForecasts(response: MetNoLocationforecastResponse): SKWeatherData[]` (`type: 'point'`, ascending, the entries that carry `next_1_hours`)
  - `mapMetNoToDailyForecasts(response: MetNoLocationforecastResponse): SKWeatherData[]` (`type: 'daily'`, ascending, min/max per UTC day)

The Met.no shape is a TIMESERIES OF OBJECTS (not Open-Meteo's columnar arrays), so iteration is per-entry, reading `entry.data.instant.details` and `entry.data.next_1_hours` / `next_6_hours`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/mappers/MetNoForecastMapper.test.ts
import { describe, expect, it } from 'vitest';
import {
  mapMetNoToDailyForecasts,
  mapMetNoToHourlyForecasts,
  mapMetNoToObservation,
} from '../../mappers/MetNoForecastMapper.js';
import type { MetNoLocationforecastResponse } from '../../types/index.js';

function entry(time: string, temp: number, opts: Record<string, unknown> = {}) {
  return {
    time,
    data: {
      instant: {
        details: {
          air_temperature: temp,
          air_pressure_at_sea_level: 1013,
          relative_humidity: 50,
          dew_point_temperature: 10,
          wind_speed: 5,
          wind_from_direction: 90,
          cloud_area_fraction: 25,
          ...opts,
        },
      },
      next_1_hours: { summary: { symbol_code: 'cloudy' }, details: { precipitation_amount: 0.4 } },
    },
  };
}

const HOURLY: MetNoLocationforecastResponse = {
  properties: { timeseries: [entry('2026-06-22T12:00:00Z', 20), entry('2026-06-22T13:00:00Z', 19)] },
};

describe('MetNoForecastMapper', () => {
  it('maps next_1_hours entries to ascending SI point forecasts', () => {
    const out = mapMetNoToHourlyForecasts(HOURLY);
    expect(out).toHaveLength(2);
    expect(out[0]?.type).toBe('point');
    expect(out[0]?.date).toBe('2026-06-22T12:00:00Z');
    expect(out[0]?.outside?.temperature).toBeCloseTo(293.15, 2);
    expect(out[0]?.outside?.relativeHumidity).toBeCloseTo(0.5, 5);
    expect(out[0]?.outside?.pressure).toBeCloseTo(101300, 0);
    expect(out[0]?.outside?.precipitationVolume).toBeCloseTo(0.0004, 7); // 0.4 mm to m
    expect(out[0]?.outside?.horizontalVisibility).toBeUndefined(); // Met.no has none
    expect(out[0]?.wind?.speedTrue).toBeCloseTo(5, 5);
    expect(out[0]?.wind?.directionTrue).toBeCloseTo(Math.PI / 2, 5);
    expect(out[1]?.date).toBe('2026-06-22T13:00:00Z');
  });
  it('maps the first entry to a single observation', () => {
    const obs = mapMetNoToObservation(HOURLY);
    expect(obs.type).toBe('observation');
    expect(obs.date).toBe('2026-06-22T12:00:00Z');
    expect(obs.outside?.temperature).toBeCloseTo(293.15, 2);
  });
  it('derives per-UTC-day min and max temperature from the 6-hour windows', () => {
    const six = (time: string, max: number, min: number, precip: number) => ({
      time,
      data: {
        instant: { details: { air_temperature: (max + min) / 2 } },
        next_6_hours: {
          summary: { symbol_code: 'rain' },
          details: { air_temperature_max: max, air_temperature_min: min, precipitation_amount: precip },
        },
      },
    });
    const out = mapMetNoToDailyForecasts({
      properties: {
        timeseries: [
          six('2026-06-23T00:00:00Z', 14, 8, 1),
          six('2026-06-23T06:00:00Z', 20, 12, 0),
          six('2026-06-23T12:00:00Z', 24, 15, 2),
          six('2026-06-23T18:00:00Z', 18, 11, 0),
          six('2026-06-23T03:00:00Z', 99, -99, 99), // off-grid hour, must be ignored
        ],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('daily');
    expect(out[0]?.date).toBe('2026-06-23');
    expect(out[0]?.outside?.maxTemperature).toBeCloseTo(297.15, 2); // 24 C, the off-grid 99 ignored
    expect(out[0]?.outside?.minTemperature).toBeCloseTo(281.15, 2); // 8 C, the off-grid -99 ignored
    expect(out[0]?.outside?.precipitationVolume).toBeCloseTo(0.003, 6); // (1+0+2+0) mm to m, off-grid excluded
    expect(out[0]?.description).toBe('Rain'); // from the 12:00 window symbol
  });
});
```

(The `Rain` expectation assumes `MET_NO_DESCRIPTIONS` maps `'rain'` to `'Rain'`; confirm the exact phase-1 string and match it.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/mappers/MetNoForecastMapper.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `MetNoForecastMapper.ts`**

Model the file's per-entry assembly on `OpenMeteoForecastMapper`, but iterate per timeseries entry. Factor a private `mapEntry(entry, type)` shared by the hourly mapper and the observation mapper (both build the same SK v2 block from `instant.details` plus `next_1_hours`), so the per-entry assembly is written once:

```ts
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

/** Build one SK v2 entry (point or observation) from a timeseries entry's instant block plus next_1_hours. */
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
```

`mapMetNoToHourlyForecasts` filters the timeseries to entries that carry `next_1_hours` and maps each via `mapEntry(e, 'point')`. `mapMetNoToObservation` maps the first entry via `mapEntry(first, 'observation')`, returning `{ date: '', type: 'observation', outside: {} }` when the timeseries is empty (the v2 `date` must be a string; do not throw, the v2 surface degrades gracefully).

`mapMetNoToDailyForecasts` implements the daily derivation from Global Constraints: iterate the timeseries, keep entries whose UTC hour (from `time.slice(11, 13)`) is one of `0`, `6`, `12`, or `18` AND that carry `next_6_hours.details`, group by the UTC day `time.slice(0, 10)`, and for each day fold the windows into `maxTemperature` (max of `air_temperature_max`), `minTemperature` (min of `air_temperature_min`), `precipitationVolume` (summed `precipitation_amount` times `MM_TO_M`), and a description from the 12:00 window's `next_6_hours.summary.symbol_code` (falling back to the earliest window of the day). Build the daily `outside` inline (it carries `minTemperature`/`maxTemperature`/`precipitationVolume`, the same shape as the Open-Meteo daily mapper, so it does not use `buildSkOutsideSI`). Return the days sorted ascending by date. Parse the hour and day from the ISO 8601 string with `slice` (the `time` is UTC, so string slicing is timezone-safe and avoids `new Date`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/mappers/MetNoForecastMapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the gate and commit**

Run: `npm run validate` (green). Then:

```bash
git add src/mappers/MetNoForecastMapper.ts src/__tests__/mappers/MetNoForecastMapper.test.ts
git commit -m "feat: map the Met.no timeseries to v2 observations, hourly forecasts, and daily forecasts"
```

---

### Task 3: Make MetNoService forecast-capable

**Files:**
- Modify: `src/services/MetNoService.ts`
- Test: `src/__tests__/services/MetNoService.test.ts` (extend)

**Interfaces:**
- Consumes: the Task 2 mappers; `MetNoLocationforecastResponse`; `SKWeatherData` (`import type { WeatherData as SKWeatherData } from '@signalk/server-api';`); `GeoLocation`.
- Produces on `MetNoService`: `forecastCapabilities = { hourlyHours: 48, dailyDays: 9 }`; `getObservation(loc): Promise<SKWeatherData>`; `getHourlyForecast(loc): Promise<SKWeatherData[]>` (sliced to 48 entries); `getDailyForecast(loc): Promise<SKWeatherData[]>` (sliced to 9 days). The class now structurally satisfies `ForecastCapableProvider`, so `supportsForecasts(metNoService)` is true and `index.ts` auto-registers the v2 provider with no change there. A private `fetchForecastDocument(location, context)` does the single `/complete` fetch with a short in-memory memo so the three methods do not refetch the identical document.

- [ ] **Step 1: Write the failing test**

Add to `MetNoService.test.ts` (reuse the existing fetch-mock idiom: `vi.stubGlobal('fetch', vi.fn())` and `createMockFetchResponse`). Build a timeseries sample with at least the first entry carrying `next_1_hours` and the 00/06/12/18 windows carrying `next_6_hours.details`, then:

```ts
import { supportsForecasts } from '../../providers/WeatherProvider.js';

describe('MetNoService v2 capability', () => {
  it('declares its forecast horizon and is forecast-capable', () => {
    const svc = new MetNoService(() => {});
    expect(svc.forecastCapabilities).toEqual({ hourlyHours: 48, dailyDays: 9 });
    expect(supportsForecasts(svc)).toBe(true);
  });
  it('serves the observation, hourly, and daily forecast from one memoized document', async () => {
    (global.fetch as Mock).mockResolvedValue(createMockFetchResponse(FORECAST_SAMPLE));
    const svc = new MetNoService(() => {});
    const obs = await svc.getObservation({ latitude: 60, longitude: 11 });
    const hourly = await svc.getHourlyForecast({ latitude: 60, longitude: 11 });
    const daily = await svc.getDailyForecast({ latitude: 60, longitude: 11 });
    expect(obs.type).toBe('observation');
    expect(hourly[0]?.type).toBe('point');
    expect(daily[0]?.type).toBe('daily');
    // Three v2 calls at the same position share one upstream fetch (the document memo).
    expect((global.fetch as Mock).mock.calls).toHaveLength(1);
    expect(svc.getRequestCount()).toBe(1);
  });
});
```

(The memo test runs well within the memo TTL, so no timer mocking is needed. Define `FORECAST_SAMPLE` near the top of the test file.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/services/MetNoService.test.ts -t "v2 capability"`
Expected: FAIL, `forecastCapabilities` undefined.

- [ ] **Step 3: Implement on `MetNoService`**

Add the imports (the three Task 2 mappers, `SKWeatherData`). Add the horizon constants and the memo field:

```ts
/** Declared v2 forecast horizon. Hourly steps run to about +53 h, the daily horizon to about 10 days. */
const HOURLY_FORECAST_HOURS = 48;
const DAILY_FORECAST_DAYS = 9;
/** Met.no refreshes the model on a multi-hour cadence, so a 10-minute memo avoids refetching the identical document. */
const DOCUMENT_MEMO_TTL_MS = 10 * 60 * 1000;
```

Add the capability, the three methods, and the memoized fetch:

```ts
public readonly forecastCapabilities = {
  hourlyHours: HOURLY_FORECAST_HOURS,
  dailyDays: DAILY_FORECAST_DAYS,
} as const;

private memo?: { key: string; expiresAt: number; doc: MetNoLocationforecastResponse };

public async getObservation(location: GeoLocation): Promise<SKWeatherData> {
  return mapMetNoToObservation(await this.fetchForecastDocument(location, 'Met.no observation'));
}

public async getHourlyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
  const doc = await this.fetchForecastDocument(location, 'Met.no hourly forecast');
  return mapMetNoToHourlyForecasts(doc).slice(0, HOURLY_FORECAST_HOURS);
}

public async getDailyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
  const doc = await this.fetchForecastDocument(location, 'Met.no daily forecast');
  return mapMetNoToDailyForecasts(doc).slice(0, DAILY_FORECAST_DAYS);
}

/**
 * Fetch the /complete document once and memoize it briefly. The three v2 methods
 * all derive from the same document, so a short memo keyed by rounded position
 * collapses their fetches into one upstream request, respecting the Met.no
 * caching expectation. Each real fetch increments the request count.
 */
private async fetchForecastDocument(
  location: GeoLocation,
  context: string
): Promise<MetNoLocationforecastResponse> {
  assertValidCoordinates(location, context);
  const key = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
  const now = Date.now();
  if (this.memo && this.memo.key === key && this.memo.expiresAt > now) {
    return this.memo.doc;
  }
  try {
    this.requestCount++;
    const doc = await fetchJson<MetNoLocationforecastResponse>(this.buildUrl(location), {
      timeoutMs: this.requestTimeoutMs,
      headers: { 'User-Agent': USER_AGENT },
    });
    this.memo = { key, expiresAt: now + DOCUMENT_MEMO_TTL_MS, doc };
    return doc;
  } catch (error) {
    this.logger('error', 'Failed to fetch Met.no forecast', {
      location: `${location.latitude},${location.longitude}`,
      error: toErrorMessage(error),
    });
    throw error;
  }
}
```

`fetchCurrentWeather` (the live emission path) is UNCHANGED: it keeps its own fetch and does not share the memo, so phase 1 behavior and its tests are untouched. (Unifying the emission-path fetch into the memo is a possible later optimization, out of scope here.)

- [ ] **Step 4: Run the gate**

Run: `npm run validate`
Expected: green. The new capability, forecast, and memo tests pass, and `fetchCurrentWeather` is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/services/MetNoService.ts src/__tests__/services/MetNoService.test.ts
git commit -m "feat: make Met.no serve v2 observations and forecasts"
```

---

### Task 4: Verify a Met.no install registers the v2 provider

**Files:**
- Test: `src/__tests__/index.test.ts` (extend)

**Interfaces:**
- Consumes: the now forecast-capable `MetNoService`; the unchanged `index.ts` registration path.

This task adds NO production code: it proves the seam delivers the feature. With Met.no now forecast-capable, starting the plugin with `weatherProvider: 'met-no'` should call `app.registerWeatherProvider` and report `weatherProviderRegistered: true` from `/api/status`, exactly as the Open-Meteo registration test does.

- [ ] **Step 1: Write the test**

Model it on the existing Open-Meteo registration test (added in Plan 2, "registers the v2 weather provider on a default Open-Meteo install"). Find that test in `index.test.ts`, copy its setup, and change the configured provider to `weatherProvider: 'met-no'`. It mocks `WeatherService` at the module level (so no real fetch fires), gives the mock app `registerWeatherProvider: vi.fn()` and `weatherApi: { unRegister: vi.fn() }`, starts the plugin, and asserts `registerWeatherProvider` was invoked and `GET /api/status` returns `weatherProviderRegistered: true`. The registration gate runs against the REAL `MetNoService` instance constructed in `startServices`, so after Task 3 it passes the `supportsForecasts` gate.

```ts
it('registers the v2 weather provider on a Met.no install', async () => {
  // Same setup as the Open-Meteo registration test, with weatherProvider 'met-no'.
  // Assert registerWeatherProvider was invoked and the status flag is true.
});
```

- [ ] **Step 2: Run the gate**

Run: `npm run validate`
Expected: green; the new test passes, confirming a Met.no install advertises a weather provider.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/index.test.ts
git commit -m "test: cover v2 provider registration on a Met.no install"
```

---

## Self-Review

Run after all tasks:

- [ ] `npm run validate` green: type-check (including panel), Biome, full Vitest (>= 483 plus the new builder, mapper, service, and registration tests).
- [ ] `MetNoService` structurally satisfies `ForecastCapableProvider`: `supportsForecasts(new MetNoService())` is true, with `forecastCapabilities = { hourlyHours: 48, dailyDays: 9 }`.
- [ ] No `index.ts`, `WeatherProviderAdapter`, panel, or schema change was needed (the registration gate did the work); confirm the diff does not touch them.
- [ ] The Met.no v2 mappers reuse `buildWindFromMs`, `buildSkOutsideSI`, `MET_NO_DESCRIPTIONS`, and `metNoSymbolBase`; there is no second copy of the wind-block, outside-block, or symbol-to-description idioms, and the per-entry assembly is shared by the hourly and observation paths via `mapEntry`.
- [ ] The mappers do NOT km/h-convert wind (Met.no is m/s) and emit no visibility (Met.no provides none); precipitation is converted mm to meters for the v2 `precipitationVolume`.
- [ ] Forecasts are ascending; the observation is a single value; daily min/max comes from the non-overlapping 00/06/12/18 UTC windows so the precipitation sum does not double-count.
- [ ] The three v2 methods share one upstream `/complete` fetch via the document memo; `fetchCurrentWeather` (the live emission path) is unchanged.
- [ ] The Open-Meteo refactor (Task 1) is behavior-preserving: the existing `OpenMeteoForecastMapper.test.ts` passes unmodified.

## Hand-off

After this plan, selecting Met.no advertises a weather provider (non-empty `/signalk/v2/api/weather/_providers`) serving observations, hourly point forecasts (48 h), and daily forecasts (9 d, derived from the 6-hour windows), with warnings still served by the already-wired `WarningsService` (NWS for US waters). The panel "Weather API" card shows On under Met.no. Phase 3 extends `WarningsService` region dispatch to Met.no MetAlerts for Nordic and European waters (the dedicated Met.no warnings product). Deferred politeness items: full `Expires` and `If-Modified-Since` conditional polling, and unifying the emission-path fetch into the document memo. The remaining feature work is then Plan 3, the synthesis merge engine, which now has three independent models to blend.
