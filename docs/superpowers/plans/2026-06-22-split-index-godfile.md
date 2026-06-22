# Split index.ts God-File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1096-line `src/index.ts` into focused `src/plugin/*` modules so a feature stops editing one giant file, behavior-preserving, with the rjsf notifications schema generated from the shared registry instead of hand-listed.

**Architecture:** Move the cross-module shared state (`PluginInstance`, `BannerKind`, `setBanner`) into a neutral `src/plugin/instance.ts`, then extract logging, schema, emission, and panel routes into their own `src/plugin/` modules, each importing the shared types one-way so no import cycle forms. `index.ts` keeps the plugin factory and the lifecycle/orchestration glue and drops to roughly 350 lines. No runtime behavior changes: the emitted deltas, the schema object the admin UI receives, the REST responses, and the log output are identical.

**Tech Stack:** TypeScript (strict, ES2023), ESM (NodeNext), Vitest, Biome, `@signalk/server-api` (peer, types only).

## Global Constraints

- ESM NodeNext: import sibling modules with the `.js` specifier even from `.ts` source.
- Node floor 20.18; `@signalk/server-api` is a types-only peer dependency.
- Import direction is one-way: the extracted `src/plugin/*` modules import from `src/plugin/instance.ts` (and shared utils/constants), never from `src/index.ts`. `index.ts` imports from the extracted modules. Do not create a back-edge into `index.ts`.
- SI units unchanged (this plan moves code, it does not touch unit math).
- Text rule for all comments, commit messages, and docs: no em dashes (use a colon, a comma, or two sentences), use the Oxford comma, write the word "and" never "&", and never mention any AI or review process.
- Behavior-preserving: every extraction produces byte-identical runtime output. Verify by keeping the existing suite green (`src/__tests__/index.test.ts` and `src/__tests__/integration/*` cover the lifecycle, emission, schema, and routes); add a focused test only for the newly-generated schema block.
- Gate after every task: `npm run validate` (type-check including the panel, Biome, full Vitest). The suite is at 443 tests; only add tests, never reduce the count.
- Commit type `refactor:` for every task.

---

### Task 1: Extract shared instance state and the banner helper

**Files:**
- Create: `src/plugin/instance.ts`
- Modify: `src/index.ts` (import the moved symbols; remove their local definitions; reseed `sourceRef`)
- Test: existing suite via the gate

**Interfaces:**
- Produces: `src/plugin/instance.ts` exports the `PluginInstance` interface (currently `index.ts:60-91`), the `BannerKind` type (`index.ts:55`), and `setBanner(instance, app, kind, message): void` (currently `index.ts:548-564`). These are the only symbols multiple modules share, so they live in one neutral module that everything imports one-way.

- [ ] **Step 1: Create `src/plugin/instance.ts`**

Move the `BannerKind` type, the `PluginInstance` interface (with all its doc comments and `readonly`/nullable fields unchanged), and the `setBanner` function verbatim into the new file. Add the imports those need: `ServerAPI` and `SourceRef` from `@signalk/server-api`, and the service/mapper/notifier/state/logger types the `PluginInstance` fields reference (`WeatherService`, `NMEA2000PathMapper`, `MarinePathMapper`, `WeatherNotifier`, `Delta`, `MarineData`, `WeatherData`, `PluginState`, `Logger`), imported from their existing modules with `.js` specifiers. Header comment: this module holds the plugin's shared instance state and the banner-dedupe helper, kept separate so the lifecycle entry and the extracted feature modules import it without a cycle.

- [ ] **Step 2: Rewire `src/index.ts`**

Remove the local `BannerKind`, `PluginInstance`, and `setBanner` definitions. Add `import { type BannerKind, type PluginInstance, setBanner } from './plugin/instance.js';` (drop `BannerKind`/`PluginInstance` from the import if index.ts no longer names them directly; it still uses `PluginInstance` in many signatures and `setBanner` in `stop()`, so keep what is referenced). Drop any import that was only used by the moved `PluginInstance` field types if index.ts no longer needs it (the gate flags unused imports).

