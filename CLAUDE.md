# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Signal K plugin that provides comprehensive weather data with NMEA2000-compatible environmental measurements. Outputs 30+ weather data points including temperatures, wind, atmospheric conditions, and marine safety indices.

**Multi-provider (since v1.9.0).** The plugin sources current conditions through a `CurrentWeatherProvider` seam (`src/providers/WeatherProvider.ts`), so the orchestration and the path mapper are provider-agnostic over the internal SI `WeatherData` type. Two providers implement it: keyless global **Open-Meteo** (`OpenMeteoService`, the default for new installs) and **AccuWeather** (`AccuWeatherService`, optional, key-gated, kept for its exclusive fields). `resolveWeatherProvider` in `constants/notifications-shared.ts` picks the provider migration-safely: an explicit `weatherProvider` wins, otherwise an existing AccuWeather key keeps AccuWeather active and a fresh install defaults to Open-Meteo, so an upgrade never silently switches a working install or its `$source`. `createCurrentWeatherProvider` (`src/providers/`) constructs the selection; `index.ts` injects it into `WeatherService` and `NMEA2000PathMapper`. The active provider's `sourceRef` is threaded through `skDelta` so Open-Meteo deltas carry `$source: 'open-meteo'` and AccuWeather keeps `accuweather`. AccuWeather retired its permanent free tier (now a 14-day trial, then paid), which is why a keyless default exists. The v2 Weather API forecast provider is advertised only when AccuWeather is active (Open-Meteo forecast support is planned). Open-Meteo provides fewer fields than AccuWeather: no RealFeel, RealFeel shade, measured WBGT (estimated via `estimateWetBulbGlobeTemperature` so the heat-stress band still works), pressure tendency, precipitation type, ceiling, visibility obstruction, or 24h departure; severe-condition text comes from WMO weather codes. The provider-specific condition-to-severity maps live in `src/providers/accuweather-severity.ts` and `src/providers/open-meteo-severity.ts`, and the notifier consumes the provider-agnostic `WeatherData.severeCondition` they produce.

## Commands

### Build
```bash
npm run build          # Full build: clean → types → bundle
npm run build:types    # TypeScript declarations only
npm run build:bundle   # esbuild bundle only
npm run dev            # Development with hot reload (tsx watch)
```

### Test
```bash
npm run test           # Run suite once (Vitest); registry/CI safe
npm run test:watch     # Watch mode (Vitest)
npm run test:run       # Run once (alias of test, used by `validate`)
npm run test:coverage  # Coverage report (80% thresholds)
npm run test:ui        # Interactive UI
```

### Lint and Format
```bash
npm run lint           # Biome check
npm run lint:fix       # Auto-fix issues
npm run format         # Format code
npm run type-check     # TypeScript verification
npm run validate       # All checks (pre-commit uses this)
```

## Architecture

