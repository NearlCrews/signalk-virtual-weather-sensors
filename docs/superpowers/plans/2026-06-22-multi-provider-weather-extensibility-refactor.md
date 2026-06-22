# Multi-Provider Weather, Plan 1.5: Extensibility Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make adding a weather provider cheap and remove the accidental coupling around the provider seam, behavior-preserving, so Plan 2 (Open-Meteo v2 parity) and Plan 3 (merge engine) land on clean ground.

**Architecture:** Seven sequenced refactors from the modularization roadmap: fix the `resolveWeatherProvider` id-list bug and add a panel-safe provider key-requirement source, drive provider-conditional logic in validation and the panel from that source instead of `=== 'accuweather'` literals, hoist duplicated conversion helpers, extract the AccuWeather current transform into a pure mapper (symmetry with Open-Meteo, and the precondition for Plan 3's merge), extract the forecast cache into a reusable unit (unblocks Plan 2's Open-Meteo caching), and split the 634-line types barrel. No user-visible behavior changes; the full suite stays green at every step.

**Tech Stack:** TypeScript (strict, ES2023), ESM (NodeNext), Vitest, Biome, React 19 panel, `@signalk/server-api` (peer, types only).

## Global Constraints

- ESM NodeNext: import sibling modules with the `.js` specifier even from `.ts` source.
- Node floor 20.18; `@signalk/server-api` is a types-only peer dependency.
- Panel-safe rule: `src/constants/notifications-shared.ts` and anything the panel (`src/configpanel/*`) imports must NOT import a Node-only service. The panel cannot import `src/providers/providerCatalog.ts` (it pulls in `AccuWeatherService`/`OpenMeteoService`). Any provider fact the panel needs lives in `notifications-shared.ts`.
- SI units throughout: m/s, radians, Kelvin, Pa, ratio 0..1.
- Text rule for all comments, commit messages, and docs: no em dashes (use a colon, a comma, or two sentences), use the Oxford comma, write the word "and" never "&", and never mention any AI or review process (describe WHAT changed).
- Behavior-preserving: every extraction produces byte-identical runtime output. Verify by keeping the existing suite green; add focused tests for newly-pure units.
- Gate after every task: `npm run validate` (type-check including the panel `tsconfig.panel.json`, Biome, full Vitest). The suite is at 430 tests; only add tests, never reduce the count.
- Commit types: `fix:` for the resolveWeatherProvider correctness fix, `refactor:` for the rest.

---

### Task 1: Fix `resolveWeatherProvider` and add a panel-safe key-requirement source

**Files:**
- Modify: `src/constants/notifications-shared.ts` (the resolve guard, plus a new key-requirement map and helper)
- Test: `src/__tests__/constants/notifications-shared.test.ts` (extend)

**Interfaces:**
- Produces: `resolveWeatherProvider` validates against `WEATHER_PROVIDER_IDS` membership. New `WEATHER_PROVIDER_REQUIRES_KEY: Readonly<Record<WeatherProviderId, boolean>>` and `providerRequiresApiKey(id: WeatherProviderId): boolean`, both panel-safe (no Node imports). `open-meteo` requires no key; `accuweather` does.

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/constants/notifications-shared.test.ts (add)
import {
  providerRequiresApiKey,
  resolveWeatherProvider,
  WEATHER_PROVIDER_IDS,
} from '../../constants/notifications-shared.js';

describe('resolveWeatherProvider honors the id list', () => {
  it('accepts every known id, not just a hardcoded pair', () => {
    for (const id of WEATHER_PROVIDER_IDS) {
      expect(resolveWeatherProvider(id, false)).toBe(id);
    }
  });
  it('falls back by key presence for an unknown explicit value', () => {
    expect(resolveWeatherProvider('bogus', true)).toBe('accuweather');
    expect(resolveWeatherProvider(undefined, false)).toBe('open-meteo');
  });
});