- [ ] **Step 3: Reseed `sourceRef` from a neutral default**

At the instance initializer (`index.ts:116`), the seed is `sourceRef: toSourceRef('accuweather')`. This value is always overwritten in `startServices` (`index.ts:413`, `instance.sourceRef = toSourceRef(provider.sourceRef)`) before any delta is emitted, so it is a pre-start placeholder, not a live source. Replace the misleading AccuWeather literal:

```ts
    // Pre-start placeholder, overwritten in startServices with the resolved
    // provider's sourceRef before the first delta. Open-Meteo is the default
    // install source, so it is the honest placeholder here.
    sourceRef: toSourceRef('open-meteo'),
```

- [ ] **Step 4: Run the gate**

Run: `npm run validate`
Expected: green. The existing `index.test.ts` and integration tests pass unchanged (behavior identical). `git grep -n "interface PluginInstance\|function setBanner" src/index.ts` returns nothing; both now live in `src/plugin/instance.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/plugin/instance.ts src/index.ts
git commit -m "refactor: move shared plugin instance state and the banner helper out of index"
```

---

### Task 2: Extract the logger and log sanitization

**Files:**
- Create: `src/plugin/logging.ts`
- Modify: `src/index.ts`
- Test: existing suite via the gate

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `src/plugin/logging.ts` exports `createLogger(app: ServerAPI): Logger` (currently `index.ts:888-915`). It carries with it the module-private `LOG_PREFIX` (`881`), `SENSITIVE_LOG_KEY_PATTERN` (`916`), `SANITIZE_MAX_DEPTH` (`923`), `sanitizeLogMetadata` (`933`), and `sanitizeLogValue` (`946`), none of which need to be exported.

- [ ] **Step 1: Create `src/plugin/logging.ts`**

Move `createLogger` and its five private helpers/constants verbatim. Add the imports they use: `ServerAPI` from `@signalk/server-api`, and `LogLevel`/`Logger` from `../types/index.js`. Keep all doc comments. Export only `createLogger`.

- [ ] **Step 2: Rewire `src/index.ts`**

Remove the moved definitions. Add `import { createLogger } from './plugin/logging.js';`. The one call site is the instance initializer (`index.ts:111`, `logger: createLogger(app)`), which now resolves to the import. Drop the `LogLevel` import from index.ts if nothing else there uses it (the gate flags it).

- [ ] **Step 3: Run the gate**

Run: `npm run validate`
Expected: green. `git grep -n "function createLogger\|function sanitizeLogValue" src/index.ts` returns nothing.

- [ ] **Step 4: Commit**

```bash
git add src/plugin/logging.ts src/index.ts
git commit -m "refactor: extract the logger and log sanitization into a plugin module"
```

---

### Task 3: Extract the schema and generate the notifications block from the shared registry

**Files:**
- Create: `src/plugin/schema.ts`
- Modify: `src/index.ts`
- Test: `src/__tests__/plugin/schema.test.ts` (create)

**Interfaces:**
- Produces: `src/plugin/schema.ts` exports `pluginSchema(): object` and `pluginUiSchema(): object`, returning the same objects the inline `schema`/`uiSchema` arrow functions returned (`index.ts:193-294` and `299-335`), except the `notifications.properties` band toggles and the `notifications` `ui:order` are GENERATED from `NOTIFICATION_BAND_KEYS`, `NOTIFICATION_LABELS`, `NOTIFICATION_MASTER_LABEL`, and `DEFAULT_NOTIFICATIONS` instead of hand-listed, so the schema cannot drift from the panel.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/plugin/schema.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATIONS,
  NOTIFICATION_BAND_KEYS,
  NOTIFICATION_LABELS,
  NOTIFICATION_MASTER_LABEL,
} from '../../constants/notifications-shared.js';
import { pluginSchema, pluginUiSchema } from '../../plugin/schema.js';

