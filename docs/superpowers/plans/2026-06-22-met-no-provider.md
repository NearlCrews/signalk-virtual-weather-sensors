# Met.no Current-Conditions Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Met.no (api.met.no) as a third keyless weather provider for the live current-conditions emission path, so a user can select it and its `WeatherData` becomes available to the Plan 3 merge engine.

**Architecture:** Phase 1 of three (phase 2 is v2 forecasts, phase 3 is MetAlerts warnings). It follows the established add-a-provider pattern: a `MetNoService implements CurrentWeatherProvider` against Met.no Locationforecast 2.0, a pure `MetNoMapper` (the Locationforecast timeseries first entry to internal SI `WeatherData`, paralleling `OpenMeteoMapper`), a `met-no-severity` classifier (the Met.no `symbol_code` analog of `open-meteo-severity`), and the `met-no` id added to the registry and the `PROVIDER_CATALOG`. One small panel edit makes the keyless config section provider-aware (it currently hardcodes the Open-Meteo base-URL field and attribution). Met.no is keyless, global, and CC BY 4.0.

**Tech Stack:** TypeScript (strict, ES2023), ESM (NodeNext), Vitest, Biome, `@signalk/server-api` (peer, types only).

## Global Constraints

- ESM NodeNext: import sibling modules with the `.js` specifier even from `.ts` source.
- Node floor 20.18; `@signalk/server-api` is a types-only peer dependency.
- **Endpoint: `/complete`, not `/compact`.** Verified live (June 2026): the `/compact` variant OMITS `dew_point_temperature`, `fog_area_fraction`, and `ultraviolet_index_clear_sky`. Internal `WeatherData.dewPoint` is REQUIRED (`src/types/weather.ts:25`), so the provider must obtain dew point. `/complete` returns `dew_point_temperature` (plus UV), so the plugin uses `GET /weatherapi/locationforecast/2.0/complete?lat=<lat>&lon=<lon>`. The larger `/complete` payload (probabilistic percentiles the plugin ignores) is immaterial at the plugin's minutes-cadence, keyless and unmetered.
- Internal `WeatherData` is SI: m/s, radians in [0, 2π), Kelvin, Pa, ratio 0..1. Met.no Locationforecast units (verified against the data model and a live `/complete` response): `air_temperature` and `dew_point_temperature` Celsius (`celsiusToKelvin`), `air_pressure_at_sea_level` hPa (`millibarsToPA`), `relative_humidity` and `cloud_area_fraction` percent (`percentageToRatio`/`optionalPercentageToRatio`), `wind_speed` and `wind_speed_of_gust` m/s (use directly, no conversion), `wind_from_direction` degrees (`degreesToRadians` then `normalizeAngle0To2Pi`), `ultraviolet_index_clear_sky` a 0..11+ index, `next_1_hours.details.precipitation_amount` mm (assign directly, `WeatherData.precipitationLastHour` is in mm). Met.no provides NO visibility, so that leaf is unset (as the Open-Meteo path leaves several unset).
- Met.no terms (https://api.met.no/doc/TermsOfService): keyless, but the `User-Agent` MUST identify the app AND a contact, or the request is 403'd. Use `${PLUGIN.NAME}/${PLUGIN.VERSION} (+https://github.com/NearlCrews/signalk-virtual-weather-sensors)` (the repo URL is confirmed from `package.json` `repository.url`; do not retype it with a different casing). Format lat/lon to AT MOST 4 decimals (`toFixed(4)`): the terms reject 5+ decimals with a hard 403, so this is a correctness gate, not just a caching nicety. The plugin's update cadence (not continuous polling) satisfies the no-frequent-polling rule, so conditional `If-Modified-Since` requests are a deferred politeness optimization, noted for a later phase.
- Reuse, do not re-derive: use the `conversions.ts` helpers and the `WindCalculator` exactly as `OpenMeteoMapper` does (recompute wind chill, heat index, Beaufort, absolute humidity, air density, and the WBGT estimate, since Met.no, like Open-Meteo, does not supply them).
- Text rule for all comments, commit messages, and docs: no em dashes (use a colon, a comma, or two sentences), use the Oxford comma, write the word "and" never "&", and never mention any AI or review process.
- Gate after every task: `npm run validate` (type-check including the panel, Biome, full Vitest). The suite is at 470 tests; only add tests, never reduce the count.
- Commit type `feat:` for the provider-adding tasks, `refactor:`/`fix:` for the panel task per its scope.

Note on task order: the `met-no` id is added to the `WeatherProviderId` union ONLY in Task 4, together with the `PROVIDER_CATALOG` entry. `PROVIDER_CATALOG` is `Record<WeatherProviderId, ProviderCatalogEntry>` (`providerCatalog.ts:22`), so adding the id without the catalog entry is a type-check failure. Tasks 1, 2, and 3 do NOT touch the union, so they stay green; Task 4 makes all the compile-coupled registry, catalog, and service edits in one commit.

---

### Task 1: Add the Met.no Locationforecast response type

**Files:**
- Create: `src/types/met-no-api.ts`
- Modify: `src/types/index.ts` (barrel re-export)

**Interfaces:**
- Produces: `MetNoLocationforecastResponse` in `src/types/met-no-api.ts`, the Locationforecast 2.0 `/complete` timeseries shape (only the mapped fields, all optional). Add `export type * from './met-no-api.js';` to the `types/index.ts` barrel.

- [ ] **Step 1: Add the type**

```ts
// src/types/met-no-api.ts
/**
 * Met.no Locationforecast 2.0 (/complete) response. GeoJSON Feature whose
 * properties.timeseries[] entries each carry an instant.details block (the
 * current value is the first entry) and optional period blocks. Units: air and
 * dew-point temperature Celsius, air_pressure_at_sea_level hPa, relative_humidity
 * and cloud_area_fraction percent, wind_speed and wind_speed_of_gust m/s,
 * wind_from_direction degrees, precipitation_amount mm. Only mapped fields are
 * typed, all optional. The /complete variant is required because /compact omits
 * dew_point_temperature and ultraviolet_index_clear_sky.
 */
interface MetNoInstantDetails {
  readonly air_temperature?: number;
  readonly air_pressure_at_sea_level?: number;
  readonly relative_humidity?: number;
  readonly dew_point_temperature?: number;
  readonly cloud_area_fraction?: number;
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

`next_6_hours` and `next_12_hours` are retained for phase 2's daily aggregation (Met.no has no clean daily block).

- [ ] **Step 2: Run the gate and commit**

Run: `npm run validate` (green). Then:

```bash
git add src/types/met-no-api.ts src/types/index.ts
git commit -m "feat: add the Met.no Locationforecast response type"
```

---

### Task 2: Add the Met.no severity classifier

**Files:**
- Create: `src/providers/met-no-severity.ts`
- Test: `src/__tests__/providers/met-no-severity.test.ts` (create)

**Interfaces:**
- Produces: `metNoSevereCondition(symbolCode: string | undefined): SevereCondition | undefined`, the Met.no analog of `open-meteo-severity`. Strip the `_day`/`_night`/`_polartwilight` suffix, then classify by substring: `andthunder` -> `warn` Thunderstorms; else `snow` -> `warn` Snow; else `sleet` -> `warn` Sleet; else `undefined`.

Two documented decisions (so neither reads as an oversight):
- **No `alarm` escalation.** `open-meteo-severity` escalates the hail-bearing WMO codes 96 and 99 to `alarm`. Met.no's `symbol_code` has NO hail-specific code, so the hail distinction cannot be made: all thunder is `warn`. This is the honest mapping for Met.no's vocabulary, not a missed escalation.
- **`andthunder`-first precedence.** A combined code like `snowandthunder` or `heavysleetandthunder` classifies as Thunderstorms, not Snow or Sleet, because thunder is the dominant marine hazard and the band surfaces a single label. The substring approach was verified against the Met.no `weathericons/legend.csv`: no benign or pure-rain code contains `snow` or `sleet`, and the combined codes (including the legend's double-s spellings) contain both substrings, so the order matters and is intentional.

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
    expect(metNoSevereCondition('heavysleetandthunder_day')?.label).toBe('Thunderstorms');
    expect(metNoSevereCondition('snowandthunder')?.label).toBe('Thunderstorms'); // thunder wins
  });
  it('returns undefined for benign or liquid-precipitation codes', () => {
    expect(metNoSevereCondition('clearsky_day')).toBeUndefined();
    expect(metNoSevereCondition('rain')).toBeUndefined();
    expect(metNoSevereCondition('heavyrainshowers_night')).toBeUndefined();
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
 * surfaced through the dedicated wind, visibility, and temperature bands.
 *
 * No `alarm`: open-meteo-severity escalates hail-bearing codes (WMO 96, 99) to
 * alarm, but Met.no has no hail-specific symbol_code, so all thunder is `warn`.
 * `andthunder` is checked first so a combined code (e.g. snowandthunder) maps to
 * Thunderstorms, the dominant hazard, not Snow or Sleet. The
 * `_day`/`_night`/`_polartwilight` suffix is daylight-cosmetic and is stripped.
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

### Task 3: Create the Met.no current-block mapper

**Files:**
- Create: `src/mappers/MetNoMapper.ts`
- Test: `src/__tests__/mappers/MetNoMapper.test.ts` (create)

**Interfaces:**
- Consumes: `MetNoLocationforecastResponse` (Task 1), `metNoSevereCondition` (Task 2), the `conversions.ts` helpers, `WindCalculator`.
- Produces: `mapMetNoCurrentToWeatherData(response: MetNoLocationforecastResponse): WeatherData`, pure, paralleling `mapOpenMeteoCurrentToWeatherData` in `OpenMeteoMapper.ts`. It reads the FIRST `properties.timeseries` entry's `instant.details` for the core fields, the entry's `next_1_hours.summary.symbol_code` for the description and severe condition, and `next_1_hours.details.precipitation_amount` for `precipitationLastHour`. It throws a tagged `INVALID_WEATHER_DATA` error when the timeseries is empty or a required `instant.details` field is missing, the same contract `OpenMeteoMapper` uses.

Required vs derived (mirror `OpenMeteoMapper`):
- Required from `instant.details` (all present under `/complete`): `air_temperature` (K), `air_pressure_at_sea_level` (Pa), `relative_humidity` (ratio), `wind_speed` (m/s), `wind_from_direction` (rad, normalized), `dew_point_temperature` (K).
- Recomputed (Met.no does not supply them): `windChill`, `heatIndex`, `beaufortScale`, `absoluteHumidity`, `airDensityEnhanced`, `wetBulbGlobeTemperature` (estimate), `heatStressIndex`. Use the same module-level `WindCalculator` instance and conversion helpers `OpenMeteoMapper` uses.
- Optional: `cloudCover` (from `cloud_area_fraction`), `windGustSpeed` (from `wind_speed_of_gust`), `windGustFactor` (`calculateGustFactor`), `uvIndex` (from `ultraviolet_index_clear_sky`), `precipitationLastHour` (from `next_1_hours.details.precipitation_amount`, mm, no conversion), `description` (from the `symbol_code` via the `MET_NO_DESCRIPTIONS` map below), `severeCondition` (`metNoSevereCondition(symbol_code)`). No `visibility` (Met.no does not provide it).
- `timestamp`: the first entry's `time` via `asOpenMeteoTimestamp` (general ISO 8601 helper; Met.no emits ISO 8601 with a trailing `Z`, so it is a passthrough; add a one-line comment noting the helper is general-purpose, not Open-Meteo-specific).
- Description: Met.no has only `symbol_code`. Add a small typed `MET_NO_DESCRIPTIONS: ReadonlyMap<string, string>` keyed by the base `symbol_code` (suffix stripped), paralleling `WMO_DESCRIPTIONS` in `OpenMeteoMapper.ts`. Cover the common bases (clearsky, fair, partlycloudy, cloudy, fog, lightrain, rain, heavyrain, lightrainshowers, rainshowers, heavyrainshowers, lightsnow, snow, heavysnow, sleet, and the thunder compounds). Do NOT title-case the raw code at runtime: that yields unreadable strings like "Lightsnowshowers". Export the map so phase 2's forecast mapper reuses it.

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
              ultraviolet_index_clear_sky: 3,
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
    expect(wd.dewPoint).toBeCloseTo(283.15, 2);
    expect(wd.cloudCover).toBeCloseTo(0.25, 5);
    expect(wd.windGustSpeed).toBeCloseTo(8, 5);
    expect(wd.uvIndex).toBeCloseTo(3, 5);
    expect(wd.precipitationLastHour).toBeCloseTo(1.2, 5);
    expect(wd.severeCondition?.label).toBe('Snow');
    expect(typeof wd.beaufortScale).toBe('number');
    expect(wd.visibility).toBeUndefined(); // Met.no provides no visibility
  });
  it('maps a response that omits the optional fields (cloud, gust, uv, precip)', () => {
    const wd = mapMetNoCurrentToWeatherData({
      properties: {
        timeseries: [
          {
            time: '2026-06-22T12:00:00Z',
            data: {
              instant: { details: { air_temperature: 5, air_pressure_at_sea_level: 1000, relative_humidity: 80, dew_point_temperature: 2, wind_speed: 3, wind_from_direction: 270 } },
            },
          },
        ],
      },
    });
    expect(wd.temperature).toBeCloseTo(278.15, 2);
    expect(wd.cloudCover).toBeUndefined();
    expect(wd.uvIndex).toBeUndefined();
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

Model the file on `OpenMeteoMapper.ts` (the imports, a `requireNumber` helper, the module-level `sharedWindCalculator`, the recompute block, the optional-fields extractor, the `MET_NO_DESCRIPTIONS` map paralleling `WMO_DESCRIPTIONS`). Read `response.properties?.timeseries?.[0]`; throw `INVALID_WEATHER_DATA` if it or a required `instant.details` field is absent. Build the same `WeatherData` shape, omitting `visibility`. Use `metNoSevereCondition` for the severe condition and `MET_NO_DESCRIPTIONS.get(base)` for the description. Assign `precipitationLastHour` directly from `next_1_hours.details.precipitation_amount` with a `// mm, no conversion; WeatherData.precipitationLastHour is mm` comment.

- [ ] **Step 4: Run the gate and commit**

Run: `npm run validate` (green). Then:

```bash
git add src/mappers/MetNoMapper.ts src/__tests__/mappers/MetNoMapper.test.ts
git commit -m "feat: map the Met.no Locationforecast current block to internal WeatherData"
```

---

### Task 4: Add MetNoService and register the met-no provider

This task makes ALL the compile-coupled edits together (the `WeatherProviderId` union, the registry maps, the catalog entry, and the service) so the gate is green at its single commit.

**Files:**
- Create: `src/services/MetNoService.ts`
- Modify: `src/constants/notifications-shared.ts`, `src/providers/providerCatalog.ts`
- Test: `src/__tests__/services/MetNoService.test.ts` (create), `src/__tests__/constants/notifications-shared.test.ts` (extend)

**Interfaces:**
- Produces: `'met-no'` in `WeatherProviderId`, `WEATHER_PROVIDER_IDS`, `WEATHER_PROVIDER_LABELS` (`'met-no': 'Met.no (free, no API key, global; Nordic and European alerts)'`), `WEATHER_PROVIDER_REQUIRES_KEY` (`false`). `MetNoService implements CurrentWeatherProvider` (`name = 'Met.no'`, `sourceRef = 'met-no'`, `fetchCurrentWeather` GETs `/complete` with the contact UA, maps via `mapMetNoCurrentToWeatherData`, keyless quota/cache accessors return zero). `PROVIDER_CATALOG['met-no']` constructs it.

- [ ] **Step 1: Write the failing service and registry tests**

```ts
// src/__tests__/services/MetNoService.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { MetNoService } from '../../services/MetNoService.js';
import { createMockFetchResponse } from '../setup.js';

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
  it('fetches Locationforecast complete and maps to WeatherData with a contact User-Agent', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(createMockFetchResponse(SAMPLE));
    const svc = new MetNoService(() => {});
    const wd = await svc.fetchCurrentWeather({ latitude: 60, longitude: 11 });
    expect(wd.temperature).toBeCloseTo(293.15, 2);
    const call = (global.fetch as Mock).mock.calls[0];
    const url = String(call[0]);
    expect(url).toContain('/complete');
    const headers = (call[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('github.com');
    expect(svc.sourceRef).toBe('met-no');
    expect(svc.getRequestCount()).toBe(1);
    expect(svc.getRequestCountLast24h()).toBe(0);
  });
});
```

In `notifications-shared.test.ts`, add a describe block asserting `WEATHER_PROVIDER_IDS` contains `'met-no'`, `WEATHER_PROVIDER_LABELS['met-no']` is truthy, `providerRequiresApiKey('met-no')` is `false`, and `resolveWeatherProvider('met-no', false)` is `'met-no'`. Merge the new imports into the file's EXISTING import from `notifications-shared.js` (do not add a second `import` declaration for `WEATHER_PROVIDER_IDS`, which the file already imports).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/services/MetNoService.test.ts`
Expected: FAIL, `MetNoService` module not found.

- [ ] **Step 3: Add met-no to `notifications-shared.ts`**

Add `'met-no'` to the `WeatherProviderId` union, `WEATHER_PROVIDER_IDS` (after `accuweather`), `WEATHER_PROVIDER_LABELS`, and `WEATHER_PROVIDER_REQUIRES_KEY` (`'met-no': false`). The `Record<WeatherProviderId, ...>` types force the label and key-requirement entries at compile time.

- [ ] **Step 4: Create `MetNoService.ts`**

Model on `OpenMeteoService.ts`. Default base URL `https://api.met.no`, endpoint `/weatherapi/locationforecast/2.0/complete`, query `lat`/`lon` via `toFixed(4)` (at most 4 decimals to avoid the 403). Header `{ 'User-Agent': \`${PLUGIN.NAME}/${PLUGIN.VERSION} (+https://github.com/NearlCrews/signalk-virtual-weather-sensors)\` }`. Use the shared `fetchJson` from `utils/http.js`. `assertValidCoordinates` first, increment `requestCount`, fetch `MetNoLocationforecastResponse`, map via `mapMetNoCurrentToWeatherData`, and log `'MetNoService initialized'` with `{ baseUrl }` in the constructor and success/failure like `OpenMeteoService`. The quota and cache accessors return zero (keyless). Accept `options?: { baseUrl?: string; requestTimeoutMs?: number }` like `OpenMeteoOptions` for tests and a self-hosted host. No user config field for the base URL (Met.no is a single public host).

- [ ] **Step 5: Add the catalog entry**

In `providerCatalog.ts`, import `MetNoService` and add:

```ts
'met-no': {
  keyless: !providerRequiresApiKey('met-no'),
  construct: (config, logger) => new MetNoService(logger),
},
```

- [ ] **Step 6: Run the gate**

Run: `npm run validate`
Expected: green. `createCurrentWeatherProvider({ weatherProvider: 'met-no', ... })` builds a `MetNoService`. `supportsForecasts(new MetNoService())` is FALSE (phase 1 adds no forecast methods), so Met.no does not yet register the v2 provider, which is the correct phase-1 boundary.

- [ ] **Step 7: Commit**

```bash
git add src/services/MetNoService.ts src/constants/notifications-shared.ts src/providers/providerCatalog.ts src/__tests__/services/MetNoService.test.ts src/__tests__/constants/notifications-shared.test.ts
git commit -m "feat: add Met.no as a selectable keyless current-conditions provider"
```

---

### Task 5: Make the keyless config section provider-aware

**Files:**
- Modify: `src/configpanel/PluginConfigurationPanel.tsx`
- Test: panel type-check via the gate (the panel has no unit test harness; the type-check plus a focused assertion if feasible is the gate)

**Interfaces:**
- Consumes: the `met-no` provider id.

The keyless branch of the source section (`PluginConfigurationPanel.tsx:186-217`, the `needsKey ? <ApiKeyField/> : <>...</>` else-block) currently renders the Open-Meteo base-URL input and an "Weather data by Open-Meteo.com" attribution paragraph for ANY keyless provider, so selecting Met.no would show the wrong field and the wrong attribution. Make the base-URL field and the Open-Meteo attribution render only for Open-Meteo, and show a Met.no attribution for Met.no.

- [ ] **Step 1: Update the keyless branch**

Inside the `needsKey ? ... : (...)` else-block, gate the existing base-URL `<div>` and the Open-Meteo `<p>` on `form.weatherProvider === 'open-meteo'`, and add a Met.no branch for `form.weatherProvider === 'met-no'` rendering a help paragraph: `Weather data from the Norwegian Meteorological Institute (api.met.no, CC BY 4.0), no API key required. Global coverage, with Nordic and European weather alerts.` A clean shape:

```tsx
) : form.weatherProvider === 'open-meteo' ? (
  <>{/* the existing Open-Meteo base-URL field and attribution paragraph, unchanged */}</>
) : (
  <p style={S.help}>
    Weather data from the Norwegian Meteorological Institute (api.met.no, CC BY 4.0), no API key
    required. Global coverage, with Nordic and European weather alerts.
  </p>
)}
```

Keep the `needsKey` (capability-driven) outer fork for the key field; only the keyless inner content becomes provider-specific. Do not add a hex literal or a hardcoded color (use `S.help`).

- [ ] **Step 2: Run the gate**

Run: `npm run validate`
Expected: green, including `type-check:panel`. Selecting Met.no in the panel now shows the Met.no attribution and no base-URL field; Open-Meteo is unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/configpanel/PluginConfigurationPanel.tsx
git commit -m "fix: make the keyless config section show the selected provider's attribution"
```

---

### Task 6: Verify Met.no is selectable end to end

**Files:**
- Test: `src/__tests__/providers/createCurrentWeatherProvider.test.ts` (extend), `src/__tests__/providers/providerCatalog.test.ts` (extend)

- [ ] **Step 1: Extend the existing provider tests**

In `providerCatalog.test.ts`, add an explicit assertion that `PROVIDER_CATALOG['met-no'].construct(config, () => {}).sourceRef === 'met-no'` and `keyless === true` (the existing `WEATHER_PROVIDER_IDS` loop asserts the entry exists and constructs, but not its `sourceRef`). In `createCurrentWeatherProvider.test.ts`, add a case that `weatherProvider: 'met-no'` builds a provider whose `sourceRef` is `'met-no'`.

- [ ] **Step 2: Run the gate and commit**

Run: `npm run validate` (green). Then:

```bash
git add src/__tests__/providers/createCurrentWeatherProvider.test.ts src/__tests__/providers/providerCatalog.test.ts
git commit -m "test: cover Met.no provider construction and selection"
```

---

## Self-Review

Run after all tasks:

- [ ] `npm run validate` green: type-check (including panel), Biome, full Vitest (>= 470 plus the new severity, mapper, service, registry, and selection tests).
- [ ] The service uses the `/complete` endpoint (so `dew_point_temperature` and `ultraviolet_index_clear_sky` arrive), formats lat/lon to at most 4 decimals, and sends the contact User-Agent.
- [ ] `supportsForecasts(new MetNoService())` is FALSE (this phase is the current-conditions path only); selecting Met.no drives the live emission path, and the merge engine (Plan 3) receives its `WeatherData`.
- [ ] Met.no is selectable: `createCurrentWeatherProvider({ weatherProvider: 'met-no' })` builds a `MetNoService`, the picker renders it from `WEATHER_PROVIDER_IDS`, the key field is hidden via the capability fork, and the config section shows the Met.no attribution (not Open-Meteo's).
- [ ] The mapper omits `visibility`, produces the required `dewPoint`, recomputes the derived fields, and maps `precipitationLastHour` from `next_1_hours.details.precipitation_amount` without conversion.
- [ ] No red intermediate gate: the `WeatherProviderId` union edit lives only in Task 4 with the catalog entry.

## Hand-off

After phase 1, Met.no is a selectable keyless current-conditions provider, and its `WeatherData` is available to the Plan 3 merge engine. Phase 2 makes `MetNoService` forecast-capable (`getObservation`/`getHourlyForecast`/`getDailyForecast` + `forecastCapabilities`, with a Met.no v2 mapper that walks the timeseries into hourly points and derives daily min/max from the `next_6_hours`/`next_12_hours` blocks, since Met.no has no clean daily block), which auto-registers the v2 provider via the `supportsForecasts` gate. Phase 3 extends `WarningsService` region dispatch to Met.no MetAlerts for Nordic and European waters. A later politeness item is conditional `If-Modified-Since` requests per the Met.no terms. Then Plan 3, the synthesis merge engine, blends all three providers.