describe('providerRequiresApiKey', () => {
  it('marks accuweather keyed and open-meteo keyless', () => {
    expect(providerRequiresApiKey('accuweather')).toBe(true);
    expect(providerRequiresApiKey('open-meteo')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/constants/notifications-shared.test.ts -t "honors the id list"`
Expected: FAIL, `providerRequiresApiKey` not exported (and the id-list test passes only coincidentally today).

- [ ] **Step 3: Implement in `notifications-shared.ts`**

Replace the body of `resolveWeatherProvider` (currently `if (explicit === 'open-meteo' || explicit === 'accuweather') return explicit;`) with a membership check, and add the key-requirement source below the provider block:

```ts
export function resolveWeatherProvider(
  explicit: unknown,
  hasAccuWeatherKey: boolean
): WeatherProviderId {
  if (typeof explicit === 'string' && (WEATHER_PROVIDER_IDS as ReadonlyArray<string>).includes(explicit)) {
    return explicit as WeatherProviderId;
  }
  return hasAccuWeatherKey ? 'accuweather' : 'open-meteo';
}

/**
 * Whether a provider needs an API key. Panel-safe single source consumed by the
 * runtime validator, the rjsf schema, and the federated panel, so the keyed and
 * keyless distinction cannot drift. A new keyed provider adds one entry here.
 */
export const WEATHER_PROVIDER_REQUIRES_KEY: Readonly<Record<WeatherProviderId, boolean>> =
  Object.freeze({
    'open-meteo': false,
    accuweather: true,
  });

/** True when the provider needs an API key. */
export function providerRequiresApiKey(id: WeatherProviderId): boolean {
  return WEATHER_PROVIDER_REQUIRES_KEY[id];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/constants/notifications-shared.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/constants/notifications-shared.ts src/__tests__/constants/notifications-shared.test.ts
git commit -m "fix: resolve weatherProvider against the id list and add a key-requirement source"
```

---

### Task 2: Drive validation key-gating from the catalog source

**Files:**
- Modify: `src/utils/validation.ts:104` (the `provider !== 'accuweather'` gate)
- Modify: `src/providers/providerCatalog.ts` (derive `keyless` from the shared source)
- Test: `src/__tests__/utils/validation.test.ts` (extend)

**Interfaces:**
- Consumes: `providerRequiresApiKey` (Task 1).
- Produces: `validateApiKey` gates on `providerRequiresApiKey(provider)`, not a literal. `PROVIDER_CATALOG` entries set `keyless: !providerRequiresApiKey(id)` so the two sources cannot disagree.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/utils/validation.test.ts (add)
import { validateConfiguration } from '../../utils/validation.js';

describe('validateApiKey is capability-driven', () => {
  it('requires a key for accuweather', () => {
    const r = validateConfiguration({ weatherProvider: 'accuweather', accuWeatherApiKey: '' });
    expect(r.errors).toContain('AccuWeather API key is required');
  });
  it('does not require a key for a keyless provider', () => {
    const r = validateConfiguration({ weatherProvider: 'open-meteo', accuWeatherApiKey: '' });
    expect(r.errors).not.toContain('AccuWeather API key is required');
  });
});
```

- [ ] **Step 2: Run test to verify it passes-then-guards**

Run: `npx vitest run src/__tests__/utils/validation.test.ts -t "capability-driven"`
Expected: PASS today (behavior is the same). This test pins the behavior so the refactor in Step 3 cannot change it.

- [ ] **Step 3: Implement**

In `validation.ts`, import `providerRequiresApiKey` from `../constants/notifications-shared.js` and replace line 104:

```ts
  // A keyless provider needs no API key. If one is present anyway it is simply
  // unused, so do not validate or block on it.
  if (!providerRequiresApiKey(provider)) return;
```

In `providerCatalog.ts`, import `providerRequiresApiKey` and set each entry's `keyless` from it rather than a literal, so the catalog and the panel-safe source share one truth:

```ts
'open-meteo': {
  keyless: !providerRequiresApiKey('open-meteo'),
  construct: (config, logger) => /* unchanged */,
},
accuweather: {
  keyless: !providerRequiresApiKey('accuweather'),
  construct: (config, logger) => /* unchanged */,
},
```

- [ ] **Step 4: Run the gate**

Run: `npm run validate`
Expected: green. `git grep -n "!== 'accuweather'\|=== 'accuweather'" src/utils src/providers` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add src/utils/validation.ts src/providers/providerCatalog.ts src/__tests__/utils/validation.test.ts
git commit -m "refactor: gate api-key validation on provider capability, not a literal"
```

---

### Task 3: Drive panel provider-conditional UI from the catalog source

**Files:**
- Modify: `src/configpanel/PluginConfigurationPanel.tsx` (EVERY `isAccuWeather` fork: the `firstRun` check at line 94, the `isAccuWeather` declaration at line 114, the Section summary at lines 163-168, the ApiKeyField/base-URL render fork at line 188, the update-frequency help at line 260, and the quota fields block at line 283)
- Modify: `src/configpanel/hooks/usePanelConfig.ts:198` (the save gate)
- Test: panel type-check via `npm run type-check:panel` plus the full gate

**Interfaces:**
- Consumes: `providerRequiresApiKey` (Task 1).
- Produces: the panel's keyed-vs-keyless decision reads `providerRequiresApiKey(form.weatherProvider)` rather than `=== 'accuweather'`. The key field shows when the provider requires a key; the base-URL field shows otherwise. Behavior is identical for the two current providers.

- [ ] **Step 1: Update `usePanelConfig.ts`**

Import `providerRequiresApiKey` from `../../constants/notifications-shared.js`. Replace the save gate at line 198:

```ts
    if (providerRequiresApiKey(form.weatherProvider)) {
      const keyLengthError = validateKeyLength(trimmedKey);
      if (keyLengthError) {
        setKeyError(keyLengthError);
        return false;
      }
    }
```

- [ ] **Step 2: Update `PluginConfigurationPanel.tsx`**

Import `providerRequiresApiKey`. Replace the three forks:

```ts
// firstRun (line ~91): a keyed provider with no saved key is the "add a key" case
const requiresKey = providerRequiresApiKey(savedForm.weatherProvider);
const firstRun =
  status !== null &&
  !status.running &&
  requiresKey &&
  savedForm.accuWeatherApiKey.trim() === '';

// section derivation (line ~114): rename isAccuWeather to needsKey, driven by the form value
const needsKey = providerRequiresApiKey(form.weatherProvider);
const quotaSummary = !needsKey
  ? 'keyless'
  : form.dailyApiQuota === 0
    ? 'no cap'
    : `quota ${form.dailyApiQuota}/day`;
```

Replace EVERY `isAccuWeather` reference with `needsKey`: the declaration at line 114 plus all usages at lines 163, 188, 260, and 283. Renaming the variable means leaving any reference unreplaced is an undefined name that fails the type-check, so grep `isAccuWeather` in the file and confirm zero remain. The render fork stays `{needsKey ? <ApiKeyField .../> : <base-url field/>}`.

Also make the `Section` summary capability-driven instead of hardcoding the provider names, so a third provider gets its real label. `WEATHER_PROVIDER_LABELS` is already imported in the panel (the picker uses it):

```tsx
summary={
  needsKey
    ? `${WEATHER_PROVIDER_LABELS[form.weatherProvider]}${form.accuWeatherApiKey.trim() ? ' (key set)' : ' (no key)'}`
    : WEATHER_PROVIDER_LABELS[form.weatherProvider]
}
```

The remaining AccuWeather-specific copy strings (the first-run callout text, the base-URL help paragraph) stay as-is for now; a fuller per-provider field and copy model is a later concern noted in the roadmap.

- [ ] **Step 3: Run the gate**

Run: `npm run validate`
Expected: green, including `type-check:panel`. `git grep -n "=== 'accuweather'" src/configpanel` returns nothing.

- [ ] **Step 4: Commit**

```bash
git add src/configpanel/PluginConfigurationPanel.tsx src/configpanel/hooks/usePanelConfig.ts
git commit -m "refactor: drive the panel key-vs-keyless UI from provider capability"
```

---

### Task 4: Hoist duplicated conversion helpers

**Files:**
- Modify: `src/utils/conversions.ts` (add three exported helpers)
- Modify: `src/mappers/WeatherProviderMapper.ts:65,86,245` (use the shared `optionalCelsiusToKelvin` and `optionalPercentageToRatio`)
- Modify: `src/services/AccuWeatherService.ts:137,168,182` (use the shared helpers)
- Modify: `src/mappers/OpenMeteoMapper.ts:96,99` (use the shared helpers)
- Test: `src/__tests__/utils/conversions.test.ts` (extend)

**Interfaces:**
- Produces in `conversions.ts`: `optionalCelsiusToKelvin(value: unknown): number | undefined`, `optionalPercentageToRatio(value: unknown): number | undefined`, `calculateGustFactor(windGustSpeed: number | undefined, windSpeed: number): number | undefined` (returns the ratio only when the gust is finite, `windSpeed > 0`, and `windGustSpeed >= windSpeed`, matching the existing inline guards).

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/utils/conversions.test.ts (add)
import {
  calculateGustFactor,
  optionalCelsiusToKelvin,
  optionalPercentageToRatio,
} from '../../utils/conversions.js';

describe('optional conversion helpers', () => {
  it('optionalCelsiusToKelvin returns undefined for non-numeric, Kelvin for numeric', () => {
    expect(optionalCelsiusToKelvin(undefined)).toBeUndefined();
    expect(optionalCelsiusToKelvin(null)).toBeUndefined();
    expect(optionalCelsiusToKelvin(0)).toBeCloseTo(273.15, 2);
  });
  it('optionalPercentageToRatio returns undefined for missing, ratio for present', () => {
    expect(optionalPercentageToRatio(undefined)).toBeUndefined();
    expect(optionalPercentageToRatio(50)).toBeCloseTo(0.5, 5);
  });
  it('calculateGustFactor guards sub-sustained and zero-wind', () => {
    expect(calculateGustFactor(10, 5)).toBeCloseTo(2, 5);
    expect(calculateGustFactor(4, 5)).toBeUndefined(); // gust below sustained
    expect(calculateGustFactor(10, 0)).toBeUndefined(); // zero sustained
    expect(calculateGustFactor(undefined, 5)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/utils/conversions.test.ts -t "optional conversion helpers"`
Expected: FAIL, helpers not exported.

- [ ] **Step 3: Add the helpers to `conversions.ts`**

```ts
/** Convert an optional Celsius value to Kelvin; undefined when missing or non-numeric. */
export function optionalCelsiusToKelvin(value: unknown): number | undefined {
  const celsius = asOptionalNumber(value);
  return celsius !== undefined ? celsiusToKelvin(celsius) : undefined;
}

/** Convert an optional percentage to a 0..1 ratio; undefined when missing or non-numeric. */
export function optionalPercentageToRatio(value: unknown): number | undefined {
  const pct = asOptionalNumber(value);
  return pct !== undefined ? percentageToRatio(pct) : undefined;
}

/**
 * Gust factor (gust over sustained), or undefined when the gust is missing, the
 * sustained wind is zero, or the gust is below the sustained speed. A factor
 * below 1 is not a gust, it is stale or inconsistent upstream data.
 */
export function calculateGustFactor(
  windGustSpeed: number | undefined,
  windSpeed: number
): number | undefined {
  return windGustSpeed !== undefined && windSpeed > 0 && windGustSpeed >= windSpeed
    ? windGustSpeed / windSpeed
    : undefined;
}
```

- [ ] **Step 4: Rewire the three call sites to import, not redefine**

- `WeatherProviderMapper.ts`: delete the private `optionalCelsiusToKelvin` (lines 65-68) and import it from `../utils/conversions.js` (its six call sites reference the name, so they need no further change). Also replace the two inline cloud-cover guards `percentageToRatio(cloudCoverPct)` at lines 86 and 245 with `optionalPercentageToRatio`, so one canonical guard serves every cloud-cover site, and add `optionalPercentageToRatio` to the import.
- `AccuWeatherService.ts`: in `extractEnhancedTemperatures`, delete the local `toKelvin` closure (lines 137-140) and call `optionalCelsiusToKelvin`. In `extractEnhancedConditions`, replace the inline `windGustFactor` computation (lines 168-171) with `calculateGustFactor(windGustSpeed, windSpeed)` and the `cloudCover` computation (lines 182-183) with `optionalPercentageToRatio(conditions.CloudCover)`. Add the three names to the existing `conversions.js` import.
- `OpenMeteoMapper.ts`: replace its inline cloud-cover guard with `optionalPercentageToRatio` and its inline gust-factor computation with `calculateGustFactor`. Add the imports.

- [ ] **Step 5: Run the gate**

Run: `npm run validate`
Expected: green. The existing AccuWeather, Open-Meteo, and WeatherProviderMapper tests pass unchanged (behavior identical), plus the three new helper tests.

- [ ] **Step 6: Commit**

```bash
git add src/utils/conversions.ts src/mappers/WeatherProviderMapper.ts src/services/AccuWeatherService.ts src/mappers/OpenMeteoMapper.ts src/__tests__/utils/conversions.test.ts
git commit -m "refactor: hoist optional-conversion and gust-factor helpers into conversions"
```

---

### Task 5: Extract the AccuWeather current transform into a pure mapper

**Files:**
- Create: `src/mappers/AccuWeatherMapper.ts`
- Modify: `src/services/AccuWeatherService.ts` (call the pure mapper; remove the moved code)
- Test: `src/__tests__/mappers/AccuWeatherMapper.test.ts` (create)

**Interfaces:**
- Consumes: the shared `conversions.ts` helpers (Task 4), `accuWeatherSevereCondition` (`../providers/accuweather-severity.js`), `WindCalculator`, and the calculators (`calculateBeaufortScale`, `calculateAbsoluteHumidity`, `calculateAirDensity`, `calculateHeatStressIndex`).
- Produces: `mapAccuWeatherCurrentToWeatherData(conditions: AccuWeatherCurrentConditions): WeatherData`, a pure function paralleling `mapOpenMeteoCurrentToWeatherData` in `OpenMeteoMapper.ts`. It does NOT call `validateWeatherData` (validation stays in the service, run on the mapper's output).

This relocates `transformWeatherData` (`AccuWeatherService.ts:627-701`) and its three module-level helpers (`extractEnhancedTemperatures` 132, `extractEnhancedConditions` 160, `extractConditionDetails` 217), the `PRESSURE_TENDENCY_CODES` map (200), and `optionalLabel` (207) into the new pure module. The transform currently uses a module-level `sharedWindCalculator`; the mapper creates or receives a stateless `WindCalculator` the same way.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/mappers/AccuWeatherMapper.test.ts
import { describe, expect, it } from 'vitest';
import { mapAccuWeatherCurrentToWeatherData } from '../../mappers/AccuWeatherMapper.js';
import type { AccuWeatherCurrentConditions } from '../../types/index.js';

// A minimal conditions fixture with the required blocks; copy the shape the
// existing AccuWeatherService transform tests already use for current conditions.
const conditions = {
  Temperature: { Metric: { Value: 20 } },
  Pressure: { Metric: { Value: 1013 } },
  RelativeHumidity: 50,
  Wind: { Speed: { Metric: { Value: 18 } }, Direction: { Degrees: 90 } },
  DewPoint: { Metric: { Value: 10 } },
  WeatherText: 'Clear',
  WeatherIcon: 1,
  LocalObservationDateTime: '2026-06-22T12:00:00Z',
} as unknown as AccuWeatherCurrentConditions;

describe('mapAccuWeatherCurrentToWeatherData', () => {
  it('produces SI WeatherData with required canonical fields', () => {
    const wd = mapAccuWeatherCurrentToWeatherData(conditions);
    expect(wd.temperature).toBeCloseTo(293.15, 2); // 20 C in Kelvin
    expect(wd.humidity).toBeCloseTo(0.5, 5); // 50% as ratio
    expect(wd.windSpeed).toBeCloseTo(5, 1); // 18 km/h in m/s
    expect(wd.windDirection).toBeGreaterThanOrEqual(0);
    expect(wd.windDirection).toBeLessThan(Math.PI * 2);
    expect(typeof wd.beaufortScale).toBe('number');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/mappers/AccuWeatherMapper.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `AccuWeatherMapper.ts`**

Move `transformWeatherData`'s body into an exported `mapAccuWeatherCurrentToWeatherData(conditions)`, moving with it the three `extract*` helpers, `PRESSURE_TENDENCY_CODES`, and `optionalLabel`. `optionalLabel` and the transform's `description`/`timestamp` lines use `capString`, so move `capString` too (and its dependency import `truncateToCodePoints`, plus the `ACCUWEATHER` constant for the max-length values it reads). The transform also uses the calculators and `accuWeatherSevereCondition` (`../providers/accuweather-severity.js`), so import those in the mapper. Use the shared `conversions.ts` helpers from Task 4 (the moved `extractEnhanced*` should now call `optionalCelsiusToKelvin`, `calculateGustFactor`, and `optionalPercentageToRatio`, not local closures). The transform currently calls a module-level `sharedWindCalculator`; in the mapper create a single stateless `const sharedWindCalculator = new WindCalculator();` at module scope (the same pattern), since the calculator holds no per-call state. This mapper handles CURRENT conditions only and converts wind inline with `kmhToMS`; it does NOT use the SK-envelope `buildWind` helper (that helper and its sharing are a Plan 2 concern). Keep the doc comments. The single behavior change: the pure mapper returns `WeatherData` and does NOT run `validateWeatherData` (that stays in the service). Header comment should mirror `OpenMeteoMapper.ts`'s, describing it as the pure AccuWeather current transform paralleling Open-Meteo.

- [ ] **Step 4: Rewire `AccuWeatherService.ts`**

Replace the private `transformWeatherData` method body with a delegation that preserves the validate step:

```ts
private transformWeatherData(conditions: AccuWeatherCurrentConditions): WeatherData {
  const weatherData = mapAccuWeatherCurrentToWeatherData(conditions);
  this.validateWeatherData(weatherData);
  return weatherData;
}
```

Add `import { mapAccuWeatherCurrentToWeatherData } from '../mappers/AccuWeatherMapper.js';`. Remove the now-moved module-level helpers and constants from the service file (`extractEnhancedTemperatures`, `extractEnhancedConditions`, `extractConditionDetails`, `PRESSURE_TENDENCY_CODES`, `optionalLabel`, and `capString` if it has no remaining caller in the service). Explicitly remove the module-level `const sharedWindCalculator` (line 61) and its `WindCalculator` import once the transform no longer uses them: Biome is configured with `noUnusedVariables: "error"`, so a leftover unused `const` or import fails the lint gate, not just produces a warning. Drop any other import now used only by the mapper (the gate flags these).

- [ ] **Step 5: Run the gate**

Run: `npm run validate`
Expected: green. The existing AccuWeatherService transform tests pass unchanged (the service still returns the same `WeatherData`), plus the new mapper test. If an existing test reached into a moved module-level helper directly, point it at the mapper module.

- [ ] **Step 6: Commit**

```bash
git add src/mappers/AccuWeatherMapper.ts src/services/AccuWeatherService.ts src/__tests__/mappers/AccuWeatherMapper.test.ts
git commit -m "refactor: extract the AccuWeather current transform into a pure mapper"
```

---

### Task 6: Extract the forecast cache into a reusable unit

**Files:**
- Create: `src/services/cache/ForecastCache.ts`
- Modify: `src/services/AccuWeatherService.ts` (use the extracted cache)
- Test: `src/__tests__/services/cache/ForecastCache.test.ts` (create)

**Interfaces:**
- Produces: a `ForecastCache` class owning the `Map<string, { data: unknown; expiresAt: number }>`, with a single method that reproduces `cachedForecastFetch`'s exact semantics:
  `fetchCached<T>(key: string, ttlMs: number, quotaExhausted: boolean, fetcher: () => Promise<T>, now = Date.now()): Promise<T>` (fresh hit returns cached with zero calls; on a miss, if `quotaExhausted` and a stale entry exists serve it, else throw the supplied rate-limit error; otherwise fetch, store with absolute expiry, prune). `now` is the LAST parameter and defaults to `Date.now()`, so production callers pass four arguments and tests pass an explicit `now` for determinism. The rate-limit error and the logger are injected via the constructor so the cache carries no AccuWeather knowledge. The internal prune takes the same `now` and must NOT call `Date.now()` itself, or the injected-`now` tests become wall-clock dependent.
- Produces: `src/services/cache/cacheUtils.ts` exporting `evictOldestOverCap` and `MAX_CACHE_SIZE`, moved out of `AccuWeatherService.ts`. `evictOldestOverCap` is used by BOTH the forecast prune (`AccuWeatherService.ts:557`) and the location-cache prune (`AccuWeatherService.ts:729`), so it is SHARED, not moved into `ForecastCache`: both `ForecastCache.ts` and the service's remaining location prune import it from `cacheUtils.ts`.

The forecast cache currently lives across `AccuWeatherService.ts:512-558` (`cachedForecastFetch`, `pruneForecastCache`) plus the `forecastCache` field and its `CacheEntry` type.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/services/cache/ForecastCache.test.ts
import { describe, expect, it, vi } from 'vitest';
import { ForecastCache } from '../../../services/cache/ForecastCache.js';

const rateLimit = () => new Error('rate-limited');

describe('ForecastCache', () => {
  it('serves a fresh hit without calling the fetcher', async () => {
    const c = new ForecastCache(rateLimit);
    const fetcher = vi.fn(async () => 'a');
    expect(await c.fetchCached('k', 1000, false, fetcher, 0)).toBe('a');
    expect(await c.fetchCached('k', 1000, false, fetcher, 500)).toBe('a');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refetches and stores with an absolute expiry once the entry has expired', async () => {
    const c = new ForecastCache(rateLimit);
    expect(await c.fetchCached('k', 1000, false, async () => 'a', 0)).toBe('a');
    // Past the 1000 ms ttl, below quota: the stored entry has expired, so it refetches.
    expect(await c.fetchCached('k', 1000, false, async () => 'b', 2000)).toBe('b');
  });
  it('serves a stale entry when quota is exhausted', async () => {
    const c = new ForecastCache(rateLimit);
    await c.fetchCached('k', 1000, false, async () => 'a', 0);
    expect(await c.fetchCached('k', 1000, true, async () => 'b', 5000)).toBe('a');
  });
  it('throws the rate-limit error on a cold miss under exhausted quota', async () => {
    const c = new ForecastCache(rateLimit);
    await expect(c.fetchCached('k', 1000, true, async () => 'a', 0)).rejects.toThrow('rate-limited');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/services/cache/ForecastCache.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `ForecastCache.ts`**

First create `src/services/cache/cacheUtils.ts` and move `evictOldestOverCap` and `MAX_CACHE_SIZE` there from `AccuWeatherService.ts`. Point the service's remaining location prune (`pruneLocationCache`, line 729) at `evictOldestOverCap` imported from `./cache/cacheUtils.js`. Then create `ForecastCache.ts`: move the `forecastCache` field, the `CacheEntry` shape, `cachedForecastFetch` (renamed `fetchCached`), and `pruneForecastCache` into the class. The constructor takes `(quotaReachedError: () => Error, logger: Logger = () => {})`. `fetchCached` takes `now` as its last parameter (defaulting to `Date.now()`) instead of reading the clock inside, and passes that same `now` into the internal prune so both the freshness compare and the prune use one timestamp. The prune imports `evictOldestOverCap` from `./cacheUtils.js`.

- [ ] **Step 4: Rewire `AccuWeatherService.ts`**

Construct the cache in the service constructor (it references instance members): `this.forecastCache = new ForecastCache(() => this.quotaReachedError(), this.logger);`. At the former `cachedForecastFetch` call sites, call `this.forecastCache.fetchCached(key, ttlMs, this.isQuotaExhausted(), fetcher)` (four arguments; `now` defaults inside). Remove the moved `cachedForecastFetch` and `pruneForecastCache` method bodies, the `forecastCache` map field, and the `CacheEntry` type from the service. Add the `ForecastCache` import, and confirm the location prune now imports `evictOldestOverCap` from `./cache/cacheUtils.js` (Step 3).

- [ ] **Step 5: Run the gate**

Run: `npm run validate`
Expected: green. The existing AccuWeatherService forecast and quota tests pass unchanged (same caching behavior), plus the new ForecastCache tests.

- [ ] **Step 6: Commit**

```bash
git add src/services/cache/cacheUtils.ts src/services/cache/ForecastCache.ts src/services/AccuWeatherService.ts src/__tests__/services/cache/ForecastCache.test.ts
git commit -m "refactor: extract the forecast cache into a reusable unit"
```

---

### Task 7: Split `types/index.ts` behind a barrel

**Files:**
- Create: `src/types/weather.ts`, `src/types/navigation.ts`, `src/types/config.ts`, `src/types/plugin.ts`, `src/types/accuweather-api.ts`, `src/types/open-meteo-api.ts`
- Modify: `src/types/index.ts` (becomes a re-export barrel)
- Test: the full gate (the barrel keeps every existing import working, so the suite is the regression check)

**Interfaces:**
- Produces: the same exported type names as today, relocated by domain, all re-exported from `src/types/index.ts` so no call site changes. `types/index.ts` ends as a list of `export * from './<domain>.js';` lines plus any doc comment.

Domain assignment (move each type to the named file, keep its doc comments and `readonly` modifiers):
- `weather.ts`: `WeatherData`, `SevereCondition`, `MarineData`, `WindCalculationResult`.
- `navigation.ts`: `VesselNavigationData`, `GeoLocation`, `isCompleteNavigationData`.
- `config.ts`: `PluginConfiguration`, `NotificationsConfig`.
- `plugin.ts`: `PanelStatusResponse`, `PluginState`, `LogLevel`, `Logger`, `NotificationValue`, `NotificationState`, `NotificationMethod`.
- `accuweather-api.ts`: every `AccuWeather*` response shape, plus `AccuWeatherConfig` (it is the AccuWeather service's internal config, AccuWeather-specific, so it lives with the AccuWeather types rather than the user-config types).
- `open-meteo-api.ts`: `OpenMeteoCurrentResponse`, `OpenMeteoMarineResponse`, and any other `OpenMeteo*` shape.

Watch the import that types files need from `notifications-shared.ts` (`WeatherProviderId`, `WeatherMode`): `config.ts` keeps that import. The build is `module: NodeNext`, which enables `verbatimModuleSyntax`, so a barrel that re-exports a file holding only types must use `export type * from './<file>.js'`. Write the barrel lines for the type-only domain files (`config.ts`, `plugin.ts`, `weather.ts`, `navigation.ts`, `accuweather-api.ts`, `open-meteo-api.ts`) as `export type *` from the start; `navigation.ts` also exports the `isCompleteNavigationData` VALUE (a type guard), so that one file needs a plain `export *` (or a separate value re-export for the guard alongside `export type *` for its types). The gate confirms which form each line needs.

- [ ] **Step 1: Move the types and write the barrel**

Create the six domain files and move each type per the assignment. Make `types/index.ts`:

```ts
export * from './weather.js';
export * from './navigation.js';
export * from './config.js';
export * from './plugin.js';
export * from './accuweather-api.js';
export * from './open-meteo-api.js';
```

(If the build requires explicit type re-exports, use `export type * from './<domain>.js';` per the gate's guidance.)

- [ ] **Step 2: Run the gate**

Run: `npm run validate`
Expected: green with zero call-site edits. Every existing `from '../types/index.js'` import still resolves through the barrel. If the gate reports a value vs type re-export issue, switch that line to `export type *`. If a genuine circular import appears (for example `config.ts` and `weather.ts` referencing each other), keep the shared type in the file it is most owned by and import across; the gate surfaces this.

- [ ] **Step 3: Commit**

```bash
git add src/types/
git commit -m "refactor: split the types module into domain files behind a barrel"
```

---

## Self-Review

Run after all tasks:

- [ ] `npm run validate` green: type-check (including panel), Biome, full Vitest (>= 430 plus the new helper, mapper, and cache tests).
- [ ] `git grep -n "=== 'accuweather'\|!== 'accuweather'" src` returns only legitimate provider-id comparisons, none in validation, the panel, or the panel hook key-gating.
- [ ] `git grep -n "isAccuWeather" src/configpanel` returns nothing (the fork variable was renamed to `needsKey`), and `git grep -n "sharedWindCalculator" src/services` returns nothing (it moved to the mapper).
- [ ] `git grep -n "transformWeatherData" src/services/AccuWeatherService.ts` shows only the thin delegate, and `mapAccuWeatherCurrentToWeatherData` exists in `src/mappers/AccuWeatherMapper.ts`.
- [ ] The AccuWeather current transform and the forecast cache are reachable as standalone units (a future provider or the Plan 3 merge can import them without the service).
- [ ] `types/index.ts` is a barrel; no call site imported a moved type by a new path.
- [ ] No user-visible behavior changed: the panel renders the same fields per provider, validation produces the same errors, and the emitted `WeatherData` is identical.

## Hand-off

After Plan 1.5: adding a keyless provider touches the id and label registry, the key-requirement map, the catalog, the service, and the mapper, with no panel, validation, or banner edits. A keyed provider additionally sets one key-requirement entry. The AccuWeather transform is a pure mapper (Plan 3 merge can call it), the forecast cache is reusable (Plan 2 Open-Meteo caching), and the conversion helpers are hoisted (Plan 2's Open-Meteo forecast mapper imports them instead of copying). The `index.ts` and `AccuWeatherService` HTTP/quota/location-cache splits (roadmap items 9 and 10) remain as follow-on; they are not required for Plan 2 unless the next provider is keyed and wants the shared HTTP machinery.