```
src/
├── index.ts                    # Plugin entry point and lifecycle (start/stop/registerWithRouter)
├── services/
│   ├── WeatherService.ts           # Orchestration: coordinates API, navigation, calculations
│   ├── AccuWeatherService.ts       # API client: 30+ field extraction, location caching, verifyApiKey
│   ├── WeatherProviderAdapter.ts   # SK v2 Weather API provider: getForecasts(point/daily), quota-shared
│   └── SignalKService.ts           # Vessel navigation data retrieval
├── calculators/
│   └── WindCalculator.ts           # Vector math for apparent wind, Beaufort scale
├── mappers/
│   ├── NMEA2000PathMapper.ts       # Weather data → Signal K delta messages
│   └── WeatherProviderMapper.ts    # AccuWeather forecast responses → SK v2 WeatherData envelope
├── notifications/
│   └── WeatherNotifier.ts      # Transition state machine: WeatherData → notifications.environment.* deltas
├── configpanel/                # React 19 federated config panel, TypeScript (bundled by webpack to public/)
│   ├── index.tsx               # Module Federation entry
│   ├── PluginConfigurationPanel.tsx  # Composition root: theme injection, section state, save orchestration
│   ├── styles.ts               # --svws-* design tokens: scale + LIGHT/DARK/NIGHT palettes, THEME_STYLE
│   ├── api-base.ts             # API_BASE plus panel-shared helpers (toErrorText, clampNumber, fetchJson)
│   ├── components/             # Section, NumberInput, StatusDashboard, ApiKeyField, NotificationToggles, FooterBar, ThemeToggle
│   └── hooks/                  # useStatus (visibility-gated polling), usePanelConfig (form state, dirty tracking, save flow)
├── utils/
│   ├── validation.ts           # Config validation, NMEA2000 range sanitization
│   ├── conversions.ts          # Unit conversions (temp, pressure, wind, Beaufort scale) + `asTimestamp` brand helper
│   └── skDelta.ts              # Shared SK delta primitives: pv / me / buildValuesDelta / buildMetaDelta
├── constants/
│   ├── index.ts                # PGN numbers, Signal K paths, notification paths + thresholds, validation limits, TEST_KEY_LOCATION
│   └── notifications-shared.ts # Single source for runtime, schema, and panel: NOTIFICATION_LABELS, NOTIFICATION_MASTER_LABEL, DEFAULT_NOTIFICATIONS, CONFIG_DEFAULTS, API_KEY_MIN_LENGTH, QUOTA_WARN_RATIO, PLUGIN_NAME, validateKeyLength
└── types/
    └── index.ts                # All interfaces (readonly), type guards, NotificationsConfig, NotificationValue, PanelStatusResponse
```

### Data Flow
```
AccuWeather API → AccuWeatherService → WeatherService
                                            ↓
Signal K Server ← NMEA2000PathMapper ← WindCalculator
```

### Hybrid Emission System
The plugin uses interval-based emission (default 5 seconds) for NMEA2000 network recognition reliability, combined with event-driven updates when new weather data arrives.

## Key Patterns

- **Official SignalK Types**: Uses `Plugin` and `ServerAPI` from `@signalk/server-api`
- **Dependency Injection**: Services accept logger as constructor parameter
- **Readonly Interfaces**: All public interfaces use `readonly` properties
- **Type Guards**: `isCompleteNavigationData()` for narrowing vessel-data branches
- **Centralized Constants**: Validation limits, PGN numbers, and paths in constants/index.ts
- **SI Units**: All calculations use m/s for speed, radians for angles, Kelvin for temperature

## Testing

Tests are in `src/__tests__/` mirroring the source structure. Run a single test file:
```bash
npx vitest run src/__tests__/calculators/WindCalculator.test.ts
```

Test configuration in `vitest.config.ts` includes path aliases (`@/`, `@/services/`, etc.).

## Signal K Spec Compliance (1.8.2)

