# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Signal K plugin that provides comprehensive weather data from AccuWeather API with NMEA2000-compatible environmental measurements. Outputs 24+ weather data points including temperatures, wind, atmospheric conditions, and marine safety indices.

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
npm run test           # Watch mode (Vitest)
npm run test:run       # Run once
npm run test:coverage  # Coverage report (80% thresholds)
npm run test:ui        # Interactive UI
```

### Lint & Format
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
├── index.ts                    # Plugin entry point & lifecycle (start/stop/registerWithRouter)
├── services/
│   ├── WeatherService.ts       # Orchestration: coordinates API, navigation, calculations
│   ├── AccuWeatherService.ts   # API client: 24+ field extraction, location caching, verifyApiKey
│   └── SignalKService.ts       # Vessel navigation data retrieval
├── calculators/
│   └── WindCalculator.ts       # Vector math for apparent wind, Beaufort scale
├── mappers/
│   └── NMEA2000PathMapper.ts   # Weather data → Signal K delta messages
├── notifications/
│   └── WeatherNotifier.ts      # Transition state machine: WeatherData → notifications.environment.* deltas
├── configpanel/                # React 19 federated config panel (bundled by webpack to public/)
│   ├── index.js                # Module Federation entry
│   └── PluginConfigurationPanel.jsx
├── utils/
│   ├── validation.ts           # Config validation, NMEA2000 range sanitization, API_KEY_MIN_LENGTH
│   ├── conversions.ts          # Unit conversions (temp, pressure, wind, Beaufort scale) + `asTimestamp` brand helper
│   └── skDelta.ts              # Shared SK delta primitives: pv / me / buildValuesDelta / buildMetaDelta
├── constants/
│   ├── index.ts                # PGN numbers, Signal K paths, notification paths + thresholds, validation limits, TEST_KEY_LOCATION
│   ├── notifications-shared.js # Shared NOTIFICATION_LABELS + DEFAULT_NOTIFICATIONS consumed by both TS runtime and JSX panel
│   └── notifications-shared.d.ts # Type shim for the .js module under allowJs:false
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
- **Status banner**: `WeatherService.formatStatusBanner()` returns the live `Running, last update Nm ago (N updates, K API requests)` string used by `setPluginStatus` (or `Running, awaiting first update` before the first fetch). The `K API requests` suffix is appended only when `AccuWeatherService.getRequestCount()` is non-zero. When `dailyApiQuota > 0` the suffix gains a `, K/Q today` segment showing the rolling 24h count; at 90% the prefix flips to `Running [quota 90% used]`, and at 100% the plugin trips `setPluginError` via `WeatherService.isQuotaExhausted()` and skips fetches until usage drops. Format and counters live together on `WeatherService`; `index.ts` just routes the call. The banner is re-pushed on every successful `emitWeatherTick` so the age and counters stay current (and the start-time `awaiting first update` string flips as soon as the first fetch lands).
- **Daily API quota**: `dailyApiQuota` config option (default 50, range 0 to 1000; 0 disables). `AccuWeatherService` tracks usage via a rolling 24h window backed by 24 fixed hourly buckets that rotate on read/write (O(1) memory regardless of uptime). Accessor: `getRequestCountLast24h()`.
- **PGNs** (when paired with `signalk-nmea2000-emitter-cannon`): 130311/130314 (pressure), 130312/130316 (temperatures via fixed enum slots: temperature, dewPoint, apparentWindChill, theoreticalWindChill, heatIndex), 130313 (relativeHumidity), 130306 (wind: `speedOverGround`, `directionTrue`). The plugin's synthetic apparent wind (`environment.weather.windSpeedApparent` / `windAngleApparent`) is producer-namespaced; it bridges to PGN 130306 only through the cannon's opt-in `WIND_WEATHER_APPARENT` conversion, which is off by default so it cannot compete with a real masthead anemometer. Gust (`environment.weather.speedGust`) does not bridge: the cannon ships no conversion for it. Instance numbers and bus priority are assigned by the companion plugin, not embedded in the deltas this plugin produces.
- **Notifications** (opt-in, off by default): `notifications.environment.*` per SK 1.8.2 notifications.html. Distinct paths per band (`wind.gale|storm|hurricane`, `visibility.low|veryLow`, `heat.caution|high|extreme`, `cold.caution|extreme`, `weather.severe`) so consumers caching by path+id see independent transitions. Value shape `{ state, method, message, timestamp }`, `state: 'normal'` on exit. The notifier is a pure transition emitter (Map of last-seen states), so unchanged snapshots produce zero output. Bridging to N2K Alert PGN 126983 / 126985 requires the separate `signalk-to-nmea2000` plugin: this plugin emits SK-native deltas only. Config branch: `notifications: { enabled, wind, visibility, heat, cold, weather }`.
- **Notification message enrichment**: each band's `message` packs adjacent context the operator can act on without subscribing to extra paths. Wind: `"Gale-force wind: Bf9 from SW, 19 m/s, gusts 27 m/s, 998 hPa"`. Visibility: `"Reduced visibility: 0.8 km, ceiling 90 m, rain 2.5 mm/h"` (ceiling and precip rate appended when finite). Heat: `"High heat stress: HSI 3, WBGT 32 C, RH 78%, RealFeel 35 C"`. Cold: `"Cold exposure caution: wind chill -2 C, air 1 C, wind 12 m/s"`. Severe: `"Thunderstorms: Severe thunderstorms approaching, 998 hPa"`. Every message is capped at `MAX_MESSAGE_LENGTH = 80` chars (with `…` truncation) so it renders cleanly on the marine displays most likely to bridge through `signalk-to-nmea2000` (NMEA 2000 Alert PGN Text fields render 64..128 chars across the Garmin/Raymarine/B&G/Furuno fleet; 80 is a safe common denominator). Helpers `formatWindSuffix` / `formatVisibilitySuffix` / `formatHeatSuffix` / `formatColdSuffix` / `formatSevereSuffix` live alongside the `WeatherNotifier` class in `src/notifications/WeatherNotifier.ts` so the format and the band evaluators stay together.
- **Banner dedupe**: every `setPluginStatus` / `setPluginError` call in `index.ts` routes through `setBanner()` which dedupes consecutive identical `(kind, message)` pairs. A flapping API or steady-state quota pause therefore lands one banner write per unique message, not one per 5-second emission tick. `WeatherService.updateWeatherData` also pushes the live banner directly on the first successful update so the "awaiting first update" string flips the moment data lands.
- **Shared SK delta primitives**: `src/utils/skDelta.ts` exports `pv` (PathValue builder), `me` (Meta builder), `buildValuesDelta(values, timestamp?)`, `buildMetaDelta(meta)`, plus `SELF_CONTEXT` and `ACCUWEATHER_SOURCE` branded-cast constants. Mapper, notifier, and plugin entry all build deltas through this module instead of hand-rolling the envelope.
- **Federated React config panel** (since v1.5.0; loads cleanly since v1.5.1 fixed the ESM federation library type): `src/configpanel/PluginConfigurationPanel.jsx` is the panel component, bundled by `webpack.config.cjs` (must be `.cjs` because our `package.json` is `"type": "module"`) into `public/` via `ModuleFederationPlugin`. React 19 is declared `singleton` so the panel shares the host admin UI's React. The `signalk-plugin-configurator` keyword in `package.json` triggers the SK admin UI to load the panel in place of the auto-generated rjsf form; the JSON `schema()` is kept as a fallback for older admin UIs.
- **ESM federation gotcha (load-bearing)**: because `package.json` has `"type": "module"`, `signalk-server` injects the panel script as `<script type="module">` (see `signalk-server/src/serverroutes.ts` ~line 265), and the admin UI loader expects ESM `.get` / `.init` exports on the resolved module. The webpack config therefore MUST use `experiments.outputModule: true`, `output.module: true`, `output.chunkFormat: 'module'`, and `library: { type: 'module' }`. A `library: { type: 'var' }` bundle would assign to `window.<safeName>` via a classic script and export nothing via ESM, so the admin UI's `await import()` resolves to an empty module and logs `Could not load module signalk-virtual-weather-sensors` with no other diagnostic. v1.5.0 shipped with this bug; v1.5.1 fixes it. Panel chunks are emitted as `.mjs`.
- **Shared notification labels and defaults**: `src/constants/notifications-shared.js` (plain ESM, no TS, no `allowJs:false` conflict thanks to a co-located `.d.ts` shim) is the single source of truth for `NOTIFICATION_LABELS` (the 5 sub-toggle strings) and `DEFAULT_NOTIFICATIONS` (the master+sub defaults). Both the TS plugin runtime (schema titles in `src/index.ts`, defaults in `src/constants/index.ts`) and the JSX federated panel import from it. Labels and defaults can no longer drift between the federated panel and the rjsf fallback form.
- **Panel-supporting REST endpoints**: `Plugin.registerWithRouter` mounts `GET /api/status` (live banner + 24h API count + minutes since last fetch + active-notification count, typed as `PanelStatusResponse` in `src/types/index.ts`) and `POST /api/test-key` (probes a candidate AccuWeather key with one `AccuWeatherService.verifyApiKey()` call, single AccuWeather API call per test). Both endpoints are read-only or non-mutating; neither persists a key. The panel polls `/api/status` every 10 s. `TEST_KEY_LOCATION` (Greenwich Observatory coords, arbitrary fixed point) lives in `src/constants/index.ts`.

## Technology Stack

- TypeScript 6.0+ (strict mode, ES2023 target)
- Node.js 20.18+ (ESM only)
- `@signalk/server-api` 2.24+ as a `peerDependency` (the Signal K server provides it at runtime; not bundled). Used for `Plugin`, `ServerAPI`, `Delta`, `PathValue`, `Meta`, `MetaValue`, `SourceRef`, and `SKVersion` types.
- esbuild 0.28+ for bundling (current bundle ~87 KB)
- Biome 2.4+ for linting/formatting (with `noFloatingPromises` / `noMisusedPromises` enabled)
- Vitest 4.1+ for testing (259 tests across 11 files; mutation score 67% via Stryker.js, opt-in via `npm run mutation-test`)
- React 19, webpack 5, @babel/preset-react, babel-loader, @types/express for the federated config panel (panel-only deps, runtime is unaffected)
- Husky + lint-staged for pre-commit hooks

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

- **README carries the latest release's notes.** The README has a `## What's New in vX.Y.Z` section, placed right after the intro paragraph and before `## Features`. It holds ONLY the most recent release, overwritten on every release (never an accumulating list); the full history stays in `CHANGELOG.md`.
- **What's New content shape.** A 2-to-4 sentence prose summary, not the Keep-a-Changelog bullet list. Source it from the `CHANGELOG.md` entry's lead paragraph (`CHANGELOG.md` is canonical, written first, lead-paragraph-first). The section ends with two links: the `CHANGELOG.md#xyz` anchor for that version and the GitHub release tag URL. GitHub anchor for `## [1.5.3] - 2026-05-16` is `#153---2026-05-16` (brackets and dots dropped, spaces to dashes).
- **Release step.** `docs/maintainers/RELEASE.md` Fast Path step 1 includes overwriting the README `## What's New` section. Bump the heading version and the changelog anchor each release.
