# Met.no Current-Conditions Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Met.no (api.met.no) as a third keyless weather provider for the live current-conditions emission path, so a user can select it and its `WeatherData` becomes available to the Plan 3 merge engine.

**Architecture:** This is phase 1 of three for the Met.no provider (phase 2 is v2 forecasts, phase 3 is MetAlerts warnings). It follows the established add-a-provider pattern exactly: add `met-no` to the panel-safe id registry and the `PROVIDER_CATALOG`, create a `MetNoService` implementing `CurrentWeatherProvider` against Met.no Locationforecast 2.0, a pure `MetNoMapper` (the Locationforecast timeseries first entry to internal SI `WeatherData`, paralleling `OpenMeteoMapper`), and a `met-no-severity` classifier (the Met.no `symbol_code` analog of `open-meteo-severity`). The capability-driven registry and panel from prior work mean the panel renders Met.no with no panel edit. Met.no is keyless, global, and CC BY 4.0.

**Tech Stack:** TypeScript (strict, ES2023), ESM (NodeNext), Vitest, Biome, `@signalk/server-api` (peer, types only).

## Global Constraints

- ESM NodeNext: import sibling modules with the `.js` specifier even from `.ts` source.
- Node floor 20.18; `@signalk/server-api` is a types-only peer dependency.
- Internal `WeatherData` is SI: m/s, radians in [0, 2π), Kelvin, Pa, ratio 0..1. Met.no Locationforecast units: `air_temperature` and `dew_point_temperature` Celsius (`celsiusToKelvin`), `air_pressure_at_sea_level` hPa (`millibarsToPA`), `relative_humidity` and `cloud_area_fraction` percent (`percentageToRatio`/`optionalPercentageToRatio`), `wind_speed` and `wind_speed_of_gust` m/s (use directly), `wind_from_direction` degrees (`degreesToRadians` then `normalizeAngle0To2Pi`), `next_1_hours.details.precipitation_amount` mm. Met.no provides NO visibility and no precipitation type beyond `symbol_code`, so those leaves are unset (as the Open-Meteo path already leaves several unset).
- Met.no terms (https://api.met.no/doc/TermsOfService): keyless, but the `User-Agent` MUST identify the app AND a contact. Use `${PLUGIN.NAME}/${PLUGIN.VERSION} (+https://github.com/NearlCrews/signalk-virtual-weather-sensors)`. Truncate lat/lon to 4 decimals. Do not poll continuously (the plugin's update cadence satisfies this). Attribution is CC BY 4.0.
- Verified API facts (from https://api.met.no/weatherapi/locationforecast/2.0/documentation, June 2026): the endpoint is `GET /weatherapi/locationforecast/2.0/compact?lat=<lat>&lon=<lon>` (lat and lon mandatory decimal degrees, `altitude` optional). The response is GeoJSON: `{ type: 'Feature', geometry, properties: { meta, timeseries: [...] } }`, so the plugin reads `properties.timeseries`. Each entry is `{ time, data: { instant: { details }, next_1_hours, next_6_hours, next_12_hours } }`, and the field paths in this plan (`data.instant.details.air_temperature` etc., `data.next_1_hours.summary.symbol_code`, `data.next_1_hours.details.precipitation_amount`) are confirmed against the data model. A missing or PROHIBITED `User-Agent` (okhttp, Dalvik, fhttp, Java are banned) returns 403, so the identifying UA is mandatory, not optional. The hourly timeseries extends up to nine days (it switches from hourly to 6-hourly steps further out, which matters for phase 2's forecast mapper, not this phase).
- Reuse, do not re-derive: use the `conversions.ts` helpers and the `WindCalculator` exactly as `OpenMeteoMapper` does (recompute wind chill, heat index, Beaufort, absolute humidity, air density, and the WBGT estimate, since Met.no, like Open-Meteo, does not supply them).
- Text rule for all comments, commit messages, and docs: no em dashes (use a colon, a comma, or two sentences), use the Oxford comma, write the word "and" never "&", and never mention any AI or review process.
- Gate after every task: `npm run validate` (type-check including the panel, Biome, full Vitest). The suite is at 470 tests; only add tests, never reduce the count.
- Commit type `feat:` for the provider-adding tasks.

---

### Task 1: Register the met-no provider id

**Files:**
- Modify: `src/constants/notifications-shared.ts`
- Test: `src/__tests__/constants/notifications-shared.test.ts` (extend)

**Interfaces:**
- Produces: `'met-no'` added to the `WeatherProviderId` union, `WEATHER_PROVIDER_IDS`, `WEATHER_PROVIDER_LABELS`, and `WEATHER_PROVIDER_REQUIRES_KEY` (set `false`, keyless). `DEFAULT_WEATHER_PROVIDER` stays `'open-meteo'`. This is panel-safe (no Node imports), so the panel picker and the rjsf schema render Met.no automatically.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/constants/notifications-shared.test.ts (add)
import {
  providerRequiresApiKey,
  resolveWeatherProvider,
  WEATHER_PROVIDER_IDS,
  WEATHER_PROVIDER_LABELS,
} from '../../constants/notifications-shared.js';

describe('met-no provider registration', () => {
  it('is a known keyless provider with a label', () => {
    expect([...WEATHER_PROVIDER_IDS]).toContain('met-no');
    expect(WEATHER_PROVIDER_LABELS['met-no']).toBeTruthy();
    expect(providerRequiresApiKey('met-no')).toBe(false);
  });
  it('resolves an explicit met-no selection', () => {
    expect(resolveWeatherProvider('met-no', false)).toBe('met-no');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/constants/notifications-shared.test.ts -t "met-no provider registration"`
Expected: FAIL, `met-no` not a known id.

- [ ] **Step 3: Add met-no to `notifications-shared.ts`**

Add `'met-no'` to the `WeatherProviderId` union, to `WEATHER_PROVIDER_IDS` (after `accuweather`), to `WEATHER_PROVIDER_LABELS` (`'met-no': 'Met.no (free, no API key, global; Nordic and European alerts)'`), and to `WEATHER_PROVIDER_REQUIRES_KEY` (`'met-no': false`). `Record<WeatherProviderId, ...>` will force the label and key-requirement entries at compile time, so the type-check catches an omission.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/constants/notifications-shared.test.ts -t "met-no provider registration"`
Expected: PASS. (Type-check will now flag the missing `PROVIDER_CATALOG['met-no']` entry, since the catalog is `Record<WeatherProviderId, ...>`; Task 5 adds it. Run the full gate after Task 5. To keep this task green on its own, add the catalog entry in this task too if your executor requires a per-task green gate, OR combine Tasks 1 and 5. The plan keeps them separate for review clarity; see Task 5.)

- [ ] **Step 5: Defer the full-gate green and commit to Task 5** (Tasks 1 and 5 commit together because the `Record<WeatherProviderId, ProviderCatalogEntry>` catalog type makes the new id and the catalog entry compile-coupled.)

---

### Task 2: Add the Met.no Locationforecast response type

**Files:**
- Create: `src/types/met-no-api.ts`
- Modify: `src/types/index.ts` (barrel re-export)
- Test: covered by later tasks

**Interfaces:**
- Produces: `MetNoLocationforecastResponse` in a new `src/types/met-no-api.ts`, the Locationforecast 2.0 timeseries shape (only the mapped fields, all optional). Add `export type * from './met-no-api.js';` to the `types/index.ts` barrel.

- [ ] **Step 1: Add the type**

```ts
// src/types/met-no-api.ts
/**
 * Met.no Locationforecast 2.0 response. The forecast is a timeseries: each entry
 * has an `instant.details` block (units: air_temperature and
 * dew_point_temperature Celsius, air_pressure_at_sea_level hPa, relative_humidity
 * and cloud_area_fraction percent, wind_speed and wind_speed_of_gust m/s,
 * wind_from_direction degrees) plus optional period blocks. The current value is
 * the first timeseries entry. Only the mapped fields are typed, all optional.
 */
interface MetNoInstantDetails {
  readonly air_temperature?: number;
  readonly air_pressure_at_sea_level?: number;
  readonly relative_humidity?: number;
  readonly dew_point_temperature?: number;
  readonly cloud_area_fraction?: number;
  readonly fog_area_fraction?: number;
  readonly wind_speed?: number;
  readonly wind_speed_of_gust?: number;
  readonly wind_from_direction?: number;
  readonly ultraviolet_index_clear_sky?: number;
}

interface MetNoPeriod {
  readonly summary?: { readonly symbol_code?: string };
  readonly details?: {
    readonly precipitation_amount?: number;
    readonly air_temperature_max?: number;
    readonly air_temperature_min?: number;
  };
}

export interface MetNoTimeseriesEntry {
  readonly time?: string;
  readonly data?: {
    readonly instant?: { readonly details?: MetNoInstantDetails };
    readonly next_1_hours?: MetNoPeriod;
    readonly next_6_hours?: MetNoPeriod;
    readonly next_12_hours?: MetNoPeriod;
  };
}

export interface MetNoLocationforecastResponse {
  readonly properties?: { readonly timeseries?: ReadonlyArray<MetNoTimeseriesEntry> };
}
```

- [ ] **Step 2: Run the gate and commit**

Run: `npm run validate` (green). Then:

```bash
git add src/types/met-no-api.ts src/types/index.ts
git commit -m "feat: add the Met.no Locationforecast response type"
```

---

### Task 3: Add the Met.no severity classifier

**Files:**
- Create: `src/providers/met-no-severity.ts`
- Test: `src/__tests__/providers/met-no-severity.test.ts` (create)

**Interfaces:**
- Produces: `metNoSevereCondition(symbolCode: string | undefined): SevereCondition | undefined`, the Met.no analog of `open-meteo-severity`. Met.no `symbol_code` is a string like `clearsky_day`, `lightrainshowers_night`, `snow`, `sleetandthunder`. Strip the `_day`/`_night`/`_polartwilight` suffix, then classify by substring, matching the marine-relevant philosophy of the other severity maps: a code containing `andthunder` is `warn` Thunderstorms; otherwise a code containing `snow` is `warn` Snow; otherwise a code containing `sleet` is `warn` Sleet; everything else (clear, cloudy, fog, rain, drizzle, showers) returns `undefined` because those hazards are surfaced through the dedicated wind, visibility, and temperature bands.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/providers/met-no-severity.test.ts
import { describe, expect, it } from 'vitest';
import { metNoSevereCondition } from '../../providers/met-no-severity.js';

describe('metNoSevereCondition', () => {
  it('classifies snow, sleet, and thunder as warn, ignoring the day/night suffix', () => {
    expect(metNoSevereCondition('snow')?.state).toBe('warn');
    expect(metNoSevereCondition('lightsnowshowers_day')?.label).toBe('Snow');
    expect(metNoSevereCondition('sleet_night')?.label).toBe('Sleet');
    expect(metNoSevereCondition('rainandthunder')?.label).toBe('Thunderstorms');
    expect(metNoSevereCondition('lightsleetandthunder_day')?.label).toBe('Thunderstorms');
  });
  it('returns undefined for benign or liquid-precipitation codes', () => {
    expect(metNoSevereCondition('clearsky_day')).toBeUndefined();
    expect(metNoSevereCondition('rain')).toBeUndefined();
    expect(metNoSevereCondition('fog')).toBeUndefined();
    expect(metNoSevereCondition(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/providers/met-no-severity.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `met-no-severity.ts`**

```ts
/**
 * Met.no `symbol_code` to provider-agnostic `SevereCondition`, the Met.no analog
 * of open-meteo-severity and accuweather-severity. Only marine-relevant severe
 * weather maps: thunder, snow, and sleet (an icing hazard). Benign sky states,
 * fog, and plain liquid precipitation return undefined because those hazards are
 * surfaced through the dedicated wind, visibility, and temperature bands. The
 * `_day`/`_night`/`_polartwilight` suffix is cosmetic (daylight only) and is
 * stripped before classification.
 */
import type { SevereCondition } from '../types/index.js';

export function metNoSevereCondition(symbolCode: string | undefined): SevereCondition | undefined {
  if (typeof symbolCode !== 'string') return undefined;
  const base = symbolCode.replace(/_(day|night|polartwilight)$/, '');
  if (base.includes('andthunder')) return { state: 'warn', label: 'Thunderstorms' };
  if (base.includes('snow')) return { state: 'warn', label: 'Snow' };
  if (base.includes('sleet')) return { state: 'warn', label: 'Sleet' };
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes, then the gate**

Run: `npx vitest run src/__tests__/providers/met-no-severity.test.ts` (PASS), then `npm run validate` (green).

- [ ] **Step 5: Commit**

```bash
git add src/providers/met-no-severity.ts src/__tests__/providers/met-no-severity.test.ts
git commit -m "feat: add the Met.no symbol-code severity classifier"
```

---

### Task 4: Create the Met.no current-block mapper

**Files:**
- Create: `src/mappers/MetNoMapper.ts`
- Test: `src/__tests__/mappers/MetNoMapper.test.ts` (create)

**Interfaces:**
- Consumes: `MetNoLocationforecastResponse` (Task 2), `metNoSevereCondition` (Task 3), the `conversions.ts` helpers, `WindCalculator`.
- Produces: `mapMetNoCurrentToWeatherData(response: MetNoLocationforecastResponse): WeatherData`, pure, paralleling `mapOpenMeteoCurrentToWeatherData` in `OpenMeteoMapper.ts`. It reads the FIRST timeseries entry's `instant.details` for the core fields, the entry's `next_1_hours.summary.symbol_code` for the description and severe condition, and `next_1_hours.details.precipitation_amount` for `precipitationLastHour`. It throws a tagged `INVALID_WEATHER_DATA` error when the timeseries or a required field (temperature, pressure, humidity, wind_speed, wind_from_direction, dew_point) is missing, the same contract `OpenMeteoMapper` uses.

Required vs derived (mirror `OpenMeteoMapper`):
- Required from `instant.details`: `air_temperature` (K), `air_pressure_at_sea_level` (Pa), `relative_humidity` (ratio), `wind_speed` (m/s), `wind_from_direction` (rad, normalized), `dew_point_temperature` (K).
- Recomputed (Met.no does not supply them): `windChill`, `heatIndex`, `beaufortScale`, `absoluteHumidity`, `airDensityEnhanced`, `wetBulbGlobeTemperature` (estimate), `heatStressIndex`. Use the same `WindCalculator` instance pattern and the same conversion helpers `OpenMeteoMapper` uses.
- Optional: `cloudCover` (from `cloud_area_fraction`), `windGustSpeed` (from `wind_speed_of_gust`), `windGustFactor` (`calculateGustFactor`), `uvIndex` (from `ultraviolet_index_clear_sky`), `precipitationLastHour` (from `next_1_hours.details.precipitation_amount`), `description` (a `symbol_code`-to-phrase, see below), `severeCondition` (`metNoSevereCondition(symbol_code)`). No `visibility` (Met.no does not provide it).
- `timestamp`: the first entry's `time` via `asOpenMeteoTimestamp` (or a Met.no-specific timestamp helper if the format differs; Met.no returns ISO 8601 with a `Z`, so a passthrough is fine, but reuse `asOpenMeteoTimestamp` for consistency).
- Description: Met.no has no plain-language text, only `symbol_code`. Map the base `symbol_code` to a readable phrase with a small `MET_NO_DESCRIPTIONS` map (or a simple humanizer that title-cases the base code). Keep it small; the band-message system does not require it.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/mappers/MetNoMapper.test.ts
import { describe, expect, it } from 'vitest';
import { mapMetNoCurrentToWeatherData } from '../../mappers/MetNoMapper.js';
import type { MetNoLocationforecastResponse } from '../../types/index.js';

const sample: MetNoLocationforecastResponse = {
  properties: {
    timeseries: [
      {
        time: '2026-06-22T12:00:00Z',
        data: {
          instant: {
            details: {
              air_temperature: 20,
              air_pressure_at_sea_level: 1013,
              relative_humidity: 50,
              dew_point_temperature: 10,
              wind_speed: 5,
              wind_from_direction: 90,
              cloud_area_fraction: 25,
              wind_speed_of_gust: 8,
            },
          },
          next_1_hours: { summary: { symbol_code: 'snow' }, details: { precipitation_amount: 1.2 } },
        },
      },
    ],
  },
};

describe('mapMetNoCurrentToWeatherData', () => {
  it('maps the first timeseries entry to SI WeatherData', () => {
    const wd = mapMetNoCurrentToWeatherData(sample);
    expect(wd.temperature).toBeCloseTo(293.15, 2);
    expect(wd.pressure).toBeCloseTo(101300, 0);
    expect(wd.humidity).toBeCloseTo(0.5, 5);
    expect(wd.windSpeed).toBeCloseTo(5, 5);
    expect(wd.windDirection).toBeCloseTo(Math.PI / 2, 5);
    expect(wd.cloudCover).toBeCloseTo(0.25, 5);
    expect(wd.windGustSpeed).toBeCloseTo(8, 5);
    expect(wd.precipitationLastHour).toBeCloseTo(1.2, 5);
    expect(wd.severeCondition?.label).toBe('Snow');
    expect(typeof wd.beaufortScale).toBe('number');
    expect(wd.visibility).toBeUndefined(); // Met.no provides no visibility
  });
  it('throws when the timeseries is empty', () => {
    expect(() => mapMetNoCurrentToWeatherData({ properties: { timeseries: [] } })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/mappers/MetNoMapper.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `MetNoMapper.ts`**

Model the file on `OpenMeteoMapper.ts` (the imports, the `requireNumber` helper, the module-level `sharedWindCalculator`, the recompute block, the optional-fields extractor). Read the first timeseries entry; throw `INVALID_WEATHER_DATA` if `properties.timeseries[0]` or a required `instant.details` field is absent. Build the same `WeatherData` shape, omitting `visibility`. Use `metNoSevereCondition` and a small description humanizer for the `symbol_code`.

- [ ] **Step 4: Run the gate and commit**

Run: `npm run validate` (green). Then:

```bash
git add src/mappers/MetNoMapper.ts src/__tests__/mappers/MetNoMapper.test.ts
git commit -m "feat: map the Met.no Locationforecast current block to internal WeatherData"
```

---

### Task 5: Create MetNoService and register it in the catalog

**Files:**
- Create: `src/services/MetNoService.ts`
- Modify: `src/providers/providerCatalog.ts`
- Modify: `src/constants/notifications-shared.ts` (committed here with Task 1's registry additions)
- Test: `src/__tests__/services/MetNoService.test.ts` (create)

**Interfaces:**
- Consumes: `mapMetNoCurrentToWeatherData` (Task 4); the `met-no` id (Task 1).
- Produces: `MetNoService implements CurrentWeatherProvider`, modeled on `OpenMeteoService`: `name = 'Met.no'`, `sourceRef = 'met-no'`, `fetchCurrentWeather(location)` GETs the Locationforecast 2.0 `/compact` endpoint with the contact User-Agent, maps via `mapMetNoCurrentToWeatherData`, and the keyless quota/cache accessors return zero. A `PROVIDER_CATALOG['met-no']` entry constructs it.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/services/MetNoService.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetNoService } from '../../services/MetNoService.js';
import { createMockFetchResponse } from '../setup.js'; // use the suite's helper if exported; else inline a mock

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

const SAMPLE = {
  properties: {
    timeseries: [
      {
        time: '2026-06-22T12:00:00Z',
        data: {
          instant: { details: { air_temperature: 20, air_pressure_at_sea_level: 1013, relative_humidity: 50, dew_point_temperature: 10, wind_speed: 5, wind_from_direction: 90 } },
          next_1_hours: { summary: { symbol_code: 'cloudy' } },
        },
      },
    ],
  },
};

describe('MetNoService', () => {
  it('fetches Locationforecast and maps to WeatherData with a contact User-Agent', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(createMockFetchResponse(SAMPLE));
    const svc = new MetNoService(() => {});
    const wd = await svc.fetchCurrentWeather({ latitude: 60, longitude: 11 });
    expect(wd.temperature).toBeCloseTo(293.15, 2);
    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = (call?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('github.com');
    expect(svc.sourceRef).toBe('met-no');
    expect(svc.getRequestCountLast24h()).toBe(0);
  });
});
```

(Model the fetch mock exactly on `OpenMeteoService.test.ts` if `createMockFetchResponse` is not importable from `setup.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/services/MetNoService.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `MetNoService.ts`**

Model on `OpenMeteoService.ts`. The default base URL is `https://api.met.no`, the endpoint is `/weatherapi/locationforecast/2.0/compact`, and the query sets `lat`/`lon` truncated to 4 decimals (`toFixed(4)`). The header is `{ 'User-Agent': \`${PLUGIN.NAME}/${PLUGIN.VERSION} (+https://github.com/NearlCrews/signalk-virtual-weather-sensors)\` }`. Use the shared `fetchJson` from `utils/http.js`. `assertValidCoordinates` first, increment `requestCount`, fetch `MetNoLocationforecastResponse`, map via `mapMetNoCurrentToWeatherData`, log on success/failure like `OpenMeteoService`. The quota/cache accessors return zero (keyless). Accept an `options?: { baseUrl?: string; requestTimeoutMs?: number }` like `OpenMeteoOptions` so tests and a self-hosted instance can override the host.

- [ ] **Step 4: Add the catalog entry and finish Task 1's registry**

In `providerCatalog.ts`, import `MetNoService` and add:

```ts
'met-no': {
  keyless: !providerRequiresApiKey('met-no'),
  construct: (config, logger) => new MetNoService(logger),
},
```

Confirm Task 1's `notifications-shared.ts` additions (`met-no` in the union, ids, labels, key-requirement) are in place; the `Record<WeatherProviderId, ProviderCatalogEntry>` type now resolves.

- [ ] **Step 5: Run the gate**

Run: `npm run validate`
Expected: green. `createCurrentWeatherProvider({ weatherProvider: 'met-no', ... })` builds a `MetNoService`, selectable from the panel (which renders it automatically from `WEATHER_PROVIDER_IDS`, keyless via the capability fork).

- [ ] **Step 6: Commit Tasks 1 and 5 together**

```bash
git add src/services/MetNoService.ts src/providers/providerCatalog.ts src/constants/notifications-shared.ts src/__tests__/services/MetNoService.test.ts src/__tests__/constants/notifications-shared.test.ts
git commit -m "feat: add Met.no as a selectable keyless current-conditions provider"
```

---

### Task 6: Verify Met.no is selectable end to end

**Files:**
- Test: `src/__tests__/providers/createCurrentWeatherProvider.test.ts` (extend) and `src/__tests__/providers/providerCatalog.test.ts` (extend)

**Interfaces:**
- Consumes: the registered Met.no provider.

- [ ] **Step 1: Extend the existing provider tests**

In `providerCatalog.test.ts` (which already asserts every `WEATHER_PROVIDER_IDS` id has a catalog entry that constructs), the new `met-no` id is covered by the existing loop; add an explicit assertion that `PROVIDER_CATALOG['met-no'].construct(config, () => {}).sourceRef === 'met-no'` and `keyless === true`. In `createCurrentWeatherProvider.test.ts`, add a case that `weatherProvider: 'met-no'` builds a provider whose `sourceRef` is `'met-no'`.

- [ ] **Step 2: Run the gate and commit**

Run: `npm run validate` (green). Then:

```bash
git add src/__tests__/providers/createCurrentWeatherProvider.test.ts src/__tests__/providers/providerCatalog.test.ts
git commit -m "test: cover Met.no provider construction and selection"
```

---

## Self-Review

Run after all tasks:

- [ ] `npm run validate` green: type-check (including panel), Biome, full Vitest (>= 470 plus the new severity, mapper, service, and registration tests).
- [ ] `supportsForecasts(new MetNoService())` is FALSE (this phase adds only the current-conditions path; the v2 forecast methods are phase 2), so Met.no does NOT yet register the v2 provider. Selecting Met.no drives the live emission path only.
- [ ] Met.no is selectable: `createCurrentWeatherProvider({ weatherProvider: 'met-no' })` builds a `MetNoService`, and the panel renders it from `WEATHER_PROVIDER_IDS` with no panel edit (keyless via the capability fork).
- [ ] The mapper omits `visibility` (Met.no has none), recomputes the derived fields like the Open-Meteo path, and the User-Agent carries the required contact.
- [ ] No change to `index.ts`, the adapter, or the emission path beyond the new provider being constructible.

## Hand-off

After phase 1, Met.no is a selectable keyless current-conditions provider, and its `WeatherData` is available to the Plan 3 merge engine. Phase 2 makes `MetNoService` forecast-capable (`getObservation`/`getHourlyForecast`/`getDailyForecast` + `forecastCapabilities`, with a Met.no v2 mapper that aggregates the timeseries into hourly points and derives daily min/max, since Met.no has no clean daily block), which auto-registers the v2 provider via the `supportsForecasts` gate. Phase 3 extends `WarningsService` region dispatch to Met.no MetAlerts for Nordic and European waters. Then Plan 3, the synthesis merge engine, blends all three providers.