- **Canonical paths only under canonical containers**: `environment.outside.{temperature,pressure,relativeHumidity,dewPointTemperature,apparentWindChillTemperature,theoreticalWindChillTemperature,heatIndexTemperature,airDensity}` and `environment.wind.{speedOverGround,directionTrue}` are the only leaves the plugin emits under `environment.outside.*` / `environment.wind.*`. Calculated apparent wind is producer-namespaced (see below): it is synthetic and must not squat the canonical anemometer leaves. `heatIndexTemperature` carries a computed NWS Rothfusz heat index, not AccuWeather RealFeel. Both wind-chill leaves are emitted: `theoreticalWindChillTemperature` is wind chill from the true (ground-referenced) wind; `apparentWindChillTemperature` is wind chill from the apparent wind once vessel motion is folded in, falling back to the theoretical value when no vessel motion data is available. The 1.8.2 vocabulary defines those containers as leaf-only; squatting an object node like `environment.outside.derived` violates that contract.
- **Producer-namespaced branch for everything else**: `environment.weather.*` holds AccuWeather extensions (UV, visibility, cloud cover, absolute humidity, precipitation, 24h departure, wet bulb temperatures, apparent temperature, RealFeel, RealFeel shade, pressure tendency, precipitation type, visibility obstruction, plain-language weather description) and plugin-derived values (Beaufort scale, gust factor, heat stress index, wind gust speed, apparent wind speed and angle: `windSpeedApparent` / `windAngleApparent`). Source provenance is in `$source`, not in the path, so consumers can swap weather providers without re-subscribing.
- **AccuWeather wind is ground-referenced**, so the plugin emits `speedOverGround` only. It does NOT emit `speedTrue` (which is water-referenced and would clobber a real anemometer feed on a moving vessel). Wind direction is true-north per the WMO surface-wind convention; the rationale is pinned in `AccuWeatherService.transformWeatherData`.
- **`$source: 'accuweather'`** is set on every delta (constant lives in `PLUGIN.SOURCE_REF`) so users can configure source priorities to prefer real onboard sensors.
- **Meta delta**: `NMEA2000PathMapper.buildMetaDelta()` returns a one-shot meta delta describing units/labels/descriptions for every `environment.weather.*` measurement path AND every `notifications.environment.*` path. `index.ts` ships it exactly once per start() cycle, after the first values delta (admin-UI rendering workaround, not a spec ordering requirement), via `app.handleMessage(..., SKVersion.v1)`. The meta-emitted flag resets in `cleanup()` so a restart re-attaches the meta block.
- **`displayUnits` meta hints**: the Signal K unit-preferences system categorizes a path purely by its SI base unit when the path is not in the server's `default-categories.json` (which only covers canonical spec paths). Every `environment.weather.*` path is non-canonical, so a path declaring `units: 'm'` gets bucketed with distances (rendered in miles/feet) and one declaring `units: 'K'` is treated as an absolute temperature (the K-to-C/F offset applied). Two paths carry a quantity whose base unit lies about its kind: `precipitationLastHour` is a depth (would show as miles) and `temperatureDeparture24h` is a delta (would show as an absolute Fahrenheit temperature). Both pin a `displayUnits` block in their `NON_CANONICAL_META` entry (`precipitationLastHour` -> custom `mm` conversion; `temperatureDeparture24h` -> `base` identity) so the data browser renders them correctly. The emitted value and `units` are unchanged; `displayUnits` is a render hint only. Do NOT emit a precipitation rate in `m/s`: AccuWeather provides no instantaneous rate, and `m/s` collides with the speed category.
- **Status banner**: `WeatherService.formatStatusBanner()` returns the live `Running, last update Nm ago (N updates, K API requests)` string used by `setPluginStatus` (or `Running, awaiting first update` before the first fetch). The `K API requests` suffix is appended only when `AccuWeatherService.getRequestCount()` is non-zero. When `dailyApiQuota > 0` the suffix gains a `, K/Q today` segment showing the rolling 24h count; at 90% the prefix flips to `Running [quota 90% used]`, and at 100% the plugin trips `setPluginError` via `WeatherService.isQuotaExhausted()` and skips fetches until usage drops. Format and counters live together on `WeatherService`; `index.ts` just routes the call. The banner is re-pushed on every successful `emitWeatherTick` so the age and counters stay current (and the start-time `awaiting first update` string flips as soon as the first fetch lands).
- **Daily API quota**: `dailyApiQuota` config option (default 50, range 0 to 1000; 0 disables). `AccuWeatherService` tracks usage via a rolling 24h window backed by 24 fixed hourly buckets that rotate on read/write (O(1) memory regardless of uptime). Accessor: `getRequestCountLast24h()`.
- **PGNs** (when paired with `signalk-nmea2000-emitter-cannon`): 130311/130314 (pressure), 130312/130316 (temperatures via fixed enum slots: temperature, dewPoint, apparentWindChill, theoreticalWindChill, heatIndex), 130313 (relativeHumidity), 130306 (wind: `speedOverGround`, `directionTrue`). The plugin's synthetic apparent wind (`environment.weather.windSpeedApparent` / `windAngleApparent`) is producer-namespaced; it bridges to PGN 130306 only through the cannon's opt-in `WIND_WEATHER_APPARENT` conversion, which is off by default so it cannot compete with a real masthead anemometer. Gust (`environment.weather.speedGust`) does not bridge: the cannon ships no conversion for it. Instance numbers and bus priority are assigned by the companion plugin, not embedded in the deltas this plugin produces.
- **Notifications** (opt-in, off by default): `notifications.environment.*` per SK 1.8.2 notifications.html. Distinct paths per band (`wind.gale|storm|hurricane`, `visibility.low|veryLow`, `heat.caution|high|extreme`, `cold.caution|extreme`, `weather.severe`) so consumers caching by path+id see independent transitions. Value shape `{ state, method, message, timestamp }`, `state: 'normal'` on exit. The notifier is a pure transition emitter (Map of last-seen states), so unchanged snapshots produce zero output. Bridging to N2K Alert PGN 126983 / 126985 requires the separate `signalk-to-nmea2000` plugin: this plugin emits SK-native deltas only. Config branch: `notifications: { enabled, wind, visibility, heat, cold, weather }`.
- **Weather API provider**: `index.ts` registers a Signal K v2 Weather API provider via `app.registerWeatherProvider(...)` in `startServices`, and unregisters via `app.weatherApi.unRegister(PLUGIN.NAME)` in the `stop` closure. `WeatherProviderAdapter` (`src/services/WeatherProviderAdapter.ts`) implements the provider; `getForecasts('point')` is backed by the AccuWeather 12-hour hourly endpoint and `getForecasts('daily')` by the 5-day daily endpoint, both mapped to the SI `WeatherData` envelope by pure functions in `src/mappers/WeatherProviderMapper.ts`. `getObservations` and `getWarnings` throw `'Not supported!'` for now (Phases 2 and 3). Forecast fetches share the one `AccuWeatherService` instance, its location-key cache, and its rolling-24h quota window; an on-demand forecast cache (`FORECAST_CACHE` TTLs: 30 min hourly, 3 h daily) plus stale-on-quota-exhaustion keeps a polling consumer from exhausting the free 50/day key. Registering the provider is what makes the server advertise `weather` in `/signalk/v2/features`, which is the flag dashboards like signalk-binnacle gate their weather UI on.
- **Notification message enrichment**: each band's `message` packs adjacent context the operator can act on without subscribing to extra paths. Wind: `"Gale-force wind: Bf9 from SW, 19 m/s, gusts 27 m/s, 998 hPa"`. Visibility: `"Reduced visibility: 0.8 km, ceiling 90 m, rain 2.5 mm/h"` (ceiling and precip rate appended when finite). Heat: `"High heat stress: HSI 3, WBGT 32 C, RH 78%, RealFeel 35 C"`. Cold: `"Cold exposure caution: wind chill -2 C, air 1 C, wind 12 m/s"`. Severe: `"Thunderstorms: Severe thunderstorms approaching, 998 hPa"`. Every message is capped at `MAX_MESSAGE_LENGTH = 80` chars (with `…` truncation) so it renders cleanly on the marine displays most likely to bridge through `signalk-to-nmea2000` (NMEA 2000 Alert PGN Text fields render 64..128 chars across the Garmin/Raymarine/B&G/Furuno fleet; 80 is a safe common denominator). Helpers `formatWindSuffix` / `formatVisibilitySuffix` / `formatHeatSuffix` / `formatColdSuffix` / `formatSevereSuffix` live alongside the `WeatherNotifier` class in `src/notifications/WeatherNotifier.ts` so the format and the band evaluators stay together.
- **Banner dedupe**: every `setPluginStatus` / `setPluginError` call in `index.ts` routes through `setBanner()` which dedupes consecutive identical `(kind, message)` pairs. A flapping API or steady-state quota pause therefore lands one banner write per unique message, not one per 5-second emission tick. `WeatherService.updateWeatherData` also pushes the live banner directly on the first successful update so the "awaiting first update" string flips the moment data lands.
- **Shared SK delta primitives**: `src/utils/skDelta.ts` exports `pv` (PathValue builder), `me` (Meta builder), `buildValuesDelta(values, timestamp?)`, `buildMetaDelta(meta)`, plus `SELF_CONTEXT` and `ACCUWEATHER_SOURCE` branded-cast constants. Mapper, notifier, and plugin entry all build deltas through this module instead of hand-rolling the envelope.
- **Federated React config panel** (since v1.5.0; loads cleanly since v1.5.1 fixed the ESM federation library type; TypeScript since v1.8.0): `src/configpanel/PluginConfigurationPanel.tsx` is the composition root, with `components/`, `hooks/`, `styles.ts` (design tokens), and `api-base.ts` (panel-shared helpers), all bundled by `webpack.config.cjs` (must be `.cjs` because our `package.json` is `"type": "module"`) into `public/` via `ModuleFederationPlugin`. babel transpiles (`@babel/preset-typescript` + `@babel/preset-react`); types are checked separately by `tsconfig.panel.json` via `npm run type-check:panel` (chained into `type-check`). The root `tsconfig.json` excludes `src/configpanel` so the runtime declaration build never compiles the panel. React 19 is declared `singleton` so the panel shares the host admin UI's React. The `signalk-plugin-configurator` keyword in `package.json` triggers the SK admin UI to load the panel in place of the auto-generated rjsf form; the JSON `schema()` is kept as a fallback for older admin UIs (an ESM federation container loads only on admin UI 2.27.0+, so older hosts fall back to the rjsf form).
- **Panel theming and accessibility** (since v1.8.0, aligned with the signalk-nmea2000-emitter-cannon panel): `styles.ts` defines a `--svws-*` CSS custom-property contract with scale tokens plus LIGHT, DARK, and NIGHT (night-red helm) palettes, each with a `color-scheme` declaration and documented WCAG AA contrast ratios on muted text. The host admin UI theme is matched via `[data-bs-theme="dark"] .svws-panel`; an explicit user pick (ThemeToggle: Auto/Light/Dark/Night) pins a `data-svws-theme` attribute persisted to localStorage key `svws-theme`. A hex literal in a component (rather than `styles.ts`) is a defect. Marine sizing: 22px checkboxes, 36px minimum button height. The panel tracks dirty state (sticky FooterBar with Save and Discard, `beforeunload` guard), confirms the post-save restart via status polling before claiming success, and renders the stat dashboard even when stopped.
- **ESM federation gotcha (load-bearing)**: because `package.json` has `"type": "module"`, `signalk-server` injects the panel script as `<script type="module">` (see `signalk-server/src/serverroutes.ts` ~line 265), and the admin UI loader expects ESM `.get` / `.init` exports on the resolved module. The webpack config therefore MUST use `experiments.outputModule: true`, `output.module: true`, `output.chunkFormat: 'module'`, and `library: { type: 'module' }`. A `library: { type: 'var' }` bundle would assign to `window.<safeName>` via a classic script and export nothing via ESM, so the admin UI's `await import()` resolves to an empty module and logs `Could not load module signalk-virtual-weather-sensors` with no other diagnostic. v1.5.0 shipped with this bug; v1.5.1 fixes it. Panel chunks are emitted as `.mjs`.
- **Shared cross-boundary constants**: `src/constants/notifications-shared.ts` is the single source of truth consumed by the TS runtime, the rjsf schema in `src/index.ts`, and the federated panel: `NOTIFICATION_LABELS` (5 sub-toggle strings), `NOTIFICATION_MASTER_LABEL`, `NOTIFICATION_BAND_KEYS`, `DEFAULT_NOTIFICATIONS`, `CONFIG_DEFAULTS`, `API_KEY_MIN_LENGTH`, `QUOTA_WARN_RATIO`, `PLUGIN_NAME` / `PLUGIN_DISPLAY_NAME`, and `validateKeyLength()`. Existing imports use the `.js` specifier (NodeNext style); webpack resolves them to the `.ts` source via `extensionAlias`. Labels, defaults, bounds, and the quota ratio can no longer drift between the panel, the schema, and the runtime. (Until v1.8.0 this was a plain-JS module with a hand-synced `.d.ts` shim; both collapsed into the single `.ts` file.)
- **Panel-supporting REST endpoints**: `Plugin.registerWithRouter` mounts `GET /api/status` (live banner + 24h API count + minutes since last fetch + active-notification count + `weatherProviderRegistered` flag, typed as `PanelStatusResponse` in `src/types/index.ts`; the panel renders the flag as a "Weather API" On/Off stat card) and `POST /api/test-key` (probes a candidate AccuWeather key with one `AccuWeatherService.verifyApiKey()` call, single AccuWeather API call per test). Both endpoints are read-only or non-mutating; neither persists a key. The panel polls `/api/status` every 10 s. `TEST_KEY_LOCATION` (Greenwich Observatory coords, arbitrary fixed point) lives in `src/constants/index.ts`.