describe('generated notifications schema', () => {
  it('lists the master toggle plus every band with the shared labels and defaults', () => {
    const props = (pluginSchema() as any).properties.notifications.properties;
    expect(Object.keys(props)).toEqual(['enabled', ...NOTIFICATION_BAND_KEYS]);
    expect(props.enabled).toEqual({
      type: 'boolean',
      title: NOTIFICATION_MASTER_LABEL,
      default: DEFAULT_NOTIFICATIONS.enabled,
    });
    for (const key of NOTIFICATION_BAND_KEYS) {
      expect(props[key]).toEqual({
        type: 'boolean',
        title: NOTIFICATION_LABELS[key],
        default: DEFAULT_NOTIFICATIONS[key],
      });
    }
  });
  it('orders the notifications ui by master then bands', () => {
    const order = (pluginUiSchema() as any).notifications['ui:order'];
    expect(order).toEqual(['enabled', ...NOTIFICATION_BAND_KEYS]);
  });
  it('keeps the top-level field order and the password widget on the key', () => {
    const ui = pluginUiSchema() as any;
    expect(ui['ui:order'][0]).toBe('weatherProvider');
    expect(ui.accuWeatherApiKey['ui:widget']).toBe('password');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/plugin/schema.test.ts`
Expected: FAIL, module `../../plugin/schema.js` not found.

- [ ] **Step 3: Create `src/plugin/schema.ts`**

Move the two arrow-function bodies into exported functions `pluginSchema()` and `pluginUiSchema()`, preserving every description string, default, minimum, maximum, widget, help text, and the top-level `ui:order` verbatim. Replace ONLY the hand-listed notification bands and their ui order with generation:

```ts
import {
  CONFIG_DEFAULTS,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_WEATHER_PROVIDER,
  NOTIFICATION_BAND_KEYS,
  NOTIFICATION_LABELS,
  NOTIFICATION_MASTER_LABEL,
  WEATHER_PROVIDER_IDS,
  WEATHER_PROVIDER_LABELS,
} from '../constants/notifications-shared.js';

/** Per-band boolean toggles, generated from the shared band registry so the schema cannot drift from the panel. */
function notificationBandProperties(): Record<string, { type: 'boolean'; title: string; default: boolean }> {
  return Object.fromEntries(
    NOTIFICATION_BAND_KEYS.map((key) => [
      key,
      { type: 'boolean', title: NOTIFICATION_LABELS[key], default: DEFAULT_NOTIFICATIONS[key] },
    ])
  );
}
```

In `pluginSchema()`, the `notifications.properties` becomes:

```ts
        properties: {
          enabled: {
            type: 'boolean',
            title: NOTIFICATION_MASTER_LABEL,
            default: DEFAULT_NOTIFICATIONS.enabled,
          },
          ...notificationBandProperties(),
        },
```

In `pluginUiSchema()`, the `notifications['ui:order']` becomes `['enabled', ...NOTIFICATION_BAND_KEYS]`. Everything else (the `weatherProvider` enum block, the numeric fields with their `CONFIG_DEFAULTS` bounds, the descriptions, the widgets, and the top-level `ui:order`) is copied verbatim. The old schema used `DEFAULT_CONFIG.NOTIFICATIONS.WIND` (uppercase) from `constants/index.ts`; `DEFAULT_NOTIFICATIONS` (lowercase, from `notifications-shared.ts`) carries the same values, so the defaults are unchanged.

- [ ] **Step 4: Rewire `src/index.ts`**

In the plugin object, replace the inline `schema: () => ({...})` with `schema: pluginSchema` and `uiSchema: () => ({...})` with `uiSchema: pluginUiSchema`. Add `import { pluginSchema, pluginUiSchema } from './plugin/schema.js';`. Drop the now-unused schema-only imports from index.ts (`WEATHER_PROVIDER_IDS`, `WEATHER_PROVIDER_LABELS`, `DEFAULT_WEATHER_PROVIDER`, `CONFIG_DEFAULTS`, `NOTIFICATION_LABELS`, `NOTIFICATION_MASTER_LABEL`, and the `DEFAULT_CONFIG` reference if only the schema used it) wherever the gate reports them unused.

- [ ] **Step 5: Run the gate**

Run: `npm run validate`
Expected: green. The new schema tests pass, and `index.test.ts` (which exercises `plugin.schema()`/`plugin.uiSchema()`) still passes, confirming the generated objects match what the admin UI consumed before.

- [ ] **Step 6: Commit**

```bash
git add src/plugin/schema.ts src/index.ts src/__tests__/plugin/schema.test.ts
git commit -m "refactor: extract the rjsf schema and generate the notifications block from the shared registry"
```

---

### Task 4: Extract the emission system

**Files:**
- Create: `src/plugin/emission.ts`
- Modify: `src/index.ts`
- Test: existing suite via the gate

**Interfaces:**
- Consumes: `PluginInstance` and `setBanner` from `src/plugin/instance.js` (Task 1).
- Produces: `src/plugin/emission.ts` exports `setupEnhancedEmissionSystem(instance, config, app): void` (currently `index.ts:566-590`). It carries with it the module-private `emitWeatherTick` (`599`), `emitMarineTick` (`678`), `refreshCachedDelta` (`716`), and `withEmissionTimestamp` (`749`), none of which need to be exported (only `setupEnhancedEmissionSystem` is called from `index.ts`).

- [ ] **Step 1: Create `src/plugin/emission.ts`**

Move the five functions verbatim. Add the imports they use: `PluginInstance` and `setBanner` from `./instance.js`; `ServerAPI`, `Delta`, `PathValue`, `SKVersion` from `@signalk/server-api`; `PluginConfiguration`, `WeatherData` from `../types/index.js`; `NMEA2000PathMapper` from `../mappers/NMEA2000PathMapper.js`; `isMarineDataEmpty` from `../mappers/OpenMeteoMarineMapper.js`; `buildValuesDelta` from `../utils/skDelta.js`; `PLUGIN` from `../constants/index.js`; `toErrorMessage` from `../utils/conversions.js`. Keep all doc comments. Export only `setupEnhancedEmissionSystem`.

- [ ] **Step 2: Rewire `src/index.ts`**

Remove the five moved functions. Add `import { setupEnhancedEmissionSystem } from './plugin/emission.js';`. The one call site is in `startServices` (`index.ts:466`, `setupEnhancedEmissionSystem(instance, config, app)`), now resolved by the import. Drop imports that only the moved emission code used (`isMarineDataEmpty`, `SKVersion`, `PathValue`, and `buildValuesDelta` if index.ts has no other user; note `buildValuesDelta` is also used elsewhere in index.ts, so keep it if still referenced) wherever the gate reports them unused.

- [ ] **Step 3: Run the gate**

Run: `npm run validate`
Expected: green. The integration tests that drive emission ticks still pass (the emit path is unchanged; only its home moved). `git grep -n "function emitWeatherTick\|function withEmissionTimestamp" src/index.ts` returns nothing.

- [ ] **Step 4: Commit**

```bash
git add src/plugin/emission.ts src/index.ts
git commit -m "refactor: extract the emission tick system into a plugin module"
```

---

### Task 5: Extract the panel REST routes

**Files:**
- Create: `src/plugin/panelRoutes.ts`
- Modify: `src/index.ts`
- Test: existing suite via the gate

**Interfaces:**
- Consumes: `PluginInstance` from `src/plugin/instance.js` (Task 1).
- Produces: `src/plugin/panelRoutes.ts` exports `registerPanelRoutes(router: IRouter, instance: PluginInstance): void` (currently `index.ts:978-1060`). It carries with it the module-private `sanitizeClientErrorMessage` (`1068`) and `testApiKey` (`1083`). The test-key rate-limiter state (`TEST_KEY_RATE_LIMIT`, `TEST_KEY_WINDOW_MS`, `testKeyHits`) is declared INSIDE the `registerPanelRoutes` body (lines 1019-1021), so it is closure-local and moves intact with the function; there is no separate module-level mutable state to relocate.

- [ ] **Step 1: Create `src/plugin/panelRoutes.ts`**

Move `registerPanelRoutes` (with its closure-local rate-limiter state), `sanitizeClientErrorMessage`, and `testApiKey`. Add the imports the moved code uses: `IRouter`, `Request`, `Response` from `express`; `PluginInstance` from `./instance.js`; `AccuWeatherService` from `../services/AccuWeatherService.js` (the test-key probe constructs one directly); `PanelStatusResponse` from `../types/index.js`; `TEST_KEY_LOCATION` from `../constants/index.js`; `validateKeyLength` from `../constants/notifications-shared.js`; `toErrorMessage` from `../utils/conversions.js`; and `msToWholeMinutes` from its current source (find the module index.ts imports it from). `PLUGIN` is NOT referenced by the routes, so do not import it here. Keep all doc comments, including the `biome-ignore` line on `sanitizeClientErrorMessage`'s control-character regex. Export only `registerPanelRoutes`.

- [ ] **Step 2: Rewire `src/index.ts`**

Remove the moved functions. Add `import { registerPanelRoutes } from './plugin/panelRoutes.js';`. The one call site is `registerWithRouter` (`index.ts:346`, `registerPanelRoutes(router, instance)`), now resolved by the import. Drop imports that only the moved route code used (for example the `IRouter` type, `AccuWeatherService`, `TEST_KEY_LOCATION`, `PanelStatusResponse`, the panel validation helpers) wherever the gate reports them unused.

- [ ] **Step 3: Run the gate**

Run: `npm run validate`
Expected: green. The route tests in `index.test.ts` (`/api/status`, `/api/test-key`) still pass. `git grep -n "function registerPanelRoutes\|function testApiKey" src/index.ts` returns nothing.

- [ ] **Step 4: Commit**

```bash
git add src/plugin/panelRoutes.ts src/index.ts
git commit -m "refactor: extract the panel REST routes into a plugin module"
```

---

## Self-Review

Run after all tasks:

- [ ] `npm run validate` green: type-check (including panel), Biome, full Vitest (>= 443 plus the new schema tests).
- [ ] `wc -l src/index.ts` is roughly 350 or fewer; `ls src/plugin/` shows `instance.ts`, `logging.ts`, `schema.ts`, `emission.ts`, `panelRoutes.ts`.
- [ ] `git grep -n "from '\.\./index" src/plugin` returns nothing (no back-edge from an extracted module into the entry file).
- [ ] `git grep -n "'accuweather'" src/index.ts` does not show the `sourceRef` seed (it now seeds the neutral default).
- [ ] The schema the admin UI receives is unchanged: the new schema test asserts the generated notifications block equals the shared-registry-derived shape, and `index.test.ts`'s schema assertions still pass.
- [ ] No runtime behavior changed: emitted deltas, REST responses, and log output are identical; only the code's location moved.

## Hand-off

After this split, `index.ts` is the plugin factory plus the lifecycle and service-orchestration glue. Adding a config field touches `src/plugin/schema.ts` (and a new field generates its notification toggle automatically if it is a band), a REST route touches `src/plugin/panelRoutes.ts`, and the emission path touches `src/plugin/emission.ts`, none of which means editing the entry file. This unblocks roadmap follow-on item 10 (the `AccuWeatherService` HTTP/quota/location-cache extraction) and keeps the entry point readable as Plans 2 and 3 add provider and merge wiring.
