# Multi-Provider Weather, Plan 1: Foundation Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the provider seam, config model, and registration wiring so the plugin is provider-agnostic and ready for Open-Meteo v2 parity (Plan 2) and a merge mode (Plan 3), with zero change to runtime behavior.

**Architecture:** Split the single `CurrentWeatherProvider` into three capability tiers, retarget the v2 adapter from the concrete `AccuWeatherService` to the interface, introduce a `weatherMode` config field and a `PROVIDER_CATALOG` construction registry, and remove the three AccuWeather-specific couplings (`instanceof` guard, hardcoded fallback, `PLUGIN.SOURCE_REF`/`PROVIDER_NAME`). No new user-visible behavior: AccuWeather still registers the v2 provider, Open-Meteo still does not, and every existing `$source` is unchanged.

**Tech Stack:** TypeScript (strict, ES2023), ESM (NodeNext), Vitest, Biome, `@signalk/server-api` (peer, types only).

## Global Constraints

- ESM NodeNext: import sibling modules with the `.js` specifier even from `.ts` source (e.g. `import { x } from './foo.js'`).
- Node floor is 20.18; do not use newer-than-Node-20 APIs.
- `@signalk/server-api` is a peerDependency, types only, never bundled.
- Panel-safe rule: `src/constants/notifications-shared.ts` must NOT import any Node-only service (the webpack panel build compiles it). Construction logic that imports services lives under `src/providers/`.
- SI units throughout: m/s, radians, Kelvin, Pa, ratio 0..1.
- Text rule for all comments, commit messages, and docs: no em dashes (use a colon, a comma, or two sentences), use the Oxford comma, write the word "and" never "&", and never mention any AI or review process.
- Gate after every task: `npm run validate` (type-check, Biome, full Vitest run) must be green. The suite currently has 418 tests; this plan only adds tests and must never reduce the count.
- Behavior-preserving commits use the `refactor:` conventional type; new config plumbing uses `feat:`.

---

### Task 1: Add the three-tier provider capability interfaces

**Files:**
- Modify: `src/providers/WeatherProvider.ts`
- Test: `src/__tests__/providers/WeatherProvider.test.ts` (create)

**Interfaces:**
- Produces: `ObservationCapableProvider`, `ForecastCapableProvider`, `ForecastCapabilities`, and runtime guards `supportsObservations(p)`, `supportsForecasts(p)`. Forecast methods return the Signal K envelope (`WeatherData` from `@signalk/server-api`, aliased `SKWeatherData`) so the adapter is provider-agnostic.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/providers/WeatherProvider.test.ts
import { describe, expect, it } from 'vitest';
import {
  type CurrentWeatherProvider,
  type ForecastCapableProvider,
  supportsForecasts,
  supportsObservations,
} from '../../providers/WeatherProvider.js';
import type { GeoLocation, WeatherData } from '../../types/index.js';

const currentOnly: CurrentWeatherProvider = {
  name: 'Current Only',
  sourceRef: 'current-only',
  fetchCurrentWeather: async (_l: GeoLocation): Promise<WeatherData> => {
    throw new Error('unused');
  },
  getRequestCount: () => 0,
  getRequestCountLast24h: () => 0,
  getCacheStats: () => ({ size: 0 }),
};

const full: ForecastCapableProvider = {
  ...currentOnly,
  name: 'Full',
  sourceRef: 'full',
  forecastCapabilities: { hourlyHours: 12, dailyDays: 5 },
  getObservation: async () => ({}) as never,
  getHourlyForecast: async () => [],
  getDailyForecast: async () => [],
};

