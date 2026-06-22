# Open-Meteo v2 Weather API Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Open-Meteo full Signal K v2 Weather API support (observations, point and daily forecasts, and warnings) so a default keyless install registers a weather provider, making `/signalk/v2/api/weather/_providers` non-empty and flipping the panel "Weather API" card to On.

**Architecture:** This is additive feature work, not a refactor. `OpenMeteoService` gains `getObservation`, `getHourlyForecast`, `getDailyForecast`, and a declared `forecastCapabilities`, which makes `supportsForecasts(provider)` true for Open-Meteo. The plugin's existing registration gate in `index.ts` already registers any forecast-capable provider with a `WarningsService` wired in, so the v2 provider auto-registers under Open-Meteo with NO change to `index.ts` or `WeatherProviderAdapter`. A new pure `OpenMeteoForecastMapper` converts the Open-Meteo forecast response (a columnar parallel-array shape) into the SK v2 `WeatherData` envelope, paralleling the AccuWeather mappers in `WeatherProviderMapper.ts`. The SK-v2 wind block helper is shared between the two providers.

**Tech Stack:** TypeScript (strict, ES2023), ESM (NodeNext), Vitest, Biome, `@signalk/server-api` (peer, types only).

## Global Constraints

- ESM NodeNext: import sibling modules with the `.js` specifier even from `.ts` source.
- Node floor 20.18; `@signalk/server-api` is a types-only peer dependency.
- The SK v2 envelope is SI: temperatures K, pressure Pa, speeds m/s, angles radians in [0, 2π), humidity and cloud as 0..1 ratio, visibility m, precipitationVolume m. Open-Meteo specifics: the service requests `wind_speed_unit=ms`, so forecast and current wind speeds are already m/s (do NOT km/h-convert them); `visibility` is already meters (do NOT km-convert it, unlike the AccuWeather path); `pressure_msl` is hPa (use `millibarsToPA`); temperatures are Celsius (`celsiusToKelvin`); `cloud_cover` and `relative_humidity_2m` are percentages (`optionalPercentageToRatio`); `precipitation` is mm (`* UNITS.PRECIPITATION.MM_TO_M`).
- v2 ordering contract: `getForecasts` returns ASCENDING by date (the Open-Meteo `time` arrays are already ascending), `getObservations` returns a single-element array (descending trivially satisfied).
- Reuse, do not re-derive: use the hoisted `conversions.ts` helpers (`celsiusToKelvin`, `optionalPercentageToRatio`, `optionalCelsiusToKelvin`, `degreesToRadians`, `normalizeAngle0To2Pi`, `calculateAbsoluteHumidity`, `asOptionalNumber`, `millibarsToPA`) and the shared SK-v2 wind helper. Do not add a fourth copy of the wind-block or cloud-cover idioms.
- Text rule for all comments, commit messages, and docs: no em dashes (use a colon, a comma, or two sentences), use the Oxford comma, write the word "and" never "&", and never mention any AI or review process.
- Gate after every task: `npm run validate` (type-check including the panel, Biome, full Vitest). The suite is at 456 tests; only add tests, never reduce the count.
- Commit types: `feat:` for the tasks that add Open-Meteo v2 capability, `refactor:` for the shared-helper extraction (Task 2).

---

### Task 1: Add the Open-Meteo forecast response types

**Files:**
- Modify: `src/types/open-meteo-api.ts`
- Test: covered by later tasks (types alone have no runtime test)

**Interfaces:**
- Produces: `OpenMeteoForecastResponse` in `types/open-meteo-api.ts`, the columnar `/v1/forecast` shape with optional `hourly` and `daily` blocks. Each block is parallel arrays keyed by the requested variable, plus a `time: string[]`. All fields optional (Open-Meteo omits an unrequested or unavailable variable); array elements may be `number | null` for gaps.

- [ ] **Step 1: Add the type**

Append to `src/types/open-meteo-api.ts`, modeled on the existing `OpenMeteoCurrentResponse` doc-comment style:

