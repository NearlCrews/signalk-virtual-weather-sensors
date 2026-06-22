# Synthesis Merge Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the merge mode that the `weatherMode = 'merged'` config field already advertises: fetch every available provider (Open-Meteo, Met.no, and AccuWeather when keyed) concurrently and blend their overlapping current-conditions fields into synthetic values on a dedicated `merged` `$source`, with hazard-bearing fields escalating to the most conservative value across providers.

**Architecture:** This is the capstone of the multi-provider design (the seam, the catalog, the three-tier provider interfaces, the `weatherMode` config field, and Open-Meteo and Met.no v2 forecasts already exist). Today `weatherMode` is wired through config, validation, and the panel but nothing consumes it, so a merged install behaves as single Open-Meteo. This plan adds: a pure `mergeWeatherData` engine with an explicit `FIELD_MERGE_KINDS` policy table, a `MergingWeatherProvider` that fetches children concurrently and blends survivors, and a `weatherMode`-aware construction seam at `index.ts:203`. The derived-field recompute (windChill, heatIndex, Beaufort, absolute humidity, and air density), currently duplicated byte-for-byte in `OpenMeteoMapper` and `MetNoMapper`, is hoisted first so the merge recomputes from the merged base through the same shared helper rather than adding a third copy. The merging provider delegates forecasts and observations to the highest-priority forecast-capable child (Open-Meteo is always available and forecast-capable, so one always exists), keeping a forecast internally coherent (one model) while the live emission path blends.

**Tech Stack:** TypeScript (strict, ES2023), ESM (NodeNext), Vitest, Biome, `@signalk/server-api` (peer, types only).

## Global Constraints

- ESM NodeNext: import sibling modules with the `.js` specifier even from `.ts` source.
- Node floor 20.18; `@signalk/server-api` is a types-only peer dependency.
- Internal `WeatherData` is SI: m/s, radians in [0, 2π), Kelvin, Pa, ratio 0..1. Averaging is only valid because every provider is SI, mean-sea-level pressure, and ground-referenced true-north wind, with sustained wind and gust kept distinct. The plugin emits `speedOverGround` only, never `speedTrue`. The merge only ever sees atmospheric `WeatherData`; the marine layer (`open-meteo-marine`) is never merged.
- The three apparent-wind fields (`apparentWindSpeed`, `apparentWindAngle`, `apparentWindChill`) are added downstream in `WeatherService.enhanceWeatherData` from the merged base plus the single vessel nav, so the merge engine MUST exclude them from its output.
- `exactOptionalPropertyTypes` is on: an all-optional input record field is typed `?: T | undefined`, and an absent optional output field is omitted (conditional spread), never set to `undefined`.
- Reuse, do not re-derive: the merge recomputes derived fields through the same hoisted helper the mappers use and the same `conversions.ts` helpers; it does not re-derive a formula or copy a recompute block.
- Text rule for all comments, commit messages, and docs: no em dashes (use a colon, a comma, or two sentences), use the Oxford comma, write the word "and" never "&", and never mention any AI or review process.
- Gate after every task: `npm run validate` (type-check including the panel, Biome, full Vitest). The suite is at 501 tests; only add tests, never reduce the count.
- Commit types: `refactor:` for the hoist (Task 1), `feat:` for the engine, the provider, and the wiring (Tasks 2 to 4), `feat:`/`docs:`/`test:` for Task 5 per its parts.

## Field merge policy (the contract Task 2 implements)