describe('provider capability guards', () => {
  it('supportsObservations is false for a current-only provider', () => {
    expect(supportsObservations(currentOnly)).toBe(false);
  });
  it('supportsObservations and supportsForecasts are true for a full provider', () => {
    expect(supportsObservations(full)).toBe(true);
    expect(supportsForecasts(full)).toBe(true);
  });
  it('supportsForecasts is false when only getObservation is present', () => {
    const obsOnly = { ...currentOnly, getObservation: async () => ({}) as never };
    expect(supportsObservations(obsOnly)).toBe(true);
    expect(supportsForecasts(obsOnly)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/providers/WeatherProvider.test.ts`
Expected: FAIL, `supportsForecasts`/`supportsObservations` not exported.

- [ ] **Step 3: Append the interfaces and guards to `src/providers/WeatherProvider.ts`**

Add this below the existing `CurrentWeatherProvider` interface (keep `CurrentWeatherProvider` exactly as-is). Add the import for the SK envelope at the top of the file.

```ts
// at the top, alongside the existing internal-type import:
import type { WeatherData as SKWeatherData } from '@signalk/server-api';

// at the bottom of the file:

/** Forecast window a provider declares about itself, read by the v2 adapter. */
export interface ForecastCapabilities {
  /** Hours of hourly (point) forecast the provider serves. */
  readonly hourlyHours: number;
  /** Days of daily forecast the provider serves. */
  readonly dailyDays: number;
}

/**
 * A provider that can serve a single current observation in the Signal K v2
 * envelope, in addition to the live emission path. Open-Meteo and AccuWeather
 * both implement this; a minimal source might implement only the base tier.
 */
export interface ObservationCapableProvider extends CurrentWeatherProvider {
  /** Current conditions at an arbitrary position, in the SK v2 WeatherData shape. */
  getObservation(location: GeoLocation): Promise<SKWeatherData>;
}

/**
 * A provider that additionally serves point (hourly) and daily forecasts in the
 * SK v2 envelope, and declares its own forecast horizon. Forecast arrays are
 * ascending by date, per the v2 contract.
 */
export interface ForecastCapableProvider extends ObservationCapableProvider {
  readonly forecastCapabilities: ForecastCapabilities;
  getHourlyForecast(location: GeoLocation): Promise<SKWeatherData[]>;
  getDailyForecast(location: GeoLocation): Promise<SKWeatherData[]>;
}

/** Narrow a base provider to one that can serve a v2 observation. */
export function supportsObservations(
  provider: CurrentWeatherProvider
): provider is ObservationCapableProvider {
  return typeof (provider as ObservationCapableProvider).getObservation === 'function';
}

/** Narrow a base provider to one that can serve v2 forecasts. */
export function supportsForecasts(
  provider: CurrentWeatherProvider
): provider is ForecastCapableProvider {
  const p = provider as ForecastCapableProvider;
  return (
    typeof p.getHourlyForecast === 'function' &&
    typeof p.getDailyForecast === 'function' &&
    typeof p.getObservation === 'function'
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/providers/WeatherProvider.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/WeatherProvider.ts src/__tests__/providers/WeatherProvider.test.ts
git commit -m "refactor: add observation and forecast provider capability tiers"
```

---

### Task 2: Remove the AccuWeather-hardcoded plugin constants

**Files:**
- Modify: `src/constants/index.ts` (remove `SOURCE_REF` and `PROVIDER_NAME` from `PLUGIN`)
- Modify: `src/services/AccuWeatherService.ts:233-235` (inline the literals)
- Modify: `src/utils/skDelta.ts:25-26` (define the default source locally)
- Modify: `src/index.ts:115` (use the local default source)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ACCUWEATHER_SOURCE` still exported from `skDelta.ts` with the same value `'accuweather'`, now defined locally rather than from `PLUGIN.SOURCE_REF`.

This is behavior-preserving: the runtime `$source` is already provider-driven (`index.ts:412` overwrites with `provider.sourceRef`); these constants are only an init default and AccuWeather's own identity.

- [ ] **Step 1: Inline the literals in `AccuWeatherService.ts`**

Replace lines 233-235:

```ts
  /** Provider name for the v2 registration and logs. */
  public readonly name = 'AccuWeather';
  /** `$source` stamped on AccuWeather-sourced deltas. */
  public readonly sourceRef = 'accuweather';
```

- [ ] **Step 2: Define the default source locally in `skDelta.ts`**

Replace lines 25-26:

```ts
/** Default `$source` ref for deltas built without an explicit source (fallback only; live callers pass the active provider's ref). */
export const ACCUWEATHER_SOURCE = 'accuweather' as SourceRef;
```

- [ ] **Step 3: Use the local default in `index.ts`**

At `index.ts:115`, replace `sourceRef: toSourceRef(PLUGIN.SOURCE_REF),` with:

```ts
    sourceRef: toSourceRef('accuweather'),
```

- [ ] **Step 4: Remove the constants from `constants/index.ts`**

Delete the `SOURCE_REF: 'accuweather',` and `PROVIDER_NAME: 'AccuWeather',` properties (and their doc comments) from the `PLUGIN` object at lines 47-58.

- [ ] **Step 5: Run the gate**

Run: `npm run validate`
Expected: type-check finds zero remaining references to `PLUGIN.SOURCE_REF`/`PLUGIN.PROVIDER_NAME` (the adapter use at `WeatherProviderAdapter.ts:37` is fixed in Task 4; if type-check fails there, proceed to Task 4 before committing, or temporarily set `name: provider name` per Task 4). Biome clean, 418 tests pass.

Note: `WeatherProviderAdapter.ts:37` references `PLUGIN.PROVIDER_NAME`. To keep this task self-contained, change that single line now to the literal `name: 'AccuWeather',` (Task 4 replaces it with `provider.name`).

- [ ] **Step 6: Commit**

```bash
git add src/constants/index.ts src/services/AccuWeatherService.ts src/utils/skDelta.ts src/index.ts src/services/WeatherProviderAdapter.ts
git commit -m "refactor: drop AccuWeather-hardcoded plugin source constants"
```

---

### Task 3: AccuWeatherService implements ForecastCapableProvider

**Files:**
- Modify: `src/services/AccuWeatherService.ts` (rename raw fetchers, add SK-envelope methods, add `forecastCapabilities`)
- Test: `src/__tests__/services/AccuWeatherService.test.ts` (extend)

**Interfaces:**
- Consumes: existing `mapCurrentToObservation`, `mapHourlyToForecasts`, `mapDailyToForecasts` from `src/mappers/WeatherProviderMapper.js`; existing private fetch logic.
- Produces on `AccuWeatherService`: `forecastCapabilities = { hourlyHours: 12, dailyDays: 5 }`; `getObservation(loc): Promise<SKWeatherData>`; `getHourlyForecast(loc): Promise<SKWeatherData[]>` (ascending); `getDailyForecast(loc): Promise<SKWeatherData[]>` (ascending). The raw fetchers are renamed `fetchHourlyForecastRaw`/`fetchDailyForecastRaw`/`fetchCurrentConditionsRaw`.

The mapping currently lives in `WeatherProviderAdapter`. This moves it into the provider so the adapter becomes provider-agnostic (Task 4).

- [ ] **Step 1: Write the failing test**

```ts
// add to src/__tests__/services/AccuWeatherService.test.ts
import { supportsForecasts } from '../../providers/WeatherProvider.js';

describe('AccuWeatherService forecast capability', () => {
  it('declares the AccuWeather 12h/5d horizon and is forecast-capable', () => {
    const svc = new AccuWeatherService('test-key-1234567890ab', () => {});
    expect(svc.forecastCapabilities).toEqual({ hourlyHours: 12, dailyDays: 5 });
    expect(supportsForecasts(svc)).toBe(true);
  });
});
```

Match the existing test file's construction style for `AccuWeatherService` (reuse its mock-fetch setup for any test that calls `getHourlyForecast`; the capability test above needs no network).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/services/AccuWeatherService.test.ts -t "forecast capability"`
Expected: FAIL, `forecastCapabilities` undefined.

- [ ] **Step 3: Implement on `AccuWeatherService`**

Add the import (top of file): `import { mapCurrentToObservation, mapDailyToForecasts, mapHourlyToForecasts } from '../mappers/WeatherProviderMapper.js';` and `import type { WeatherData as SKWeatherData } from '@signalk/server-api';`.

Rename the three existing public raw methods (`getHourlyForecast`, `getDailyForecast`, `getCurrentConditionsForLocation` at lines ~363, ~383, ~403) to `fetchHourlyForecastRaw`, `fetchDailyForecastRaw`, `fetchCurrentConditionsRaw` (keep their bodies and signatures otherwise identical). Then add:

```ts
  /** AccuWeather free endpoints cap at a 12-hour hourly and 5-day daily window. */
  public readonly forecastCapabilities = { hourlyHours: 12, dailyDays: 5 } as const;

  /** Current observation at an arbitrary position, in the SK v2 envelope. */
  public async getObservation(location: GeoLocation): Promise<SKWeatherData> {
    return mapCurrentToObservation(await this.fetchCurrentConditionsRaw(location));
  }

  /** 12-hour hourly forecast in the SK v2 envelope, ascending by date. */
  public async getHourlyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
    return mapHourlyToForecasts(await this.fetchHourlyForecastRaw(location));
  }

  /** 5-day daily forecast in the SK v2 envelope, ascending by date. */
  public async getDailyForecast(location: GeoLocation): Promise<SKWeatherData[]> {
    return mapDailyToForecasts(await this.fetchDailyForecastRaw(location));
  }
```

- [ ] **Step 4: Run the gate**

Run: `npm run validate`
Expected: type-check FAILS in `WeatherProviderAdapter.ts` because it still calls the old method names. That is expected; Task 4 fixes the adapter. To keep tasks independently committable, do Task 4 immediately and commit Tasks 3 and 4 together. (If your executor requires a green gate per task, treat Tasks 3 and 4 as one task.)

- [ ] **Step 5: Defer commit to Task 4**

---

### Task 4: Retarget WeatherProviderAdapter to the interface

**Files:**
- Modify: `src/services/WeatherProviderAdapter.ts`
- Test: `src/__tests__/services/WeatherProviderAdapter.test.ts` (update)

**Interfaces:**
- Consumes: `ForecastCapableProvider` (Task 1); `provider.getObservation/getHourlyForecast/getDailyForecast` (Task 3); `WarningsService`.
- Produces: an adapter constructed against `ForecastCapableProvider`, not `AccuWeatherService`. v2 `name` comes from `provider.name`.

- [ ] **Step 1: Update the adapter**

Replace the AccuWeather-specific import and field with the interface. The constructor becomes:

```ts
import type { ForecastCapableProvider } from '../providers/WeatherProvider.js';
// remove: import type { AccuWeatherService } from './AccuWeatherService.js';

export class WeatherProviderAdapter {
  constructor(
    private readonly provider: ForecastCapableProvider,
    private readonly warningsService?: WarningsService,
    private readonly logger: Logger = () => {}
  ) {}

  public toProvider(): WeatherProvider {
    return {
      name: this.provider.name,
      methods: {
        pluginId: PLUGIN.NAME,
        getObservations: this.getObservations.bind(this),
        getForecasts: this.getForecasts.bind(this),
        getWarnings: this.getWarnings.bind(this),
      },
    };
  }
```

Rewrite `getForecasts` and `getObservations` to delegate (the mapping now lives in the provider):

```ts
  private async getForecasts(
    position: Position,
    type: WeatherForecastType,
    options?: WeatherReqParams
  ): Promise<SKWeatherData[]> {
    this.logger('debug', 'Weather provider forecast request', { type });
    const location: GeoLocation = { latitude: position.latitude, longitude: position.longitude };
    const forecasts =
      type === 'daily'
        ? await this.provider.getDailyForecast(location)
        : await this.provider.getHourlyForecast(location);
    const maxCount = options?.maxCount;
    return typeof maxCount === 'number' && maxCount > 0 ? forecasts.slice(0, maxCount) : forecasts;
  }

  private async getObservations(
    position: Position,
    _options?: WeatherReqParams
  ): Promise<SKWeatherData[]> {
    this.logger('debug', 'Weather provider observation request');
    const location: GeoLocation = { latitude: position.latitude, longitude: position.longitude };
    return [await this.provider.getObservation(location)];
  }
```

Keep `getWarnings` unchanged.

- [ ] **Step 2: Update the adapter test**

In `WeatherProviderAdapter.test.ts`, replace the concrete `AccuWeatherService` mock with a minimal `ForecastCapableProvider` stub whose `getObservation/getHourlyForecast/getDailyForecast` return canned `SKWeatherData`. Assert: `getForecasts('point')` calls `getHourlyForecast`; `getForecasts('daily')` calls `getDailyForecast`; `maxCount` slices; `getObservations` returns a single-element array; `toProvider().name` equals the stub's `name`.

```ts
const provider = {
  name: 'Stub',
  sourceRef: 'stub',
  forecastCapabilities: { hourlyHours: 12, dailyDays: 5 },
  fetchCurrentWeather: async () => ({}) as never,
  getRequestCount: () => 0,
  getRequestCountLast24h: () => 0,
  getCacheStats: () => ({ size: 0 }),
  getObservation: vi.fn(async () => ({ date: 'o' }) as never),
  getHourlyForecast: vi.fn(async () => [{ date: 'h1' }, { date: 'h2' }] as never),
  getDailyForecast: vi.fn(async () => [{ date: 'd1' }] as never),
};
```

- [ ] **Step 3: Run the gate**

Run: `npm run validate`
Expected: type-check clean, Biome clean, all tests pass (count is 418 plus the new Task 1 and Task 3 tests).

- [ ] **Step 4: Commit Tasks 3 and 4 together**

```bash
git add src/services/AccuWeatherService.ts src/services/WeatherProviderAdapter.ts src/__tests__/services/AccuWeatherService.test.ts src/__tests__/services/WeatherProviderAdapter.test.ts
git commit -m "refactor: make the v2 adapter provider-agnostic over the forecast interface"
```

---

### Task 5: Add the weatherMode config field and resolver

**Files:**
- Modify: `src/constants/notifications-shared.ts` (mode type, ids, labels, default, resolver)
- Modify: `src/types/index.ts` (add `weatherMode` to `PluginConfiguration`)
- Test: `src/__tests__/constants/notifications-shared.test.ts` (extend, or create if absent)

**Interfaces:**
- Produces: `WeatherMode = 'single' | 'merged'`; `WEATHER_MODE_IDS`; `WEATHER_MODE_LABELS`; `DEFAULT_WEATHER_MODE = 'single'`; `resolveWeatherMode(explicit): WeatherMode`. `PluginConfiguration.weatherMode: WeatherMode`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/constants/notifications-shared.test.ts (add)
import {
  DEFAULT_WEATHER_MODE,
  resolveWeatherMode,
  WEATHER_MODE_IDS,
} from '../../constants/notifications-shared.js';

describe('resolveWeatherMode', () => {
  it('defaults to single for missing or unknown values', () => {
    expect(resolveWeatherMode(undefined)).toBe('single');
    expect(resolveWeatherMode('bogus')).toBe('single');
    expect(DEFAULT_WEATHER_MODE).toBe('single');
  });
  it('honors an explicit valid mode', () => {
    expect(resolveWeatherMode('merged')).toBe('merged');
    expect(resolveWeatherMode('single')).toBe('single');
  });
  it('lists both modes', () => {
    expect([...WEATHER_MODE_IDS]).toEqual(['single', 'merged']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/constants/notifications-shared.test.ts -t resolveWeatherMode`
Expected: FAIL, exports missing.

- [ ] **Step 3: Add to `notifications-shared.ts`** (below the provider block, around line 117)

```ts
/** How configured providers are combined: one source, or a synthetic blend. */
export type WeatherMode = 'single' | 'merged';

/** Valid modes, single first. */
export const WEATHER_MODE_IDS: ReadonlyArray<WeatherMode> = Object.freeze(['single', 'merged']);

/** Default mode for a fresh or legacy install: a single source, today's behavior. */
export const DEFAULT_WEATHER_MODE: WeatherMode = 'single';

/** Panel and schema labels for the mode picker. */
export const WEATHER_MODE_LABELS: Readonly<Record<WeatherMode, string>> = Object.freeze({
  single: 'Single provider',
  merged: 'Merge available providers (synthetic blend)',
});

/** Resolve the effective mode; anything but a known value falls back to single. */
export function resolveWeatherMode(explicit: unknown): WeatherMode {
  return explicit === 'merged' ? 'merged' : 'single';
}
```

- [ ] **Step 4: Add the field to `PluginConfiguration`** (`src/types/index.ts`, after `weatherProvider`)

```ts
  /**
   * How configured providers are combined. `single` (default) uses one source;
   * `merged` blends every available provider into synthetic values. See
   * `resolveWeatherMode`.
   */
  readonly weatherMode: WeatherMode;
```

Add `WeatherMode` to the existing import from `../constants/notifications-shared.js` in `types/index.ts` (it already imports `WeatherProviderId` from there).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/constants/notifications-shared.test.ts -t resolveWeatherMode`
Expected: PASS. (Type-check will flag `PluginConfiguration` construction sites missing `weatherMode`; Task 6 fills them in. Run the full gate after Task 6.)

- [ ] **Step 6: Defer commit to Task 6**

---

### Task 6: Validate and thread weatherMode through config loading

**Files:**
- Modify: `src/utils/validation.ts` (default and pass through `weatherMode`)
- Modify: `src/index.ts:817-821` (read `rawSettings.weatherMode`)
- Modify: `src/constants/index.ts` `DEFAULT_CONFIG` if it constructs a `PluginConfiguration` literal (add `weatherMode`); also any other `PluginConfiguration` literal the type-check flags
- Test: `src/__tests__/utils/validation.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveWeatherMode`, `DEFAULT_WEATHER_MODE` (Task 5).
- Produces: the sanitized config always carries `weatherMode`, defaulting to `single`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/utils/validation.test.ts (add)
import { sanitizeConfiguration } from '../../utils/validation.js';

describe('sanitizeConfiguration weatherMode', () => {
  it('defaults weatherMode to single when absent', () => {
    expect(sanitizeConfiguration({}).weatherMode).toBe('single');
  });
  it('passes an explicit merged mode through', () => {
    expect(sanitizeConfiguration({ weatherMode: 'merged' }).weatherMode).toBe('merged');
  });
});
```

`sanitizeConfiguration(config: Partial<PluginConfiguration>): PluginConfiguration` is at `validation.ts:286`; its returned object sets `weatherProvider: resolveWeatherProvider(...)` at line 289. Add `weatherMode: resolveWeatherMode(config.weatherMode),` immediately after that line.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/utils/validation.test.ts -t weatherMode`
Expected: FAIL, `weatherMode` undefined on the result.

- [ ] **Step 3: Implement**

In `validation.ts`: import `resolveWeatherMode` from `../constants/notifications-shared.js`, and in the normalized-config object (the one returning `weatherProvider: resolveWeatherProvider(...)` near line 289) add:

```ts
    weatherMode: resolveWeatherMode(config.weatherMode),
```

In `index.ts` near lines 817-821, alongside the existing conditional spread for `weatherProvider`, add:

```ts
    ...(typeof rawSettings.weatherMode === 'string' && {
      weatherMode: rawSettings.weatherMode as PluginConfiguration['weatherMode'],
    }),
```

In `constants/index.ts` `DEFAULT_CONFIG` and any test fixture that builds a full `PluginConfiguration`, add `weatherMode: 'single'` (or `weatherMode: DEFAULT_WEATHER_MODE`) wherever type-check reports a missing property.

- [ ] **Step 4: Run the gate**

Run: `npm run validate`
Expected: type-check clean (all `PluginConfiguration` literals now include `weatherMode`), Biome clean, all tests pass.

- [ ] **Step 5: Commit Tasks 5 and 6 together**

```bash
git add src/constants/notifications-shared.ts src/types/index.ts src/utils/validation.ts src/index.ts src/constants/index.ts src/__tests__/constants/notifications-shared.test.ts src/__tests__/utils/validation.test.ts
git commit -m "feat: add weatherMode config field defaulting to single"
```

---

### Task 7: Introduce the PROVIDER_CATALOG construction registry

**Files:**
- Create: `src/providers/providerCatalog.ts`
- Modify: `src/providers/createCurrentWeatherProvider.ts`
- Test: `src/__tests__/providers/providerCatalog.test.ts` (create)

**Interfaces:**
- Consumes: `WeatherProviderId`, `WEATHER_PROVIDER_IDS` (panel-safe id registry, unchanged); `AccuWeatherService`, `OpenMeteoService`.
- Produces: `PROVIDER_CATALOG: Record<WeatherProviderId, { keyless: boolean; construct(config, logger): CurrentWeatherProvider }>`. `createCurrentWeatherProvider` builds the selected `weatherProvider` via the catalog.

Note on modularity: the panel-safe id and label registry stays in `notifications-shared.ts` (the panel cannot import Node services). The catalog here is the construction half, keyed by the same ids. Adding a future provider is: one id in `notifications-shared.ts` (id, label), one catalog entry here, plus the service and its mappers.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/providers/providerCatalog.test.ts
import { describe, expect, it } from 'vitest';
import { WEATHER_PROVIDER_IDS } from '../../constants/notifications-shared.js';
import { PROVIDER_CATALOG } from '../../providers/providerCatalog.js';
import type { PluginConfiguration } from '../../types/index.js';

const baseConfig = {
  weatherProvider: 'open-meteo',
  weatherMode: 'single',
  accuWeatherApiKey: 'test-key-1234567890ab',
  openMeteoBaseUrl: '',
  marineData: false,
  updateFrequency: 30,
  emissionInterval: 5,
  dailyApiQuota: 50,
  notifications: { enabled: false, wind: true, visibility: true, heat: true, cold: true, weather: true },
} as PluginConfiguration;

describe('PROVIDER_CATALOG', () => {
  it('has an entry for every provider id', () => {
    for (const id of WEATHER_PROVIDER_IDS) {
      expect(PROVIDER_CATALOG[id]).toBeDefined();
    }
  });
  it('constructs each provider with the expected sourceRef', () => {
    expect(PROVIDER_CATALOG['open-meteo'].construct(baseConfig, () => {}).sourceRef).toBe('open-meteo');
    expect(PROVIDER_CATALOG.accuweather.construct(baseConfig, () => {}).sourceRef).toBe('accuweather');
  });
  it('marks open-meteo keyless and accuweather keyed', () => {
    expect(PROVIDER_CATALOG['open-meteo'].keyless).toBe(true);
    expect(PROVIDER_CATALOG.accuweather.keyless).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/providers/providerCatalog.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/providers/providerCatalog.ts`**

```ts
/**
 * Construction registry for current-weather providers, keyed by the same ids
 * the panel-safe registry in notifications-shared.ts exposes. Splitting the
 * construction half out here keeps Node-only service imports out of the
 * panel build. Adding a provider is one entry here plus one id and label in
 * notifications-shared.ts, plus the service and its mappers.
 */
import type { WeatherProviderId } from '../constants/notifications-shared.js';
import { AccuWeatherService } from '../services/AccuWeatherService.js';
import { OpenMeteoService } from '../services/OpenMeteoService.js';
import type { Logger, PluginConfiguration } from '../types/index.js';
import type { CurrentWeatherProvider } from './WeatherProvider.js';

export interface ProviderCatalogEntry {
  /** True when the provider needs no API key. */
  readonly keyless: boolean;
  /** Build the provider from validated config. */
  construct(config: PluginConfiguration, logger: Logger): CurrentWeatherProvider;
}

export const PROVIDER_CATALOG: Readonly<Record<WeatherProviderId, ProviderCatalogEntry>> =
  Object.freeze({
    'open-meteo': {
      keyless: true,
      construct: (config, logger) =>
        new OpenMeteoService(
          logger,
          config.openMeteoBaseUrl ? { baseUrl: config.openMeteoBaseUrl } : undefined
        ),
    },
    accuweather: {
      keyless: false,
      construct: (config, logger) =>
        new AccuWeatherService(config.accuWeatherApiKey, logger, {
          dailyApiQuota: config.dailyApiQuota,
        }),
    },
  });
```

- [ ] **Step 4: Refactor `createCurrentWeatherProvider.ts` to use the catalog**

```ts
import { PROVIDER_CATALOG } from './providerCatalog.js';
import type { Logger, PluginConfiguration } from '../types/index.js';
import type { CurrentWeatherProvider } from './WeatherProvider.js';

export function createCurrentWeatherProvider(
  config: PluginConfiguration,
  logger: Logger = () => {}
): CurrentWeatherProvider {
  return PROVIDER_CATALOG[config.weatherProvider].construct(config, logger);
}
```

- [ ] **Step 5: Run the gate**

Run: `npm run validate`
Expected: clean. The existing `createCurrentWeatherProvider.test.ts` still passes (same behavior, now catalog-backed). New catalog tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/providers/providerCatalog.ts src/providers/createCurrentWeatherProvider.ts src/__tests__/providers/providerCatalog.test.ts
git commit -m "refactor: build providers from a construction catalog"
```

---

### Task 8: Replace the AccuWeather-specific registration and fallback couplings

**Files:**
- Modify: `src/index.ts:449` (the `instanceof AccuWeatherService` guard)
- Modify: `src/services/WeatherService.ts:151-155` (the hardcoded fallback)
- Test: `src/__tests__/services/WeatherService.test.ts` (confirm injected-provider path unchanged); rely on existing `index` coverage plus the gate

**Interfaces:**
- Consumes: `supportsForecasts` (Task 1); `createCurrentWeatherProvider` (Task 7).
- Produces: v2 registration gated on `supportsForecasts(provider)`; `WeatherService`'s provider fallback built via the factory, not a hardcoded `AccuWeatherService`. Behavior is identical: AccuWeather is forecast-capable so it still registers; Open-Meteo is not (until Plan 2) so it still does not.

- [ ] **Step 1: Replace the registration guard in `index.ts`**

Add the import: `import { supportsForecasts } from './providers/WeatherProvider.js';` and remove the now-unused `AccuWeatherService` import if nothing else needs it. Replace the `} else if (provider instanceof AccuWeatherService) {` branch condition (around line 449) with:

```ts
  } else if (supportsForecasts(provider)) {
    const adapter = new WeatherProviderAdapter(
      provider,
      new WarningsService(instance.logger),
      instance.logger
    );
    app.registerWeatherProvider(adapter.toProvider());
    instance.weatherProviderRegistered = true;
    instance.logger('info', 'Registered Signal K weather provider', { provider: provider.name });
  } else {
    instance.logger('info', 'Weather API forecasts not advertised for the selected provider', {
      provider: provider.name,
    });
  }
```

(`provider` is the `CurrentWeatherProvider` from `createCurrentWeatherProvider` at line 411; `supportsForecasts` narrows it to the `ForecastCapableProvider` the adapter needs.)

- [ ] **Step 2: Replace the WeatherService fallback**

In `WeatherService.ts`, replace the hardcoded fallback at lines 151-155 with the factory:

```ts
    this.weatherProvider = weatherProvider ?? createCurrentWeatherProvider(this.config, this.logger);
```

Add `import { createCurrentWeatherProvider } from '../providers/createCurrentWeatherProvider.js';` and remove the now-unused `AccuWeatherService` import if present. This removes the AccuWeather hardcoding while keeping the test-convenience fallback.

- [ ] **Step 3: Run the gate**

Run: `npm run validate`
Expected: type-check clean, Biome clean, all tests pass. The default-construction path now honors `config.weatherProvider` rather than always building AccuWeather, which is strictly more correct and does not change any existing test that injects a provider explicitly.

- [ ] **Step 4: Confirm the fallback path via existing coverage, no new public accessor**

The fallback now routes through `createCurrentWeatherProvider`, which Task 7's `providerCatalog.test.ts` and the existing `createCurrentWeatherProvider.test.ts` already cover for both ids. Do not add a public provider accessor to `WeatherService` solely for a test. Instead confirm the refactor by running the existing `WeatherService` suite (it constructs the service without injecting a provider in several cases) and the registration coverage:

Run: `npx vitest run src/__tests__/services/WeatherService.test.ts`
Expected: PASS, unchanged count. The provider is now built from config rather than hardcoded, which those tests exercise via construction without error.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/services/WeatherService.ts src/__tests__/services/WeatherService.test.ts
git commit -m "refactor: gate v2 registration on forecast capability, not the concrete service"
```

---

## Self-Review

Run after completing all tasks:

- [ ] `npm run validate` is green: type-check, Biome, and the full Vitest run (>= 418 tests).
- [ ] `git grep -n "PLUGIN.SOURCE_REF\|PLUGIN.PROVIDER_NAME\|instanceof AccuWeatherService"` returns nothing in `src/`.
- [ ] `git grep -n "weatherMode"` shows the field in `types/index.ts`, `notifications-shared.ts`, `validation.ts`, and `index.ts`.
- [ ] The plugin still registers the v2 provider under AccuWeather and not under Open-Meteo (unchanged behavior): confirm by reading the `supportsForecasts` branch and that `OpenMeteoService` has no forecast methods yet.
- [ ] No new user-facing string, schema enum, or panel control was added (the `weatherMode` picker is Plan 3); only the config field and its validation exist.

## Hand-off to Plan 2

Plan 1 leaves these seams in place for Plan 2 (Open-Meteo v2 parity): the `ObservationCapableProvider`/`ForecastCapableProvider` interfaces, the provider-agnostic adapter, the `PROVIDER_CATALOG`, and the `supportsForecasts`-gated registration. Plan 2 makes `OpenMeteoService` implement `ForecastCapableProvider` (new `OpenMeteoForecastMapper`, `getObservation`, `getHourlyForecast`, `getDailyForecast`, `forecastCapabilities = { hourlyHours: 48, dailyDays: 7 }`), wires `WarningsService` into both provider paths so `getWarnings` never throws, makes the adapter total, and adds the ordering and never-throw tests. That is when a default Open-Meteo install begins registering a provider and the panel card flips to On.