```ts
/**
 * Open-Meteo `/v1/forecast` hourly and daily blocks. Columnar: each variable is
 * a parallel array indexed by position in `time`. All optional, and elements may
 * be null where Open-Meteo has a gap. Units match the current block (wind m/s via
 * `wind_speed_unit=ms`, visibility meters, `pressure_msl` hPa, temperatures
 * Celsius, `cloud_cover` and `relative_humidity_2m` percent, `precipitation` mm).
 */
export interface OpenMeteoForecastResponse {
  readonly hourly?: {
    readonly time?: ReadonlyArray<string>;
    readonly temperature_2m?: ReadonlyArray<number | null>;
    readonly relative_humidity_2m?: ReadonlyArray<number | null>;
    readonly dew_point_2m?: ReadonlyArray<number | null>;
    readonly apparent_temperature?: ReadonlyArray<number | null>;
    readonly precipitation?: ReadonlyArray<number | null>;
    readonly weather_code?: ReadonlyArray<number | null>;
    readonly cloud_cover?: ReadonlyArray<number | null>;
    readonly pressure_msl?: ReadonlyArray<number | null>;
    readonly wind_speed_10m?: ReadonlyArray<number | null>;
    readonly wind_direction_10m?: ReadonlyArray<number | null>;
    readonly wind_gusts_10m?: ReadonlyArray<number | null>;
    readonly visibility?: ReadonlyArray<number | null>;
    readonly uv_index?: ReadonlyArray<number | null>;
  };
  readonly daily?: {
    readonly time?: ReadonlyArray<string>;
    readonly temperature_2m_max?: ReadonlyArray<number | null>;
    readonly temperature_2m_min?: ReadonlyArray<number | null>;
    readonly precipitation_sum?: ReadonlyArray<number | null>;
    readonly weather_code?: ReadonlyArray<number | null>;
    readonly wind_speed_10m_max?: ReadonlyArray<number | null>;
    readonly wind_direction_10m_dominant?: ReadonlyArray<number | null>;
    readonly wind_gusts_10m_max?: ReadonlyArray<number | null>;
    readonly uv_index_max?: ReadonlyArray<number | null>;
    readonly sunrise?: ReadonlyArray<string>;
    readonly sunset?: ReadonlyArray<string>;
  };
}
```

- [ ] **Step 2: Run the gate**

Run: `npm run validate`
Expected: green (a type-only addition; the barrel `types/index.js` re-exports it via `export type * from './open-meteo-api.js'`).

- [ ] **Step 3: Commit**

```bash
git add src/types/open-meteo-api.ts
git commit -m "feat: add the Open-Meteo forecast response type"
```

---

### Task 2: Share the SK-v2 wind-block helper across providers

**Files:**
- Create: `src/mappers/skV2WindHelper.ts`
- Modify: `src/mappers/WeatherProviderMapper.ts` (use the shared helper)
- Test: `src/__tests__/mappers/skV2WindHelper.test.ts` (create)

**Interfaces:**
- Produces: `buildWindFromMs(speedMs, directionDeg, gustMs): SKWind | undefined` and the `SKWind`/`SKOutside`/`SKSun` type aliases in `src/mappers/skV2WindHelper.ts`. `buildWindFromMs` takes wind speeds already in m/s (the Open-Meteo unit), converts the direction degrees to radians normalized into [0, 2π), and omits absent fields. The existing AccuWeather `buildWind(speedKmh, directionDeg, gustKmh)` becomes a thin wrapper that `kmhToMS`-converts then delegates to `buildWindFromMs`, so there is one wind-block assembly.

The current `buildWind` in `WeatherProviderMapper.ts:98-111` converts km/h to m/s inline (`kmhToMS(speedKmh)`). Open-Meteo speeds are already m/s, so it cannot be reused directly. Extracting the m/s core gives both providers one assembly.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/mappers/skV2WindHelper.test.ts
import { describe, expect, it } from 'vitest';
import { buildWindFromMs } from '../../mappers/skV2WindHelper.js';

