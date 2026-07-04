# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Signal K plugin that provides comprehensive weather data with NMEA2000-compatible environmental measurements. Outputs 30+ weather data points including temperatures, wind, atmospheric conditions, and marine safety indices.

**Multi-provider (since v1.9.0).** The plugin sources current conditions through a `CurrentWeatherProvider` seam (`src/providers/WeatherProvider.ts`), so the orchestration and the path mapper are provider-agnostic over the internal SI `WeatherData` type. Three providers implement it: keyless global **Open-Meteo** (`OpenMeteoService`, the default for new installs), keyless global **Met.no** (`MetNoService`, the Norwegian Meteorological Institute's Locationforecast 2.0), and **AccuWeather** (`AccuWeatherService`, optional, key-gated, kept for its exclusive fields). `resolveWeatherProvider` in `constants/notifications-shared.ts` picks the provider migration-safely: an explicit `weatherProvider` wins, otherwise an existing AccuWeather key keeps AccuWeather active and a fresh install defaults to Open-Meteo, so an upgrade never silently switches a working install or its `$source`. The construction half lives in `providerCatalog.ts` (`PROVIDER_CATALOG`, keyed by provider id); `createCurrentWeatherProvider` builds a single provider and `createWeatherProvider` wraps the selection in a `MergingWeatherProvider` when `weatherMode` is `merged`. In merged mode the providers to blend and their priority order come from the `mergeProviders` config list (first = primary), resolved migration-safely by `resolveMergeProviders` in `constants/notifications-shared.ts` (an absent or empty list falls back to `[primary, ...rest in catalog order]`, so a merged config written before the field existed resolves to the old behavior); `createWeatherProvider` filters that order to the actually available providers and degrades to a single provider when only one survives. `index.ts` injects the result into `WeatherService` and `NMEA2000PathMapper`. The active provider's `sourceRef` is threaded through `skDelta` so Open-Meteo deltas carry `$source: 'open-meteo'`, Met.no carries `met-no`, AccuWeather keeps `accuweather`, and merged mode carries `vws-merged`. AccuWeather retired its permanent free tier (now a 14-day trial, then paid), which is why keyless defaults exist. The v2 Weather API forecast provider is advertised for any forecast-capable provider: Open-Meteo, Met.no, and AccuWeather all support forecasts, so a default keyless install advertises it, and merged mode advertises it through its designated forecast child. Open-Meteo and Met.no provide fewer fields than AccuWeather: no RealFeel, RealFeel shade, measured WBGT (estimated via the heat-stress estimator so the heat-stress band still works), pressure tendency, precipitation type, ceiling, visibility obstruction, or 24h departure; severe-condition text comes from WMO weather codes (Open-Meteo) or Met.no symbol codes. The provider-specific condition-to-severity maps live in `src/providers/accuweather-severity.ts`, `src/providers/open-meteo-severity.ts`, and `src/providers/met-no-severity.ts`, and the notifier consumes the provider-agnostic `WeatherData.severeCondition` they produce.

**Merge mode.** Setting `weatherMode = 'merged'` in config builds a `MergingWeatherProvider` (`src/providers/MergingWeatherProvider.ts`) that wraps the atmospheric providers the operator chose in the `mergeProviders` pick-and-order list (first = primary), in that priority order, and blends their current-conditions results per the `FIELD_MERGE_KINDS` policy defined in `src/providers/mergeWeatherData.ts`. The panel's `MergeProviderList` edits that list (include checkboxes plus up/down reorder, AccuWeather key-gated, and the last included provider cannot be unchecked, so the panel cannot save an empty list); a list that resolves to a single available provider degrades to that single source with no synthesis. After blending the raw fields, derived quantities (wind chill, heat index, Beaufort scale, absolute humidity, air density, heat-stress index, gust factor) are recomputed from the merged base via `deriveBaseWeatherFields` so they stay internally consistent with the blended values. Forecasts and observations delegate to the highest-priority forecast-capable child; the marine layer and warnings run on their own independent paths and are never merged. Every merged delta carries `$source: 'vws-merged'`, which yields to a real onboard sensor under server source priorities exactly as the single-provider sources do. Two deliberate decisions are recorded here so a later reader does not "fix" them: (1) WBGT is NOT averaged but taken from the highest-priority provider that reports it (set AccuWeather as the primary to prefer its measured globe temperature; a `measured` flag for true prefer-measured semantics is a deferred enhancement); (2) the merged v2 observation is served by the designated forecast child rather than blending pressure across all children, for coherence with that child's forecast series (multi-child pressure blending is a deferred enhancement). The three `apparent*` fields (apparent wind speed, angle, and wind chill) are excluded from the merge output and added downstream in `WeatherService` after vessel motion is folded in.

**Optional marine layer (since v1.9.0).** A `marineData` config toggle (off by default) enables a keyless Open-Meteo Marine fetch (`OpenMeteoMarineService`, host `marine-api.open-meteo.com`, or the configured `openMeteoBaseUrl` for self-hosted), independent of the atmospheric provider. `WeatherService` fetches it best-effort on the same cadence and position as the weather update (a marine failure only logs, never fails the weather update), exposing it via `getCurrentMarineData()`. `MarinePathMapper` emits sea surface temperature on the canonical `environment.water.temperature` leaf, surface current on the canonical `environment.current` OBJECT node (`{ drift, setTrue }`, not dotted leaves), and waves/swell on producer-namespaced `environment.water.waves.*` / `swell.*` leaves with meta. Marine deltas carry a distinct `$source: 'open-meteo-marine'` so the model sea temperature and current yield to a real sensor under source priorities. `index.ts` emits the marine delta on the keep-alive cadence past the same staleness gate as weather, restamped, with marine meta shipped once and skipped entirely for inland points (`isMarineDataEmpty`). Pure mapper `src/mappers/OpenMeteoMarineMapper.ts` converts the Open-Meteo Marine current block (directions degrees to radians, SST Celsius to Kelvin, current km/h to m/s) into `MarineData`.

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
├── index.ts                    # Plugin entry point and lifecycle (start/stop/registerWithRouter, v2 provider registration)
├── plugin/
│   ├── instance.ts                 # Shared plugin instance state and the banner-dedupe helper (setBanner)
│   ├── emission.ts                 # Keep-alive emission tick: fixed-cadence NMEA2000-compatible delta broadcast
│   ├── logging.ts                  # Structured Logger factory bound to the server's debug/error
│   ├── panelRoutes.ts              # Panel REST routes (GET /api/status, POST /api/test-key)
│   └── schema.ts                   # rjsf schema() and uiSchema() generated from the shared band registry
├── services/
│   ├── WeatherService.ts           # Orchestration: coordinates provider, navigation, calculations, marine layer
│   ├── OpenMeteoService.ts         # Keyless Open-Meteo current-conditions and forecast provider (default source)
│   ├── MetNoService.ts             # Keyless Met.no (Locationforecast 2.0) current-conditions and forecast provider
│   ├── AccuWeatherService.ts       # AccuWeather provider: 30+ field extraction, location caching, verifyApiKey
│   ├── OpenMeteoMarineService.ts   # Keyless Open-Meteo Marine sea-state fetch (optional marineData layer)
│   ├── WarningsService.ts          # Region-aware getWarnings: NWS CAP (US waters) and Met.no MetAlerts (Norwegian waters)
│   ├── WeatherProviderAdapter.ts   # SK v2 Weather API provider: getForecasts(point/daily), getObservations, getWarnings
│   ├── SignalKService.ts           # Vessel navigation data retrieval
│   ├── cache/                      # CoalescingTtlCache, ForecastCache (on-demand v2 cache), cacheUtils
│   ├── http/                       # RetryingHttpClient (shared retry/backoff over fetchJson)
│   └── quota/                      # RollingRequestWindow (AccuWeather rolling 24h quota window)
├── providers/
│   ├── WeatherProvider.ts          # CurrentWeatherProvider / ForecastCapableProvider seams + supportsForecasts guard
│   ├── providerCatalog.ts          # PROVIDER_CATALOG: id → service construction (open-meteo, accuweather, met-no)
│   ├── createCurrentWeatherProvider.ts  # Constructs the single resolved provider from the catalog
│   ├── createWeatherProvider.ts    # Top-level selection: single source or a MergingWeatherProvider when weatherMode is merged
│   ├── MergingWeatherProvider.ts   # Blends all available providers; delegates forecasts/observations to a forecast child
│   ├── mergeWeatherData.ts         # Pure merge engine: FIELD_MERGE_KINDS policy, circular-mean wind, derived recompute
│   ├── open-meteo-severity.ts      # WMO weather code to severe-condition classification
│   ├── met-no-severity.ts          # Met.no symbol code to severe-condition classification
│   └── accuweather-severity.ts     # AccuWeather icon code to severe-condition classification
├── calculators/
│   ├── WindCalculator.ts           # Vector math for apparent wind; NWS wind chill and heat index (Beaufort lives in utils/conversions.ts)
│   └── deriveWeatherFields.ts      # deriveBaseWeatherFields: recompute derived fields from base values (shared by every provider mapper)
├── mappers/
│   ├── NMEA2000PathMapper.ts       # Weather data → Signal K delta messages
│   ├── OpenMeteoMapper.ts          # Open-Meteo current block → internal SI WeatherData
│   ├── OpenMeteoForecastMapper.ts  # Open-Meteo forecast/observation blocks → SK v2 WeatherData envelope
│   ├── MetNoMapper.ts              # Met.no Locationforecast current block → internal SI WeatherData
│   ├── MetNoForecastMapper.ts      # Met.no timeseries → SK v2 observations, hourly forecasts, daily forecasts
│   ├── AccuWeatherMapper.ts        # AccuWeather current block → internal SI WeatherData
│   ├── MarinePathMapper.ts         # MarineData → environment.water.* / environment.current deltas plus meta
│   ├── OpenMeteoMarineMapper.ts    # Open-Meteo Marine current block → internal MarineData
│   ├── WarningsMapper.ts           # NWS CAP and Met.no MetAlerts → SK v2 WeatherWarning shape
│   ├── WeatherProviderMapper.ts    # AccuWeather forecast and current responses → SK v2 WeatherData envelope
│   ├── skV2Envelope.ts             # Shared SK v2 outside, wind, and sun block builders (buildSunBlock)
│   └── mapperUtils.ts              # requireNumber: tagged number coercion shared across provider mappers
├── notifications/
│   └── WeatherNotifier.ts      # Transition state machine: WeatherData → notifications.environment.* deltas
├── configpanel/                # React 19 federated config panel, TypeScript (bundled by webpack to public/)
│   ├── index.tsx               # Module Federation entry
│   ├── PluginConfigurationPanel.tsx  # Composition root: theme injection, section state, save orchestration (source section lives in WeatherSourceSection)
│   ├── sourceState.ts          # deriveSourceState: pure form → source/cadence view-state record (merged, key, Open-Meteo, quota, summary)
│   ├── styles.ts               # --svws-* design tokens: scale + LIGHT/DARK/NIGHT palettes, THEME_STYLE
│   ├── api-base.ts             # API_BASE plus panel-shared helpers (toErrorText, clampNumber, fetchJson)
│   ├── components/             # Section, NumberInput, StatusDashboard, ApiKeyField, CheckboxRow, NotificationToggles, WeatherSourceSection, MergeProviderList, FooterBar, ThemeToggle
│   └── hooks/                  # useStatus (visibility-gated polling), usePanelConfig (form state, dirty tracking, save flow)
├── utils/
│   ├── validation.ts           # Config validation, NMEA2000 range sanitization, `assertValidCoordinates`
│   ├── conversions.ts          # Unit conversions (temp, pressure, wind, Beaufort scale), `asTimestamp`, `asOptionalNumber`, `normalizeIsoTimestamp`, `toCoordKey`
│   ├── http.ts                 # Shared fetch helpers: `fetchJson`, `readBoundedJson`, `normalizeBaseUrl`, `DEFAULT_REQUEST_TIMEOUT_MS`
│   └── skDelta.ts              # Shared SK delta primitives: pv / me / buildValuesDelta / buildMetaDelta
├── constants/
│   ├── index.ts                # PGN numbers, Signal K paths, notification paths + thresholds, validation limits, ERROR_CODES, PLUGIN.CONTACT_USER_AGENT, TEST_KEY_LOCATION
│   └── notifications-shared.ts # Single source for runtime, schema, and panel: NOTIFICATION_LABELS, DEFAULT_NOTIFICATIONS, CONFIG_DEFAULTS, WEATHER_PROVIDER_IDS, WEATHER_MODE_IDS, resolveWeatherProvider, API_KEY_MIN_LENGTH, QUOTA_WARN_RATIO, PLUGIN_NAME, validateKeyLength
└── types/
    ├── index.ts                # Re-exports plus type guards, NotificationsConfig, NotificationValue, PanelStatusResponse
    ├── config.ts               # PluginConfiguration, WeatherProviderId, WeatherMode
    ├── weather.ts              # WeatherData, MarineData (internal SI types)
    ├── navigation.ts           # Vessel navigation types and guards
    ├── plugin.ts               # Logger and plugin-surface types
    ├── open-meteo-api.ts       # Open-Meteo response types
    ├── met-no-api.ts           # Met.no Locationforecast and MetAlerts response types
    └── accuweather-api.ts      # AccuWeather response types
```

### Data Flow
```
Open-Meteo / Met.no / AccuWeather API → CurrentWeatherProvider → WeatherService
                                          (or MergingWeatherProvider)    ↓
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
- **Provider wind is ground-referenced** (both Open-Meteo and AccuWeather report a regional ground wind), so the plugin emits `speedOverGround` only. It does NOT emit `speedTrue` (which is water-referenced and would clobber a real anemometer feed on a moving vessel). Wind direction is true-north per the WMO surface-wind convention; the rationale is pinned in `AccuWeatherService.transformWeatherData`.
- **Per-provider `$source`**: the active provider's source ref is set on every weather delta. Each provider declares its own `sourceRef` (`open-meteo` by default, `met-no` for Met.no, `accuweather` for AccuWeather, and `vws-merged` for the `MergingWeatherProvider`), and marine deltas carry their own `open-meteo-marine`, so users can configure source priorities to prefer real onboard sensors and a provider swap does not change paths.
- **Meta delta**: `NMEA2000PathMapper.buildMetaDelta()` returns a one-shot meta delta describing units/labels/descriptions for every `environment.weather.*` measurement path AND every `notifications.environment.*` path. `index.ts` ships it exactly once per start() cycle, after the first values delta (admin-UI rendering workaround, not a spec ordering requirement), via `app.handleMessage(..., SKVersion.v1)`. The meta-emitted flag resets in `cleanup()` so a restart re-attaches the meta block.
- **`displayUnits` meta hints**: the Signal K unit-preferences system categorizes a path purely by its SI base unit when the path is not in the server's `default-categories.json` (which only covers canonical spec paths). Every `environment.weather.*` path is non-canonical, so a path declaring `units: 'm'` gets bucketed with distances (rendered in miles/feet) and one declaring `units: 'K'` is treated as an absolute temperature (the K-to-C/F offset applied). Two paths carry a quantity whose base unit lies about its kind: `precipitationLastHour` is a depth (would show as miles) and `temperatureDeparture24h` is a delta (would show as an absolute Fahrenheit temperature). Both pin a `displayUnits` block in their `NON_CANONICAL_META` entry (`precipitationLastHour` -> custom `mm` conversion; `temperatureDeparture24h` -> `base` identity) so the data browser renders them correctly. The emitted value and `units` are unchanged; `displayUnits` is a render hint only. Do NOT emit a precipitation rate in `m/s`: AccuWeather provides no instantaneous rate, and `m/s` collides with the speed category.
- **Status banner**: `WeatherService.formatStatusBanner()` returns the live `Running, last update Nm ago (N updates, K API requests)` string used by `setPluginStatus` (or `Running, awaiting first update` before the first fetch). The `K API requests` suffix is appended only when `AccuWeatherService.getRequestCount()` is non-zero. When `dailyApiQuota > 0` the suffix gains a `, K/Q today` segment showing the rolling 24h count; at 90% the prefix flips to `Running [quota 90% used]`, and at 100% the plugin trips `setPluginError` via `WeatherService.isQuotaExhausted()` and skips fetches until usage drops. Format and counters live together on `WeatherService`; `index.ts` just routes the call. The banner is re-pushed on every successful `emitWeatherTick` so the age and counters stay current (and the start-time `awaiting first update` string flips as soon as the first fetch lands).
- **Daily API quota**: `dailyApiQuota` config option (default 50, range 0 to 1000; 0 disables). `AccuWeatherService` tracks usage via a rolling 24h window backed by 24 fixed hourly buckets that rotate on read/write (O(1) memory regardless of uptime). Accessor: `getRequestCountLast24h()`.
- **PGNs** (when paired with `signalk-nmea2000-emitter-cannon`): 130311/130314 (pressure), 130312/130316 (temperatures via fixed enum slots: temperature, dewPoint, apparentWindChill, theoreticalWindChill, heatIndex), 130313 (relativeHumidity), 130306 (wind: `speedOverGround`, `directionTrue`). The plugin's synthetic apparent wind (`environment.weather.windSpeedApparent` / `windAngleApparent`) is producer-namespaced; it bridges to PGN 130306 only through the cannon's opt-in `WIND_WEATHER_APPARENT` conversion, which is off by default so it cannot compete with a real masthead anemometer. Gust (`environment.weather.speedGust`) does not bridge: the cannon ships no conversion for it. Instance numbers and bus priority are assigned by the companion plugin, not embedded in the deltas this plugin produces.
- **Notifications** (opt-in, off by default): `notifications.environment.*` per SK 1.8.2 notifications.html. Distinct paths per band (`wind.gale|storm|hurricane`, `visibility.low|veryLow`, `heat.caution|high|extreme`, `cold.caution|extreme`, `weather.severe`) so consumers caching by path+id see independent transitions. Value shape `{ state, method, message, timestamp }`, `state: 'normal'` on exit. The notifier is a transition emitter (Map of last-seen states): unchanged snapshots produce zero output, with one deliberate exception. The first `evaluate()` after construction or `reset()` emits every enabled band's current state, including leading `normal`s, so a hazard notification latched by a previous plugin instance clears after a config-change restart instead of staying stuck at warn/alarm/emergency. Once primed, leading `normal`s are suppressed exactly as before. Bridging to N2K Alert PGN 126983 / 126985 requires the separate `signalk-to-nmea2000` plugin: this plugin emits SK-native deltas only. Config branch: `notifications: { enabled, wind, visibility, heat, cold, weather }`.
- **Weather API provider**: `index.ts` registers a Signal K v2 Weather API provider via `app.registerWeatherProvider(...)` in `startServices` whenever the active provider is forecast-capable (`supportsForecasts`), and unregisters via `app.weatherApi.unRegister(PLUGIN.NAME)` in the `stop` closure. Every current provider (Open-Meteo, Met.no, and AccuWeather) implements `ForecastCapableProvider`, so a default keyless install advertises the v2 API; in merged mode the `MergingWeatherProvider` delegates the v2 surface to its designated forecast-capable child. `WeatherProviderAdapter` (`src/services/WeatherProviderAdapter.ts`) is a thin shim over the active provider: `getForecasts('point')` calls `provider.getHourlyForecast`, `getForecasts('daily')` calls `provider.getDailyForecast`, and `getObservations` calls `provider.getObservation`, each returning the SI `WeatherData` envelope built by the provider's own forecast mapper (`OpenMeteoForecastMapper`, `MetNoForecastMapper`, or `WeatherProviderMapper` for AccuWeather, whose `mapCurrentToObservation` adds the pressure and pressure tendency the forecasts lack). The adapter honors the caller-supplied position, not the vessel position. `getWarnings` is served by the keyless, region-aware `WarningsService` (`src/services/WarningsService.ts`): NWS CAP active alerts for US waters and Met.no MetAlerts for Norwegian waters (each with an identifying User-Agent, best-effort so an outage or uncovered point returns an empty list), an empty list elsewhere, mapped to the `WeatherWarning` shape by `mapNwsAlertsToWarnings` / `mapMetAlertsToWarnings` in `src/mappers/WarningsMapper.ts`. Warnings ride the v2 provider, so they are exposed for any forecast-capable source. AccuWeather forecast and observation fetches share the one `AccuWeatherService` instance, its location-key cache, and its rolling-24h quota window via an on-demand `ForecastCache` (`FORECAST_CACHE` TTLs: 30 min hourly, 3 h daily, 10 min observations) plus stale-on-quota-exhaustion so a polling consumer cannot exhaust the key; Met.no reuses a short-lived document memo and Open-Meteo is keyless and uncapped. Registering the provider is what makes the server advertise `weather` in `/signalk/v2/features`, which is the flag dashboards like signalk-binnacle gate their weather UI on.
- **Notification message enrichment**: each band's `message` packs adjacent context the operator can act on without subscribing to extra paths. Wind: `"Gale-force wind: Bf9 from SW, 19 m/s, gusts 27 m/s, 998 hPa"`. Visibility: `"Reduced visibility: 0.8 km, ceiling 90 m, rain 2.5 mm/h"` (ceiling and precip rate appended when finite). Heat: `"High heat stress: HSI 3, WBGT 32 C, RH 78%, RealFeel (shade) 35 C"`. Cold: `"Cold exposure caution: wind chill -2 C, air 1 C, wind 12 m/s"`. Severe: `"Thunderstorms: Severe thunderstorms approaching, 998 hPa"`. Every message is capped at `MAX_MESSAGE_LENGTH = 80` chars (with `…` truncation) so it renders cleanly on the marine displays most likely to bridge through `signalk-to-nmea2000` (NMEA 2000 Alert PGN Text fields render 64..128 chars across the Garmin/Raymarine/B&G/Furuno fleet; 80 is a safe common denominator). Helpers `formatWindSuffix` / `formatVisibilitySuffix` / `formatHeatSuffix` / `formatColdSuffix` / `formatSevereSuffix` live alongside the `WeatherNotifier` class in `src/notifications/WeatherNotifier.ts` so the format and the band evaluators stay together.
- **Banner dedupe**: every `setPluginStatus` / `setPluginError` call in `index.ts` routes through `setBanner()` which dedupes consecutive identical `(kind, message)` pairs. A flapping API or steady-state quota pause therefore lands one banner write per unique message, not one per 5-second emission tick. `WeatherService.updateWeatherData` also pushes the live banner directly on the first successful update so the "awaiting first update" string flips the moment data lands.
- **Shared SK delta primitives**: `src/utils/skDelta.ts` exports `pv` (PathValue builder), `me` (Meta builder), `buildValuesDelta(values, timestamp, sourceRef)`, `buildMetaDelta(meta, sourceRef)`, the `SELF_CONTEXT` branded-cast constant, and the `toSourceRef` brand helper. Both delta builders REQUIRE an explicit `sourceRef` (there is deliberately no default ref), so a caller that forgets one fails to compile instead of silently mis-stamping a provider. Mapper, notifier, and plugin entry all build deltas through this module instead of hand-rolling the envelope.
- **Federated React config panel** (since v1.5.0; loads cleanly since v1.5.1 fixed the ESM federation library type; TypeScript since v1.8.0): `src/configpanel/PluginConfigurationPanel.tsx` is the composition root, with `components/`, `hooks/`, `styles.ts` (design tokens), and `api-base.ts` (panel-shared helpers), all bundled by `webpack.config.cjs` (must be `.cjs` because our `package.json` is `"type": "module"`) into `public/` via `ModuleFederationPlugin`. babel transpiles (`@babel/preset-typescript` + `@babel/preset-react`); types are checked separately by `tsconfig.panel.json` via `npm run type-check:panel` (chained into `type-check`). The root `tsconfig.json` excludes `src/configpanel` so the runtime declaration build never compiles the panel. React 19 is declared `singleton` so the panel shares the host admin UI's React. The `signalk-plugin-configurator` keyword in `package.json` triggers the SK admin UI to load the panel in place of the auto-generated rjsf form; the JSON `schema()` is kept as a fallback for older admin UIs (an ESM federation container loads only on admin UI 2.27.0+, so older hosts fall back to the rjsf form).
- **Panel theming and accessibility** (since v1.8.0, aligned with the signalk-nmea2000-emitter-cannon panel): `styles.ts` defines a `--svws-*` CSS custom-property contract with scale tokens plus LIGHT, DARK, and NIGHT (night-red helm) palettes, each with a `color-scheme` declaration and documented WCAG AA contrast ratios on the muted and faint text tones. The host admin UI theme is matched via `[data-bs-theme="dark"] .svws-panel`; an explicit user pick (ThemeToggle: Auto/Light/Dark/Night) pins a `data-svws-theme` attribute persisted to localStorage key `svws-theme`. A hex literal in a component (rather than `styles.ts`) is a defect. Marine sizing: 22px checkboxes, 36px minimum button height. The panel tracks dirty state (sticky FooterBar with Save and Discard, `beforeunload` guard), confirms the post-save restart via status polling before claiming success, and renders the stat dashboard even when stopped.
- **ESM federation gotcha (load-bearing)**: because `package.json` has `"type": "module"`, `signalk-server` injects the panel script as `<script type="module">` (see `signalk-server/src/serverroutes.ts` ~line 265), and the admin UI loader expects ESM `.get` / `.init` exports on the resolved module. The webpack config therefore MUST use `experiments.outputModule: true`, `output.module: true`, `output.chunkFormat: 'module'`, and `library: { type: 'module' }`. A `library: { type: 'var' }` bundle would assign to `window.<safeName>` via a classic script and export nothing via ESM, so the admin UI's `await import()` resolves to an empty module and logs `Could not load module signalk-virtual-weather-sensors` with no other diagnostic. v1.5.0 shipped with this bug; v1.5.1 fixes it. Panel chunks are emitted as `.mjs`.
- **JSX-runtime gotcha (load-bearing, same class as the ESM one)**: the `@babel/preset-react` config in `webpack.config.cjs` MUST pin `{ runtime: 'automatic', development: false }`. With `development` unpinned, Babel 8 defaults the panel to the DEV JSX runtime (`jsxDEV` from `react/jsx-dev-runtime`) whenever `NODE_ENV` is unset at build time, even though `mode: 'production'` is set (webpack's mode does not set Babel's build-time env). The federated React singleton from the host only exposes the production runtime, so a dev-runtime panel fails at load with `(0, S.jsxDEV) is not a function` and the admin UI shows "Plugin Configuration Unavailable". The trap: a `npm run build` SUCCEEDS with the dev runtime (it is a valid bundle), so a green build does NOT catch this. After any Babel or React major bump, grep the built `public/*.mjs` for `jsxDEV` (must be absent) and `jsx-runtime` (must be present). Babel 8 also removed the `isTSX` and `allExtensions` preset-typescript options (extension-based `.tsx` detection replaces them).
- **Shared cross-boundary constants**: `src/constants/notifications-shared.ts` is the single source of truth consumed by the TS runtime, the rjsf schema in `src/plugin/schema.ts`, and the federated panel: `NOTIFICATION_LABELS` (5 sub-toggle strings), `NOTIFICATION_MASTER_LABEL`, `NOTIFICATION_BAND_KEYS`, `DEFAULT_NOTIFICATIONS`, `CONFIG_DEFAULTS`, the provider and mode registries (`WEATHER_PROVIDER_IDS`, `WEATHER_PROVIDER_LABELS`, `DEFAULT_WEATHER_PROVIDER`, `resolveWeatherProvider`, `providerRequiresApiKey`, `WEATHER_MODE_IDS`, `WEATHER_MODE_LABELS`, `DEFAULT_WEATHER_MODE`, `resolveWeatherMode`, `DEFAULT_MERGE_PROVIDERS`, `resolveMergeProviders`), `API_KEY_MIN_LENGTH`, `QUOTA_WARN_RATIO`, `PLUGIN_NAME` / `PLUGIN_DISPLAY_NAME`, and `validateKeyLength()`. Existing imports use the `.js` specifier (NodeNext style); webpack resolves them to the `.ts` source via `extensionAlias`. Labels, defaults, bounds, the quota ratio, and the provider and mode lists can no longer drift between the panel, the schema, and the runtime. (Until v1.8.0 this was a plain-JS module with a hand-synced `.d.ts` shim; both collapsed into the single `.ts` file.)
- **Panel-supporting REST endpoints**: `Plugin.registerWithRouter` mounts `GET /api/status` (live banner + 24h API count + minutes since last fetch + active-notification count + `weatherProviderRegistered` flag, typed as `PanelStatusResponse` in `src/types/index.ts`; the panel renders the flag as a "Weather API" On/Off stat card) and `POST /api/test-key` (probes a candidate AccuWeather key with one `AccuWeatherService.verifyApiKey()` call, single AccuWeather API call per test). Both endpoints are read-only or non-mutating; neither persists a key. The panel polls `/api/status` every 10 s. `TEST_KEY_LOCATION` (Greenwich Observatory coords, arbitrary fixed point) lives in `src/constants/index.ts`.

## Technology Stack

- TypeScript 6.0+ (strict mode, ES2023 target)
- Node.js 20.18+ (ESM only)
- `@signalk/server-api` 2.24+ as a `peerDependency` (the Signal K server provides it at runtime; not bundled). Used for `Plugin`, `ServerAPI`, `Delta`, `PathValue`, `Meta`, `MetaValue`, `SourceRef`, and `SKVersion` types.
- esbuild 0.28+ for bundling (current bundle ~150 KB)
- Biome 2.4+ for linting/formatting (with `noFloatingPromises` / `noMisusedPromises` enabled)
- Vitest 4.1+ for testing (576 tests across 44 files; mutation testing via Stryker.js, opt-in via `npm run mutation-test`). `npm test` runs once (registry/CI safe); `npm run test:watch` is the interactive watcher.
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