Every `WeatherData` field has exactly one declared merge kind. `dataList` is the survivors in priority order (the primary, the operator's `weatherProvider`, is first); "priority first-present" means the first list element that supplies the field.

| Field(s) | Kind | Rule |
|---|---|---|
| temperature, pressure, humidity, windSpeed, dewPoint, realFeel, realFeelShade, wetBulbTemperature, apparentTemperature, uvIndex, cloudCover, cloudCeiling, temperatureDeparture24h | `mean` | arithmetic mean of present values |
| windDirection | `circular` | speed-weighted circular mean: `atan2(Σ speed_i·sin(dir_i), Σ speed_i·cos(dir_i))`, normalized to [0, 2π); when the resultant magnitude is below epsilon (1e-9), fall back to the priority first-present direction |
| severeCondition | `hazard-max` | the present condition with the highest state on the ladder normal < alert < warn < alarm < emergency; tie-break by priority; omit when none present |
| precipitationLastHour, windGustSpeed | `hazard-max` | the highest present value |
| visibility | `hazard-min` | the lowest present value |
| pressureTendency | `conservative-tendency` | if any present tendency is -1 (falling), use -1; else the priority first-present value |
| wetBulbGlobeTemperature | `priority-present` | NOT averaged (a measured globe temperature and a shade estimate are different quantities); the priority first-present value. (Set AccuWeather as the primary to prefer its measured value. A `measured` flag for true prefer-measured is a noted future enhancement, deliberately not added now to avoid a `WeatherData` type change and three mapper edits.) |
| description, weatherIcon, precipitationType, visibilityObstruction | `categorical` | priority first-present |
| timestamp | `primary` | the primary's (`dataList[0].timestamp`) |
| windChill, heatIndex, beaufortScale, absoluteHumidity, airDensityEnhanced | `derived` | recompute from the merged base through `deriveBaseWeatherFields` (Task 1) |
| heatStressIndex | `derived` | recompute via `calculateHeatStressIndex` from the merged `wetBulbGlobeTemperature` selected above; omit when that is absent |
| windGustFactor | `derived` | recompute from the merged gust and sustained: `max(1, gust / sustained)` when both present and sustained > 0; omit otherwise |
| apparentWindSpeed, apparentWindAngle, apparentWindChill | `excluded` | omitted (added downstream in `WeatherService.enhanceWeatherData`) |

`FIELD_MERGE_KINDS` is a `Readonly<Record<keyof WeatherData, MergeKind>>` exported for documentation and a coverage test (a test asserts every `WeatherData` key has a declared kind, so a future field cannot be added without a merge decision).

---

### Task 1: Hoist the derived-from-base recompute into a shared helper

The block that recomputes windChill, heatIndex, beaufortScale, absoluteHumidity, and airDensityEnhanced from the base fields is byte-identical in `OpenMeteoMapper.ts` (lines 147 to 157) and `MetNoMapper.ts` (lines 177 to 187). The merge engine (Task 2) needs the same recompute from the merged base, which would be a third copy, so hoist it now into one shared helper. Behavior-preserving: the existing mapper tests must pass UNMODIFIED.

**Files:**
- Create: `src/calculators/deriveWeatherFields.ts`
- Test: `src/__tests__/calculators/deriveWeatherFields.test.ts` (create)
- Modify: `src/mappers/OpenMeteoMapper.ts`, `src/mappers/MetNoMapper.ts`

**Interfaces:**
- Produces: `deriveBaseWeatherFields(temperatureK: number, pressurePa: number, humidity: number, windSpeedMs: number): DerivedBaseFields`, where `DerivedBaseFields` is `{ windChill, heatIndex, beaufortScale, absoluteHumidity, airDensityEnhanced }` (all `number`). It owns a module-level `WindCalculator` instance (the two mappers each construct their own today; after the hoist that instance moves here). It does NOT estimate WBGT or compute heatStressIndex (those have a per-caller source: the mappers estimate, the merge selects).

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/calculators/deriveWeatherFields.test.ts
import { describe, expect, it } from 'vitest';
import { deriveBaseWeatherFields } from '../../calculators/deriveWeatherFields.js';

describe('deriveBaseWeatherFields', () => {
  it('recomputes the five base-derived fields from temperature, pressure, humidity, and wind', () => {
    const d = deriveBaseWeatherFields(293.15, 101300, 0.5, 5);
    expect(typeof d.windChill).toBe('number');
    expect(typeof d.heatIndex).toBe('number');
    expect(typeof d.beaufortScale).toBe('number');
    expect(typeof d.absoluteHumidity).toBe('number');
    expect(typeof d.airDensityEnhanced).toBe('number');
    // Air density near 1.2 kg/m3 at sea level, mild temperature.
    expect(d.airDensityEnhanced).toBeGreaterThan(1.0);
    expect(d.airDensityEnhanced).toBeLessThan(1.4);
    // Beaufort 3 at 5 m/s.
    expect(d.beaufortScale).toBe(3);
  });
});
```

(Confirm the exact `beaufortScale` for 5 m/s against `calculateBeaufortScale`; adjust the literal if the scale boundary differs.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/calculators/deriveWeatherFields.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `deriveWeatherFields.ts`**

```ts
/**
 * Shared recompute of the WeatherData fields that are pure functions of the base
 * measurements (temperature, pressure, humidity, and sustained wind). The two
 * provider mappers and the merge engine all derive these the same way, so the
 * assembly lives here once. WBGT and heatStressIndex are NOT here: their source
 * differs by caller (a mapper estimates WBGT, the merge selects it), so each
 * caller computes those with the shared conversions helpers directly.
 */
import { WindCalculator } from './WindCalculator.js';
import {
  calculateAbsoluteHumidity,
  calculateAirDensity,
  calculateBeaufortScale,
} from '../utils/conversions.js';

const sharedWindCalculator = new WindCalculator();

export interface DerivedBaseFields {
  readonly windChill: number;
  readonly heatIndex: number;
  readonly beaufortScale: number;
  readonly absoluteHumidity: number;
  readonly airDensityEnhanced: number;
}

/** Recompute the base-derived fields from the SI base measurements. */
export function deriveBaseWeatherFields(
  temperatureK: number,
  pressurePa: number,
  humidity: number,
  windSpeedMs: number
): DerivedBaseFields {
  return {
    windChill: sharedWindCalculator.calculateWindChill(temperatureK, windSpeedMs),
    heatIndex: sharedWindCalculator.calculateHeatIndex(temperatureK, humidity),
    beaufortScale: calculateBeaufortScale(windSpeedMs),
    absoluteHumidity: calculateAbsoluteHumidity(temperatureK, humidity),
    airDensityEnhanced: calculateAirDensity(temperatureK, pressurePa, humidity),
  };
}
```

- [ ] **Step 4: Refactor both mappers to use it**

In `OpenMeteoMapper.ts` and `MetNoMapper.ts`, replace the five lines that compute windChill, heatIndex, beaufortScale, absoluteHumidity, and airDensityEnhanced with:

```ts
const { windChill, heatIndex, beaufortScale, absoluteHumidity, airDensityEnhanced } =
  deriveBaseWeatherFields(temperature, pressure, humidity, windSpeed);
```

Keep the two WBGT lines unchanged (`const wetBulbGlobeTemperature = estimateWetBulbGlobeTemperature(temperature, humidity); const heatStressIndex = calculateHeatStressIndex(wetBulbGlobeTemperature);`). Add the import of `deriveBaseWeatherFields` from `../calculators/deriveWeatherFields.js`. The module-level `const sharedWindCalculator = new WindCalculator();` in each mapper is now unused (its only users were windChill and heatIndex), so REMOVE it and remove the `WindCalculator` import if nothing else in that mapper uses it (Biome `noUnusedVariables: error`). Drop `calculateBeaufortScale`, `calculateAbsoluteHumidity`, and `calculateAirDensity` from each mapper's conversions import if they are no longer used directly (the helper owns them now); KEEP `estimateWetBulbGlobeTemperature` and `calculateHeatStressIndex` (the WBGT lines still use them). Verify each mapper's remaining imports against `noUnusedVariables`.

- [ ] **Step 5: Run the gate**

Run: `npm run validate`
Expected: green. The existing `OpenMeteoMapper.test.ts` and `MetNoMapper.test.ts` pass UNMODIFIED (the per-field outputs are identical), plus the new helper test.

- [ ] **Step 6: Commit**

```bash
git add src/calculators/deriveWeatherFields.ts src/__tests__/calculators/deriveWeatherFields.test.ts src/mappers/OpenMeteoMapper.ts src/mappers/MetNoMapper.ts
git commit -m "refactor: hoist the base-derived weather recompute into a shared helper"
```

---

### Task 2: The pure merge engine and the field policy table

**Files:**
- Create: `src/providers/mergeWeatherData.ts`
- Test: `src/__tests__/providers/mergeWeatherData.test.ts` (create)

**Interfaces:**
- Consumes: `WeatherData`, `SevereCondition`, `NotificationState` (types); `deriveBaseWeatherFields` (Task 1); `calculateHeatStressIndex`, `normalizeAngle0To2Pi` (conversions).
- Produces: `mergeWeatherData(dataList: ReadonlyArray<WeatherData>): WeatherData` (pure, no I/O; `dataList` is priority-ordered, primary first, length >= 1) and `FIELD_MERGE_KINDS: Readonly<Record<keyof WeatherData, MergeKind>>` plus the `MergeKind` union.

- [ ] **Step 1: Write the failing tests**

Cover the full policy (the spec's test list). Minimum cases:

```ts
// src/__tests__/providers/mergeWeatherData.test.ts
import { describe, expect, it } from 'vitest';
import { FIELD_MERGE_KINDS, mergeWeatherData } from '../../providers/mergeWeatherData.js';
import type { WeatherData } from '../../types/index.js';

const base = (over: Partial<WeatherData>): WeatherData => ({
  temperature: 290,
  pressure: 101000,
  humidity: 0.5,
  windSpeed: 5,
  windDirection: 0,
  dewPoint: 283,
  windChill: 290,
  heatIndex: 290,
  timestamp: '2026-06-22T12:00:00Z',
  ...over,
});

describe('mergeWeatherData', () => {
  it('takes the scalar mean of present values', () => {
    const m = mergeWeatherData([base({ temperature: 290 }), base({ temperature: 300 })]);
    expect(m.temperature).toBeCloseTo(295, 5);
  });
  it('uses a speed-weighted circular mean for wind direction across the 0 wrap', () => {
    const m = mergeWeatherData([
      base({ windDirection: (350 * Math.PI) / 180, windSpeed: 5 }),
      base({ windDirection: (10 * Math.PI) / 180, windSpeed: 5 }),
    ]);
    // 350 and 10 degrees average to 0, not 180.
    expect(m.windDirection).toBeCloseTo(0, 4);
  });
  it('falls back to the priority direction when the resultant is near zero (opposing winds)', () => {
    const m = mergeWeatherData([
      base({ windDirection: 0, windSpeed: 5 }),
      base({ windDirection: Math.PI, windSpeed: 5 }),
    ]);
    expect(m.windDirection).toBeCloseTo(0, 6); // priority first-present
  });
  it('escalates severeCondition to the highest state (hazard-max)', () => {
    const m = mergeWeatherData([
      base({ severeCondition: { state: 'warn', label: 'Snow' } }),
      base({ severeCondition: { state: 'alarm', label: 'Thunderstorms' } }),
    ]);
    expect(m.severeCondition).toEqual({ state: 'alarm', label: 'Thunderstorms' });
  });
  it('takes hazard-max precipitation and gust, and hazard-min visibility', () => {
    const m = mergeWeatherData([
      base({ precipitationLastHour: 0, windGustSpeed: 10, visibility: 8000 }),
      base({ precipitationLastHour: 3, windGustSpeed: 20, visibility: 2000 }),
    ]);
    expect(m.precipitationLastHour).toBe(3);
    expect(m.windGustSpeed).toBe(20);
    expect(m.visibility).toBe(2000);
  });
  it('prefers a falling pressure tendency (conservative), and does not average tendencies', () => {
    expect(mergeWeatherData([base({ pressureTendency: 1 }), base({ pressureTendency: -1 })]).pressureTendency).toBe(-1);
    expect(mergeWeatherData([base({ pressureTendency: 1 }), base({ pressureTendency: 0 })]).pressureTendency).toBe(1); // priority first-present
  });
  it('takes WBGT and categorical fields from priority first-present, not averaged', () => {
    const m = mergeWeatherData([
      base({ wetBulbGlobeTemperature: 305, description: 'Clear', precipitationType: 'Rain' }),
      base({ wetBulbGlobeTemperature: 310, description: 'Cloudy' }),
    ]);
    expect(m.wetBulbGlobeTemperature).toBe(305); // primary, not the mean 307.5
    expect(m.description).toBe('Clear');
    expect(m.precipitationType).toBe('Rain');
  });
  it('recomputes derived fields from the merged base, never averaging them', () => {
    const m = mergeWeatherData([
      base({ temperature: 290, windSpeed: 5, windChill: 999, beaufortScale: 0 }),
      base({ temperature: 300, windSpeed: 15, windChill: 999, beaufortScale: 0 }),
    ]);
    // windChill and beaufort are recomputed from the merged base (temp 295, wind 10), not the bogus 999/0.
    expect(m.windChill).not.toBe(999);
    expect(m.beaufortScale).toBeGreaterThan(0);
  });
  it('recomputes the gust factor with a >= 1 guard and from the merged gust and sustained', () => {
    const m = mergeWeatherData([base({ windSpeed: 5, windGustSpeed: 5 }), base({ windSpeed: 5, windGustSpeed: 5 })]);
    expect(m.windGustFactor).toBe(1); // gust equals sustained, guarded to 1
  });
  it('excludes the apparent-wind fields from its output', () => {
    const m = mergeWeatherData([base({}), base({})]);
    expect(m.apparentWindSpeed).toBeUndefined();
    expect(m.apparentWindAngle).toBeUndefined();
    expect(m.apparentWindChill).toBeUndefined();
  });
  it('takes the timestamp from the primary', () => {
    const m = mergeWeatherData([base({ timestamp: 'A' }), base({ timestamp: 'B' })]);
    expect(m.timestamp).toBe('A');
  });
  it('declares a merge kind for every WeatherData field', () => {
    // A representative sample of keys must be present; the real assertion checks the full set.
    for (const key of ['temperature', 'windDirection', 'severeCondition', 'visibility', 'apparentWindSpeed', 'heatStressIndex'] as const) {
      expect(FIELD_MERGE_KINDS[key]).toBeDefined();
    }
  });
});
```

(For the full-coverage test of `FIELD_MERGE_KINDS`, assert that the set of its keys equals the set of keys on a fully-populated `WeatherData` sample, so a new field added later without a merge kind fails the test.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/providers/mergeWeatherData.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `mergeWeatherData.ts`**

Implement the policy from the table. Structure: small pure local helpers (`mean(values)`, `circularMean(dirs, speeds)`, `hazardMax(values)`, `hazardMin(values)`, `firstPresent(dataList, key)`, `maxSeverity(conditions)`), each operating on the present values across `dataList`, then assemble the output with conditional spreads (omit absent optionals). Recompute the five base-derived fields via `deriveBaseWeatherFields(mergedTemp, mergedPressure, mergedHumidity, mergedWindSpeed)`. Compute `heatStressIndex` from the selected `wetBulbGlobeTemperature` via `calculateHeatStressIndex` when present. Compute `windGustFactor` from the merged gust and sustained with the `max(1, ...)` guard. Set `timestamp` from `dataList[0]`. Omit the three apparent-wind fields. Define the severity ladder as an ordered array; if the notifier already exports a `NotificationState` ordering, import and reuse it rather than redefining (check `src/notifications/` and `src/types/plugin.ts`); otherwise define `const STATE_LADDER: NotificationState[] = ['normal', 'alert', 'warn', 'alarm', 'emergency']` with a comment. Keep `mergeWeatherData` under Biome's cognitive-complexity limit by extracting the per-kind helpers (the same decomposition pattern the daily forecast mapper used).

`FIELD_MERGE_KINDS` is the `Record<keyof WeatherData, MergeKind>` literal matching the table, with `MergeKind = 'mean' | 'circular' | 'hazard-max' | 'hazard-min' | 'priority-present' | 'conservative-tendency' | 'categorical' | 'primary' | 'derived' | 'excluded'`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/providers/mergeWeatherData.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the gate and commit**

Run: `npm run validate` (green). Then:

```bash
git add src/providers/mergeWeatherData.ts src/__tests__/providers/mergeWeatherData.test.ts
git commit -m "feat: add the synthetic weather merge engine and its field policy"
```

---

### Task 3: The MergingWeatherProvider

**Files:**
- Create: `src/providers/MergingWeatherProvider.ts`
- Test: `src/__tests__/providers/MergingWeatherProvider.test.ts` (create)

**Interfaces:**
- Consumes: `mergeWeatherData` (Task 2); `CurrentWeatherProvider`, `ForecastCapableProvider`, `supportsForecasts` (the seam); `WeatherData`, `GeoLocation`, `Logger`; `SKWeatherData` (`@signalk/server-api`).
- Produces: `class MergingWeatherProvider implements ForecastCapableProvider`. Constructor `(children: ReadonlyArray<CurrentWeatherProvider>, forecastChild: ForecastCapableProvider, logger)`, where `children` are priority-ordered (primary first) and `forecastChild` is the designated forecast-capable child (one of `children`). It rejects a `MergingWeatherProvider` in `children` (no nesting). `name = MERGED_PROVIDER_NAME` (a constant, for example `'Virtual Weather Sensors (merged)'`), `sourceRef = 'merged'`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/providers/MergingWeatherProvider.test.ts
import { describe, expect, it, vi } from 'vitest';
import { MergingWeatherProvider } from '../../providers/MergingWeatherProvider.js';
import type { CurrentWeatherProvider, ForecastCapableProvider } from '../../providers/WeatherProvider.js';
import type { WeatherData } from '../../types/index.js';

const wd = (over: Partial<WeatherData>): WeatherData => ({
  temperature: 290, pressure: 101000, humidity: 0.5, windSpeed: 5, windDirection: 0,
  dewPoint: 283, windChill: 290, heatIndex: 290, timestamp: '2026-06-22T12:00:00Z', ...over,
});

function stubProvider(over: Partial<CurrentWeatherProvider> & { data?: WeatherData; fail?: boolean }): CurrentWeatherProvider {
  return {
    name: over.name ?? 'stub',
    sourceRef: over.sourceRef ?? 'stub',
    fetchCurrentWeather: vi.fn(async () => {
      if (over.fail) throw new Error('boom');
      return over.data ?? wd({});
    }),
    getRequestCount: () => 1,
    getRequestCountLast24h: () => 2,
    getCacheStats: () => ({ size: 3 }),
  };
}

function forecastStub(): ForecastCapableProvider {
  return {
    ...stubProvider({ name: 'fc', sourceRef: 'fc' }),
    forecastCapabilities: { hourlyHours: 48, dailyDays: 9 },
    getObservation: vi.fn(async () => ({ date: 'd', type: 'observation' }) as never),
    getHourlyForecast: vi.fn(async () => []),
    getDailyForecast: vi.fn(async () => []),
  };
}

describe('MergingWeatherProvider', () => {
  it('blends survivors and stamps the merged source', async () => {
    const fc = forecastStub();
    const svc = new MergingWeatherProvider([fc, stubProvider({ data: wd({ temperature: 300 }) })], fc, () => {});
    const merged = await svc.fetchCurrentWeather({ latitude: 0, longitude: 0 });
    expect(merged.temperature).toBeCloseTo(295, 5); // mean of 290 and 300
    expect(svc.sourceRef).toBe('merged');
    expect(svc.name).toContain('merged');
  });
  it('returns the single survivor unchanged when only one child succeeds', async () => {
    const fc = forecastStub();
    const only = wd({ temperature: 277 });
    const svc = new MergingWeatherProvider([fc, stubProvider({ fail: true })], fc, () => {});
    (fc.fetchCurrentWeather as ReturnType<typeof vi.fn>).mockResolvedValueOnce(only);
    const merged = await svc.fetchCurrentWeather({ latitude: 0, longitude: 0 });
    expect(merged).toEqual(only); // passthrough, no synthesis
  });
  it('throws when every child fails', async () => {
    const fc = forecastStub();
    (fc.fetchCurrentWeather as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('down'));
    const svc = new MergingWeatherProvider([fc, stubProvider({ fail: true })], fc, () => {});
    await expect(svc.fetchCurrentWeather({ latitude: 0, longitude: 0 })).rejects.toThrow();
  });
  it('sums child request counts and delegates forecasts to the designated child', async () => {
    const fc = forecastStub();
    const svc = new MergingWeatherProvider([fc, stubProvider({})], fc, () => {});
    expect(svc.getRequestCount()).toBe(2); // 1 + 1
    expect(svc.getRequestCountLast24h()).toBe(4); // 2 + 2
    expect(svc.forecastCapabilities).toEqual({ hourlyHours: 48, dailyDays: 9 });
    await svc.getHourlyForecast({ latitude: 0, longitude: 0 });
    expect(fc.getHourlyForecast).toHaveBeenCalled();
  });
  it('rejects a MergingWeatherProvider child at construction (no nesting)', () => {
    const fc = forecastStub();
    const inner = new MergingWeatherProvider([fc, stubProvider({})], fc, () => {});
    expect(() => new MergingWeatherProvider([inner, fc], fc, () => {})).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/providers/MergingWeatherProvider.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `MergingWeatherProvider.ts`**

Implement:
- `MERGED_PROVIDER_NAME = 'Virtual Weather Sensors (merged)'` (exported, so the wiring and any label can reuse it).
- Constructor rejects nesting: `if (children.some((c) => c instanceof MergingWeatherProvider)) throw new Error(...)`. Store `children`, `forecastChild`, `logger`.
- `name = MERGED_PROVIDER_NAME`, `sourceRef = 'merged'`.
- `forecastCapabilities = forecastChild.forecastCapabilities` (assigned in the constructor from the child).
- `fetchCurrentWeather(location)`: `Promise.allSettled(children.map((c) => c.fetchCurrentWeather(location)))`; collect fulfilled values IN CHILDREN ORDER (so priority order is preserved), log each rejection at warn with the child name. Zero survivors: throw (the same failure contract as a single provider). One survivor: return it unchanged. Two or more: `return mergeWeatherData(survivors)`.
- `getObservation`, `getHourlyForecast`, `getDailyForecast`: delegate to `forecastChild` (forecasts and the observation come from one designated model, internally coherent; blending a single observation's pressure is a noted deferred enhancement, kept out for coherence with the delegated forecasts).
- `getRequestCount()` and `getRequestCountLast24h()`: sum over `children`. `getCacheStats()`: `{ size: sum of children sizes }`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/providers/MergingWeatherProvider.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the gate and commit**

Run: `npm run validate` (green). Then:

```bash
git add src/providers/MergingWeatherProvider.ts src/__tests__/providers/MergingWeatherProvider.test.ts
git commit -m "feat: add the merging weather provider that blends available sources"
```

---

### Task 4: Wire merged-mode construction

**Files:**
- Create: `src/providers/createWeatherProvider.ts`
- Test: `src/__tests__/providers/createWeatherProvider.test.ts` (create)
- Modify: `src/index.ts` (one call site)

**Interfaces:**
- Consumes: `PROVIDER_CATALOG`, `createCurrentWeatherProvider`, `MergingWeatherProvider`, `supportsForecasts`, `resolveWeatherMode`, `WEATHER_PROVIDER_IDS`, `providerRequiresApiKey`; `PluginConfiguration`, `Logger`.
- Produces: `createWeatherProvider(config, logger): CurrentWeatherProvider`. In single mode it returns `createCurrentWeatherProvider(config, logger)` (unchanged behavior). In merged mode it enumerates the available providers, constructs them in priority order (primary first), picks the designated forecast-capable child, and returns a `MergingWeatherProvider`; with only one available provider it returns that single provider (degrade to single, no synthesis).

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/providers/createWeatherProvider.test.ts
import { describe, expect, it } from 'vitest';
import { createWeatherProvider } from '../../providers/createWeatherProvider.js';
import { sanitizeConfiguration } from '../../utils/validation.js';

describe('createWeatherProvider', () => {
  it('returns a single provider in single mode', () => {
    const p = createWeatherProvider(sanitizeConfiguration({ weatherProvider: 'open-meteo', weatherMode: 'single' }), () => {});
    expect(p.sourceRef).toBe('open-meteo');
  });
  it('returns a merged provider in merged mode with at least two keyless providers available', () => {
    // Open-Meteo and Met.no are always available, so merged mode always has two.
    const p = createWeatherProvider(sanitizeConfiguration({ weatherProvider: 'open-meteo', weatherMode: 'merged' }), () => {});
    expect(p.sourceRef).toBe('merged');
    expect(p.name).toContain('merged');
  });
  it('uses the configured provider as the merged primary (priority first)', () => {
    const p = createWeatherProvider(sanitizeConfiguration({ weatherProvider: 'met-no', weatherMode: 'merged' }), () => {});
    expect(p.sourceRef).toBe('merged'); // primary is met-no but the merged ref is constant
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/providers/createWeatherProvider.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `createWeatherProvider.ts`**

```ts
/**
 * Constructs the weather provider the config selects, honoring weatherMode.
 * In single mode this is the catalog provider for config.weatherProvider. In
 * merged mode it builds every available provider (the primary first, then the
 * rest in catalog order) and wraps them in a MergingWeatherProvider, degrading
 * to the single available provider when only one exists.
 */
import {
  WEATHER_PROVIDER_IDS,
  providerRequiresApiKey,
  resolveWeatherMode,
  type WeatherProviderId,
} from '../constants/notifications-shared.js';
import type { Logger, PluginConfiguration } from '../types/index.js';
import { createCurrentWeatherProvider } from './createCurrentWeatherProvider.js';
import { MergingWeatherProvider } from './MergingWeatherProvider.js';
import { PROVIDER_CATALOG } from './providerCatalog.js';
import { supportsForecasts, type CurrentWeatherProvider } from './WeatherProvider.js';

/** Provider ids available given the config: keyless always, keyed only when a key is present. */
function availableProviderIds(config: PluginConfiguration): WeatherProviderId[] {
  return WEATHER_PROVIDER_IDS.filter(
    (id) => !providerRequiresApiKey(id) || (id === 'accuweather' && !!config.accuWeatherApiKey)
  );
}

export function createWeatherProvider(
  config: PluginConfiguration,
  logger: Logger = () => {}
): CurrentWeatherProvider {
  if (resolveWeatherMode(config.weatherMode) === 'single') {
    return createCurrentWeatherProvider(config, logger);
  }
  // Priority order: the configured provider is the primary, then the rest in catalog order.
  const available = availableProviderIds(config);
  const ordered = [config.weatherProvider, ...available.filter((id) => id !== config.weatherProvider)];
  if (ordered.length <= 1) {
    return createCurrentWeatherProvider(config, logger);
  }
  const children = ordered.map((id) => PROVIDER_CATALOG[id].construct(config, logger));
  const forecastChild = children.find(supportsForecasts);
  if (!forecastChild) {
    // No forecast-capable child (not reachable while Open-Meteo is always available
    // and forecast-capable); fall back to the single primary rather than a merge
    // that cannot serve the v2 forecast surface.
    return createCurrentWeatherProvider(config, logger);
  }
  return new MergingWeatherProvider(children, forecastChild, logger);
}
```

(Note: `config.weatherProvider` is always in `available` because the operator cannot select a keyed provider without a key, so it is never dropped from `ordered`; if a future state allowed that, the `ordered` head would still be valid since the catalog can construct it. Confirm `availableProviderIds` includes `config.weatherProvider` for the supported configs, and that the head-of-list is the primary.)

- [ ] **Step 4: Wire `index.ts`**

At `src/index.ts:203`, replace `const provider = createCurrentWeatherProvider(config, instance.logger);` with `const provider = createWeatherProvider(config, instance.logger);` and update the import from `./providers/createCurrentWeatherProvider.js` to `./providers/createWeatherProvider.js` (the new function; `createCurrentWeatherProvider` is still used internally by `createWeatherProvider`, so its module stays). Nothing else in `index.ts` changes: `provider.sourceRef` becomes `merged` in merged mode, `supportsForecasts(provider)` is true (the merging provider is forecast-capable by delegation), so the v2 adapter registers with `provider.name` showing the merged display name.

- [ ] **Step 5: Run the gate**

Run: `npm run validate`
Expected: green. The new construction tests pass; the existing `index.test.ts` registration tests still pass (single-mode default is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/providers/createWeatherProvider.ts src/__tests__/providers/createWeatherProvider.test.ts src/index.ts
git commit -m "feat: build a merging provider when weather mode is merged"
```

---

### Task 5: Documentation, migration note, and a merged-install integration test

**Files:**
- Modify: `CHANGELOG.md`, `docs/decisions/weather-provider-migration.md` (or the actual migration memo path), `CLAUDE.md` (the architecture note), `README.md` (the "What's new" section is a RELEASE step, NOT done here unless cutting a release: this task only adds the unreleased CHANGELOG entry and the architecture and migration notes)
- Test: `src/__tests__/index.test.ts` (extend)

**Interfaces:**
- Consumes: the merged construction (Task 4).

- [ ] **Step 1: Add the merged-install registration test**

Model on the existing registration tests in `index.test.ts`. Start the plugin with `{ weatherProvider: 'open-meteo', weatherMode: 'merged' }`, assert `registerWeatherProvider` was called, that the registered provider's `name` is the merged display name (contains `merged`), and that `/api/status` reports `weatherProviderRegistered: true`. Because `WeatherService` is mocked at the module level, no real fetch fires; the registration gate runs against the real merged provider built by `createWeatherProvider`.

```ts
it('registers the v2 weather provider with the merged name in merged mode', async () => {
  // Same setup as the Open-Meteo registration test, with weatherMode 'merged'.
  // Assert registerWeatherProvider was invoked, the provider name contains 'merged', and the status flag is true.
});
```

(Write the full body modeled on the existing registration test, not a stub.)

- [ ] **Step 2: Document the merge**

- `CHANGELOG.md`: add an Unreleased entry (or the next version's section) describing merge mode: selecting "Merge available providers" blends Open-Meteo, Met.no, and AccuWeather (when keyed) into synthetic current-conditions values on a new `merged` `$source`, with hazard-bearing fields (severe condition, precipitation, gust, and a falling barometer) escalating to the most conservative value and a low-visibility floor. Note that switching to merged changes the `$source` on the canonical leaves from a provider ref to `merged`, which yields to a real sensor under source priorities exactly as the single-provider sources do, and silently breaks any source-priority rule previously set against a specific provider. Follow the writing rules (no AI or process language, no em dashes).
- The provider-migration decision memo: add a short note that merge mode introduces the `merged` `$source` and the same `$source`-change caveat.
- `CLAUDE.md`: add a short architecture note under the multi-provider section that `weatherMode = 'merged'` builds a `MergingWeatherProvider` (`src/providers/MergingWeatherProvider.ts`) over the available providers, blending current conditions per the `FIELD_MERGE_KINDS` policy in `src/providers/mergeWeatherData.ts`, recomputing derived fields from the merged base through `deriveBaseWeatherFields`, delegating forecasts and observations to the highest-priority forecast-capable child, and stamping `$source: 'merged'`. Note that `apparent*` fields are added downstream in `WeatherService`, the marine layer and warnings are never merged, and forecasts stay single-source for model coherence.

- [ ] **Step 3: Run the gate and commit**

Run: `npm run validate` (green). Then:

```bash
git add CHANGELOG.md docs/ CLAUDE.md src/__tests__/index.test.ts
git commit -m "feat: document merge mode and cover merged v2 registration"
```

(Adjust the `git add` paths to the actual migration-memo file.)

---

## Self-Review

Run after all tasks:

- [ ] `npm run validate` green: type-check (including panel), Biome, full Vitest (>= 501 plus the new helper, engine, provider, construction, and registration tests).
- [ ] A merged install emits the blended current conditions on `$source: 'merged'` and registers a v2 provider whose `_providers` name is the merged display name (never a single provider's name).
- [ ] The merge never averages a hazard or a derived value: severe condition, precipitation, and gust are hazard-max; visibility is hazard-min; a falling barometer wins; WBGT and categorical fields are priority first-present, not averaged; windChill, heatIndex, Beaufort, absolute humidity, air density, heat-stress index, and gust factor are recomputed from the merged base.
- [ ] Wind direction uses the speed-weighted circular mean with the opposing-wind fallback, never a raw arithmetic mean across the 0/2π wrap.
- [ ] The three apparent-wind fields are excluded from the merge output (added downstream); the marine layer and warnings are never merged; forecasts and observations delegate to one designated child.
- [ ] The Task 1 hoist is behavior-preserving: the existing `OpenMeteoMapper.test.ts` and `MetNoMapper.test.ts` pass unmodified, and no duplicate recompute block remains (the merge is the third consumer of the one shared helper).
- [ ] Single-provider behavior, the `open-meteo`, `accuweather`, `met-no`, and `open-meteo-marine` `$source` values, and legacy config without `weatherMode` (resolves to `single`) are all unchanged.
- [ ] `MergingWeatherProvider` rejects nesting, sums child quota counts, returns a single survivor unchanged, and throws when all children fail.

## Hand-off

After this plan, the multi-provider weather feature is complete: an operator picks a single provider (Open-Meteo, Met.no, or AccuWeather) or merge mode, which blends every available provider's current conditions into synthetic `merged`-sourced values while forecasts, observations, and warnings stay single-source for coherence. Noted deferred enhancements, surfaced for the team review to weigh: a `measured` flag on `WeatherData` for true prefer-measured WBGT (today WBGT is priority first-present, so set AccuWeather as the primary to prefer its measured value); blending the merged v2 observation's pressure across children (today the observation delegates to the designated forecast child for coherence); per-domain provider selection and automatic primary/fallback failover (the seam allows these, they are out of scope). The deferred politeness items from the Met.no phases (conditional `If-Modified-Since` polling, the marine-only MetAlerts filter) are independent of the merge.