describe('buildWindFromMs', () => {
  it('passes m/s speeds through and converts the direction to radians in [0, 2pi)', () => {
    const wind = buildWindFromMs(5, 90, 8);
    expect(wind?.speedTrue).toBeCloseTo(5, 5);
    expect(wind?.gust).toBeCloseTo(8, 5);
    expect(wind?.directionTrue).toBeCloseTo(Math.PI / 2, 5);
  });
  it('omits absent fields and returns undefined when nothing is present', () => {
    expect(buildWindFromMs(5, null, null)).toEqual({ speedTrue: 5 });
    expect(buildWindFromMs(null, null, null)).toBeUndefined();
  });
  it('normalizes a 360 degree direction to 0, not 2pi', () => {
    expect(buildWindFromMs(null, 360, null)?.directionTrue).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/mappers/skV2WindHelper.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `skV2WindHelper.ts`**

```ts
/**
 * Shared SK v2 Weather API envelope helpers. The wind-block assembly is shared
 * by every provider mapper so the m/s conversion and the [0, 2pi) direction
 * normalization live in one place. Speeds are m/s here; a provider whose source
 * is km/h converts before calling (see WeatherProviderMapper.buildWind).
 */
import type { WeatherData as SKWeatherData } from '@signalk/server-api';
import { degreesToRadians, normalizeAngle0To2Pi } from '../utils/conversions.js';

export type SKOutside = NonNullable<SKWeatherData['outside']>;
export type SKWind = NonNullable<SKWeatherData['wind']>;
export type SKSun = NonNullable<SKWeatherData['sun']>;

/** Build the SK v2 wind block from m/s speeds and a degree direction, omitting absent fields. */
export function buildWindFromMs(
  speedMs: number | null | undefined,
  directionDeg: number | null | undefined,
  gustMs: number | null | undefined
): SKWind | undefined {
  const wind: SKWind = {
    ...(typeof speedMs === 'number' && { speedTrue: speedMs }),
    ...(typeof directionDeg === 'number' && {
      directionTrue: normalizeAngle0To2Pi(degreesToRadians(directionDeg)),
    }),
    ...(typeof gustMs === 'number' && { gust: gustMs }),
  };
  return Object.keys(wind).length > 0 ? wind : undefined;
}
```

- [ ] **Step 4: Refactor `WeatherProviderMapper.ts` to delegate**

Replace the private `buildWind` body (lines 98-111) so it converts km/h then delegates, and import the helper plus the `SKOutside`/`SKWind`/`SKSun` aliases from `./skV2WindHelper.js` (delete the local `SKOutside`/`SKWind`/`SKSun` type aliases at the top of `WeatherProviderMapper.ts` and import them instead):

```ts
import { buildWindFromMs, type SKOutside, type SKSun, type SKWind } from './skV2WindHelper.js';

function buildWind(
  speedKmh: number | null | undefined,
  directionDegrees: number | null | undefined,
  gustKmh: number | null | undefined
): SKWind | undefined {
  return buildWindFromMs(
    typeof speedKmh === 'number' ? kmhToMS(speedKmh) : speedKmh,
    directionDegrees,
    typeof gustKmh === 'number' ? kmhToMS(gustKmh) : gustKmh
  );
}
```

Keep `kmhToMS` imported in `WeatherProviderMapper.ts` (still used here). `degreesToRadians`/`normalizeAngle0To2Pi` may become unused in `WeatherProviderMapper.ts` if `buildWind` was their only user; drop them if the gate flags them.

- [ ] **Step 5: Run the gate**

Run: `npm run validate`
Expected: green. The existing AccuWeather forecast and observation mapper tests pass unchanged (the wind output is identical, just routed through the shared core), plus the new helper tests.

- [ ] **Step 6: Commit**

```bash
git add src/mappers/skV2WindHelper.ts src/mappers/WeatherProviderMapper.ts src/__tests__/mappers/skV2WindHelper.test.ts
git commit -m "refactor: share the SK v2 wind-block helper across provider mappers"
```

---

### Task 3: Create the Open-Meteo v2 forecast mapper

**Files:**
- Create: `src/mappers/OpenMeteoForecastMapper.ts`
- Test: `src/__tests__/mappers/OpenMeteoForecastMapper.test.ts` (create)

**Interfaces:**
- Consumes: `OpenMeteoForecastResponse`, `OpenMeteoCurrentResponse` (types); `buildWindFromMs`/`SKOutside`/`SKSun` (Task 2); the `conversions.ts` helpers; the WMO description map (export `WMO_DESCRIPTIONS` from `OpenMeteoMapper.ts` and import it here, OR move it into a small shared `mappers/wmoDescriptions.ts` that both import, to avoid a second copy).
- Produces three pure functions returning the SK v2 envelope (`WeatherData` from `@signalk/server-api`, aliased `SKWeatherData`):
  - `mapOpenMeteoCurrentToObservation(response: OpenMeteoCurrentResponse): SKWeatherData` (`type: 'observation'`, with `pressure` and `cloudCover` the current block carries)
  - `mapOpenMeteoHourlyToForecasts(response: OpenMeteoForecastResponse): SKWeatherData[]` (`type: 'point'`, ascending)
  - `mapOpenMeteoDailyToForecasts(response: OpenMeteoForecastResponse): SKWeatherData[]` (`type: 'daily'`, ascending, min/max temp plus sun)

The Open-Meteo forecast shape is COLUMNAR: iterate `block.time` by index and read each parallel array at that index (guarding `?.[i]`). This differs from the AccuWeather array-of-objects shape, so the iteration is index-based.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/mappers/OpenMeteoForecastMapper.test.ts
import { describe, expect, it } from 'vitest';
import {
  mapOpenMeteoCurrentToObservation,
  mapOpenMeteoDailyToForecasts,
  mapOpenMeteoHourlyToForecasts,
} from '../../mappers/OpenMeteoForecastMapper.js';

describe('OpenMeteoForecastMapper', () => {
  it('maps the hourly block to ascending SI point forecasts', () => {
    const out = mapOpenMeteoHourlyToForecasts({
      hourly: {
        time: ['2026-06-22T00:00', '2026-06-22T01:00'],
        temperature_2m: [20, 19],
        relative_humidity_2m: [50, 55],
        wind_speed_10m: [5, 6],
        wind_direction_10m: [90, 180],
        cloud_cover: [25, 50],
        visibility: [10000, 8000],
      },
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.type).toBe('point');
    expect(out[0]?.date).toBe('2026-06-22T00:00');
    expect(out[0]?.outside?.temperature).toBeCloseTo(293.15, 2);
    expect(out[0]?.outside?.relativeHumidity).toBeCloseTo(0.5, 5);
    expect(out[0]?.outside?.cloudCover).toBeCloseTo(0.25, 5);
    expect(out[0]?.outside?.horizontalVisibility).toBe(10000); // already meters, no conversion
    expect(out[0]?.wind?.speedTrue).toBeCloseTo(5, 5); // already m/s
    expect(out[1]?.date).toBe('2026-06-22T01:00');
  });
  it('maps the daily block to min/max temps and sun', () => {
    const out = mapOpenMeteoDailyToForecasts({
      daily: {
        time: ['2026-06-22'],
        temperature_2m_min: [12],
        temperature_2m_max: [24],
        sunrise: ['2026-06-22T05:00'],
        sunset: ['2026-06-22T21:00'],
      },
    });
    expect(out[0]?.type).toBe('daily');
    expect(out[0]?.outside?.minTemperature).toBeCloseTo(285.15, 2);
    expect(out[0]?.outside?.maxTemperature).toBeCloseTo(297.15, 2);
    expect(out[0]?.sun?.sunrise).toBe('2026-06-22T05:00');
  });
  it('maps a current block to a single observation with pressure', () => {
    const obs = mapOpenMeteoCurrentToObservation({
      current: { time: '2026-06-22T00:00', temperature_2m: 20, pressure_msl: 1013, wind_speed_10m: 5, wind_direction_10m: 90 },
    });
    expect(obs.type).toBe('observation');
    expect(obs.outside?.temperature).toBeCloseTo(293.15, 2);
    expect(obs.outside?.pressure).toBeCloseTo(101300, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/mappers/OpenMeteoForecastMapper.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `OpenMeteoForecastMapper.ts`**

Implement the three functions. The columnar hourly mapper:

```ts
export function mapOpenMeteoHourlyToForecasts(response: OpenMeteoForecastResponse): SKWeatherData[] {
  const h = response.hourly;
  const times = h?.time ?? [];
  return times.map((date, i) => {
    const temperatureK = optionalCelsiusToKelvin(h?.temperature_2m?.[i]);
    const dewPointK = optionalCelsiusToKelvin(h?.dew_point_2m?.[i]);
    const feelsLikeK = optionalCelsiusToKelvin(h?.apparent_temperature?.[i]);
    const rhRatio = optionalPercentageToRatio(h?.relative_humidity_2m?.[i]);
    const visibilityM = asOptionalNumber(h?.visibility?.[i]); // already meters
    const cloudCover = optionalPercentageToRatio(h?.cloud_cover?.[i]);
    const uvIndex = asOptionalNumber(h?.uv_index?.[i]);
    const precipitationMm = asOptionalNumber(h?.precipitation?.[i]);
    const weatherCode = asOptionalNumber(h?.weather_code?.[i]);
    const description = weatherCode !== undefined ? WMO_DESCRIPTIONS.get(weatherCode) : undefined;

    const outside: SKOutside = {
      ...(temperatureK !== undefined && { temperature: temperatureK }),
      ...(dewPointK !== undefined && { dewPointTemperature: dewPointK }),
      ...(feelsLikeK !== undefined && { feelsLikeTemperature: feelsLikeK }),
      ...(rhRatio !== undefined && {
        relativeHumidity: rhRatio,
        ...(temperatureK !== undefined && { absoluteHumidity: calculateAbsoluteHumidity(temperatureK, rhRatio) }),
      }),
      ...(visibilityM !== undefined && { horizontalVisibility: visibilityM }),
      ...(cloudCover !== undefined && { cloudCover }),
      ...(uvIndex !== undefined && { uvIndex }),
      ...(precipitationMm !== undefined && { precipitationVolume: precipitationMm * UNITS.PRECIPITATION.MM_TO_M }),
    };
    const wind = buildWindFromMs(h?.wind_speed_10m?.[i], h?.wind_direction_10m?.[i], h?.wind_gusts_10m?.[i]);
    return {
      date,
      type: 'point',
      ...(description !== undefined && { description }),
      outside,
      ...(wind !== undefined && { wind }),
    };
  });
}
```

The daily mapper follows the same columnar pattern over `response.daily.time`, building `minTemperature`/`maxTemperature` from `temperature_2m_min`/`max`, `precipitationVolume` from `precipitation_sum`, `uvIndex` from `uv_index_max`, the wind from `wind_speed_10m_max`/`wind_direction_10m_dominant`/`wind_gusts_10m_max`, a description from `weather_code`, and an `SKSun` from `sunrise[i]`/`sunset[i]` (omit `sun` when both absent), with `type: 'daily'`.

The observation mapper reads `response.current` (the same `OpenMeteoCurrentResponse` shape the service already fetches), building the same `outside` as the hourly point PLUS `pressure` (`millibarsToPA(pressure_msl)`), with `type: 'observation'` and the current `time` as `date`. It does not throw on a missing field (every leaf is conditionally spread); an empty `current` yields `{ date: undefined-or-empty, type: 'observation', outside: {} }`, which is acceptable for the v2 endpoint. Reuse `asOpenMeteoTimestamp` for the `date` if `current.time` may be absent.

Note: Open-Meteo carries no plain-language precipitation type, so `precipitationType` is omitted from the v2 envelope here (a WMO-code to `PrecipitationKind` map is a later enhancement). The wind direction goes through `buildWindFromMs` (degrees to radians, normalized).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/mappers/OpenMeteoForecastMapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the gate and commit**

Run: `npm run validate` (green). Then:

```bash
git add src/mappers/OpenMeteoForecastMapper.ts src/mappers/OpenMeteoMapper.ts src/__tests__/mappers/OpenMeteoForecastMapper.test.ts
git commit -m "feat: map the Open-Meteo forecast and observation blocks to the v2 envelope"
```

(Include `OpenMeteoMapper.ts` in the add if you exported `WMO_DESCRIPTIONS` from it; if you instead moved the map to a new `mappers/wmoDescriptions.ts`, add that file and adjust both importers.)

---

### Task 4: Make OpenMeteoService forecast-capable

**Files:**
- Modify: `src/services/OpenMeteoService.ts`
- Test: `src/__tests__/services/OpenMeteoService.test.ts` (extend)

**Interfaces:**
- Consumes: the Task 3 mappers; `OpenMeteoForecastResponse` (Task 1).
- Produces on `OpenMeteoService`: `forecastCapabilities = { hourlyHours: 48, dailyDays: 7 }`; `getObservation(loc): Promise<SKWeatherData>`; `getHourlyForecast(loc): Promise<SKWeatherData[]>`; `getDailyForecast(loc): Promise<SKWeatherData[]>`. The class now structurally satisfies `ForecastCapableProvider`, so `supportsForecasts(openMeteoService)` is true and `index.ts` auto-registers the v2 provider with no change there.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/services/OpenMeteoService.test.ts (add)
import { supportsForecasts } from '../../providers/WeatherProvider.js';

describe('OpenMeteoService v2 capability', () => {
  it('declares its forecast horizon and is forecast-capable', () => {
    const svc = new OpenMeteoService(() => {});
    expect(svc.forecastCapabilities).toEqual({ hourlyHours: 48, dailyDays: 7 });
    expect(supportsForecasts(svc)).toBe(true);
  });
});
```

Add a fetch-mocked test that `getHourlyForecast` returns ascending point forecasts, modeled on the existing `OpenMeteoService.test.ts` fetch-mock idiom (it already mocks `fetchJson`/global `fetch` for `fetchCurrentWeather`; reuse that setup with a forecast-shaped response body).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/services/OpenMeteoService.test.ts -t "v2 capability"`
Expected: FAIL, `forecastCapabilities` undefined.

- [ ] **Step 3: Implement on `OpenMeteoService`**

Add the import of the three Task 3 mappers and the `SKWeatherData` alias (`import type { WeatherData as SKWeatherData } from '@signalk/server-api';`) and `OpenMeteoForecastResponse`. Add hourly and daily param lists alongside `CURRENT_PARAMS`:

```ts
const HOURLY_PARAMS = [
  'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'apparent_temperature',
  'precipitation', 'weather_code', 'cloud_cover', 'pressure_msl',
  'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'visibility', 'uv_index',
].join(',');
const DAILY_PARAMS = [
  'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'weather_code',
  'wind_speed_10m_max', 'wind_direction_10m_dominant', 'wind_gusts_10m_max',
  'uv_index_max', 'sunrise', 'sunset',
].join(',');
const HOURLY_FORECAST_DAYS = 2; // 48 hours, matching forecastCapabilities.hourlyHours
const DAILY_FORECAST_DAYS = 7;
```

Add the methods. They build a forecast URL (the same base as `buildUrl` but with `hourly=`/`daily=` and `forecast_days=` instead of, or in addition to, `current=`), fetch `OpenMeteoForecastResponse`, increment `requestCount`, and map. Factor a private `buildForecastUrl(location, params: { hourly?: string; daily?: string; forecastDays: number })` from the existing `buildUrl` (keep `wind_speed_unit=ms` and `timezone=GMT`):

```ts
public readonly forecastCapabilities = { hourlyHours: 48, dailyDays: 7 } as const;

public async getObservation(location: GeoLocation): Promise<SKWeatherData> {
  assertValidCoordinates(location, 'Open-Meteo observation');
  this.requestCount++;
  const response = await fetchJson<OpenMeteoCurrentResponse>(this.buildUrl(location), {
    timeoutMs: this.requestTimeoutMs,
    headers: { 'User-Agent': `${PLUGIN.NAME}/${PLUGIN.VERSION}` },
  });
  return mapOpenMeteoCurrentToObservation(response);
}

public async getHourlyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
  assertValidCoordinates(location, 'Open-Meteo hourly forecast');
  this.requestCount++;
  const url = this.buildForecastUrl(location, { hourly: HOURLY_PARAMS, forecastDays: HOURLY_FORECAST_DAYS });
  const response = await fetchJson<OpenMeteoForecastResponse>(url, {
    timeoutMs: this.requestTimeoutMs,
    headers: { 'User-Agent': `${PLUGIN.NAME}/${PLUGIN.VERSION}` },
  });
  return mapOpenMeteoHourlyToForecasts(response);
}

public async getDailyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
  assertValidCoordinates(location, 'Open-Meteo daily forecast');
  this.requestCount++;
  const url = this.buildForecastUrl(location, { daily: DAILY_PARAMS, forecastDays: DAILY_FORECAST_DAYS });
  const response = await fetchJson<OpenMeteoForecastResponse>(url, {
    timeoutMs: this.requestTimeoutMs,
    headers: { 'User-Agent': `${PLUGIN.NAME}/${PLUGIN.VERSION}` },
  });
  return mapOpenMeteoDailyToForecasts(response);
}
```

`buildForecastUrl` mirrors `buildUrl` (latitude, longitude, `wind_speed_unit=ms`, `timezone=GMT`) and sets `hourly`/`daily` and `forecast_days` from the args. Wrap each method's fetch in the same try/log/throw pattern `fetchCurrentWeather` uses, or keep them lean (the adapter logs at debug); match the existing style.

- [ ] **Step 4: Run the gate**

Run: `npm run validate`
Expected: green. The new capability and forecast tests pass, and `fetchCurrentWeather` (the live emission path) is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/services/OpenMeteoService.ts src/__tests__/services/OpenMeteoService.test.ts
git commit -m "feat: make Open-Meteo serve v2 observations and forecasts"
```

---

### Task 5: Verify the default install registers the v2 provider

**Files:**
- Test: `src/__tests__/index.test.ts` (extend) or `src/__tests__/integration/*` as fits the existing structure

**Interfaces:**
- Consumes: the now forecast-capable `OpenMeteoService`; the unchanged `index.ts` registration path.

This task adds NO production code: it proves the seam delivers the feature. With Open-Meteo (the default provider) now forecast-capable, `startServices` should call `app.registerWeatherProvider` and set `weatherProviderRegistered = true`, and the `/api/status` endpoint should report `weatherProviderRegistered: true`.

- [ ] **Step 1: Write the test**

Add to `index.test.ts` (model on its existing plugin start/registration coverage): start the plugin with a default Open-Meteo config (no AccuWeather key), assert `app.registerWeatherProvider` was called, and that `GET /api/status` returns `weatherProviderRegistered: true`. If the existing test harness already starts the plugin and inspects registration for AccuWeather, mirror it for the Open-Meteo default.

```ts
it('registers the v2 weather provider on a default Open-Meteo install', async () => {
  // Use the harness's plugin-start helper with weatherProvider 'open-meteo' (the default).
  // Assert registerWeatherProvider was invoked and the status flag is true.
  // (Model the exact setup on the existing registration test in this file.)
});
```

- [ ] **Step 2: Run the gate**

Run: `npm run validate`
Expected: green; the new test passes, confirming the default install now advertises a weather provider.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/index.test.ts
git commit -m "test: cover v2 provider registration on a default Open-Meteo install"
```

---

## Self-Review

Run after all tasks:

- [ ] `npm run validate` green: type-check (including panel), Biome, full Vitest (>= 456 plus the new helper, mapper, service, and registration tests).
- [ ] `OpenMeteoService` structurally satisfies `ForecastCapableProvider`: `supportsForecasts(new OpenMeteoService())` is true.
- [ ] No `index.ts` or `WeatherProviderAdapter` change was needed (the registration gate did the work); confirm the diff does not touch them.
- [ ] The Open-Meteo v2 mappers do NOT km/h-convert wind (already m/s) or km-convert visibility (already meters), and they go through the shared `buildWindFromMs`. There is no fourth copy of the wind-block idiom.
- [ ] Forecasts are ascending (the Open-Meteo `time` arrays drive the order); the observation is a single element.
- [ ] The live emission path (`fetchCurrentWeather` to internal `WeatherData`) is unchanged; only the new v2 methods were added.

## Hand-off

After this plan, a default keyless Open-Meteo install advertises a weather provider (non-empty `/signalk/v2/api/weather/_providers`) serving observations, point and daily forecasts (48h and 7d, declared via `forecastCapabilities`), and region-aware warnings (NWS for US waters via the already-wired `WarningsService`). The panel "Weather API" card shows On. Deferred follow-ons noted in the design spec: the v2 `water` block populated from `MarineData` at adapter time when the marine layer is enabled, a WMO-code to `precipitationType` map for richer Open-Meteo forecasts, optional forecast caching (Open-Meteo is keyless and unmetered, so this is politeness not necessity), and Open-Meteo `startDate` support for `getForecasts`. The remaining feature work is Plan 3, the synthesis merge engine.