## Technology Stack

- TypeScript 6.0+ (strict mode, ES2023 target)
- Node.js 20.18+ (ESM only)
- `@signalk/server-api` 2.24+ as a `peerDependency` (the Signal K server provides it at runtime; not bundled). Used for `Plugin`, `ServerAPI`, `Delta`, `PathValue`, `Meta`, `MetaValue`, `SourceRef`, and `SKVersion` types.
- esbuild 0.28+ for bundling (current bundle ~98 KiB)
- Biome 2.4+ for linting/formatting (with `noFloatingPromises` / `noMisusedPromises` enabled)
- Vitest 4.1+ for testing (334 tests across 13 files; mutation score 67% via Stryker.js, opt-in via `npm run mutation-test`). `npm test` runs once (registry/CI safe); `npm run test:watch` is the interactive watcher.
- React 19, webpack 5, @babel/preset-react, @babel/preset-typescript, babel-loader, @types/react, @types/express for the federated config panel (panel-only deps, runtime is unaffected); panel types checked by `tsconfig.panel.json`
- Husky + lint-staged for an opt-in pre-commit hook (enable with `npm run hooks`; there is intentionally no `prepare` script, since its lifecycle banner breaks the SignalK App Store install simulation on Node 22's npm 10)

## Documentation Structure

Docs are organized by audience. Do not move files back to the repo root: a clean
root is the deliberate first impression for npm and GitHub.

```
root/
  README.md        # end-user landing page, also the npm package page
  CHANGELOG.md     # full Keep-a-Changelog history (canonical release record)
  CLAUDE.md        # this file (tooling convention keeps it at root)
  LICENSE
.github/           # GitHub auto-surfaces these from .github/ exactly as from root
  CONTRIBUTING.md  CODE_OF_CONDUCT.md  SECURITY.md
  ISSUE_TEMPLATE/  pull_request_template.md  workflows/  CODEOWNERS  dependabot.yml
docs/
  signal-k-paths.md     # user/integrator reference: paths, PGNs, notifications
  troubleshooting.md    # user reference: status-banner issues
  DEVELOPMENT.md        # contributor reference: stack, build, test, SK compliance
  decisions/            # design-decision and spike memos (api-key-storage, weather-provider-migration)
  maintainers/          # maintainer-internal: RELEASE.md, manual-server-test.md
```

- **README is the npm page.** npm renders only `README.md`; relative links resolve to the GitHub repo. Keep it a landing page (features, requirements, install, config, what-it-emits, integration, notifications, troubleshooting summary, doc index), not a reference manual. Deep reference lives in `docs/`.
- **Relative links cross directories.** Files in `.github/` and `docs/` reach the root with `../` (for example `.github/CONTRIBUTING.md` links `../LICENSE`, `../docs/DEVELOPMENT.md`). After any doc move, re-verify every relative markdown link.
- **`docs/DEVELOPMENT.md` heading anchors are load-bearing.** `.github/pull_request_template.md` links `../docs/DEVELOPMENT.md#signal-k-standards-compliance`; keep that heading text stable.

## Release Process

- **README carries the latest release's notes.** The README has a `## What's new in X.Y.Z` section, placed right after the intro and safety blockquote and before `## What it does`. It holds ONLY the most recent release, overwritten on every release (never an accumulating list); the full history stays in `CHANGELOG.md`.
- **What's new content shape.** A one-sentence lead, then 3 to 5 bolded-lead bullets sourced from the `CHANGELOG.md` entry (`CHANGELOG.md` is canonical, written first), then a closing line linking the version's changelog anchor and the changelog for the full list. Each release heading in `CHANGELOG.md` carries an explicit `<a id="vXYZ"></a>` anchor (version digits without dots, e.g. `#v180` for 1.8.0); link that anchor, not the GitHub auto-generated heading anchor.
- **Release step.** `docs/maintainers/RELEASE.md` Fast Path step 1 includes overwriting the README `## What's new` section. Bump the heading version, add the new `<a id="vXYZ"></a>` anchor in `CHANGELOG.md`, and update the README link each release.
