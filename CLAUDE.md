# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Signal K plugin that provides comprehensive weather data with NMEA2000-compatible environmental measurements. Outputs 30+ weather data points including temperatures, wind, atmospheric conditions, and marine safety indices.

**Multi-provider (since v1.9.0).** The plugin sources current conditions through a `CurrentWeatherProvider` seam (`src/providers/WeatherProvider.ts`), so the orchestration and the path mapper are provider-agnostic over the internal SI `WeatherData` type. Three providers implement it: keyless global **Open-Meteo** (`OpenMeteoService`, the default for new installs), keyless global **Met.no** (`MetNoService`, the Norwegian Meteorological Institute's Locationforecast 2.0), and **AccuWeather** (`AccuWeatherService`, optional, key-gated, kept for its exclusive fields). `resolveWeatherProvider` in `constants/notifications-shared.ts` picks the provider migration-safely: an explicit `weatherProvider` wins, otherwise an existing AccuWeather key keeps AccuWeather active and a fresh install defaults to Open-Meteo, so an upgrade never silently switches a working install or its `$source`. The construction half lives in `providerCatalog.ts` (`PROVIDER_CATALOG`, keyed by provider id); `createCurrentWeatherProvider` builds a single provider and `createWeatherProvider` wraps the selection in a `MergingWeatherProvider` when `weatherMode` is `merged`. In merged mode the providers to blend and their priority order come from the `mergeProviders` config list (first = primary), resolved migration-safely by `resolveMergeProviders` in `constants/notifications-shared.ts` (an absent or empty list falls back to `[primary, ...rest in catalog order]`, so a merged config written before the field existed resolves to the old behavior); `createWeatherProvider` filters that order to the actually available providers and degrades to a single provider when only one survives. `index.ts` injects the result into `WeatherService` and `NMEA2000PathMapper`. The active provider's `sourceRef` is threaded through `skDelta` so Open-Meteo deltas carry `$source: 'open-meteo'`, Met.no carries `met-no`, AccuWeather keeps `accuweather`, and merged mode carries `vws-merged`. AccuWeather retired its permanent free tier (now a 14-day trial, then paid), which is why keyless defaults exist. The v2 Weather API forecast provider is advertised for any forecast-capable provider: Open-Meteo, Met.no, and AccuWeather all support forecasts, so a default keyless install advertises it, and merged mode advertises it through its designated forecast child. Open-Meteo and Met.no provide fewer fields than AccuWeather: no RealFeel, RealFeel shade, measured WBGT (estimated via the heat-stress estimator so the heat-stress band still works), pressure tendency, precipitation type, ceiling, visibility obstruction, or 24h departure; severe-condition text comes from WMO weather codes (Open-Meteo) or Met.no symbol codes. Met.no additionally supplies no visibility and no past-hour precipitation: Locationforecast 2.0 is a pure forecast product whose `next_1_hours` block covers the hour AFTER the entry time, so `precipitationLastHour` is deliberately left unset there rather than publishing a forecast on a path whose meta promises an observation. A separate forward-looking precipitation leaf is deferred work. The provider-specific condition-to-severity maps live in `src/providers/accuweather-severity.ts`, `src/providers/open-meteo-severity.ts`, and `src/providers/met-no-severity.ts`, and the notifier consumes the provider-agnostic `WeatherData.severeCondition` they produce.

**Merge mode.** Setting `weatherMode = 'merged'` in config builds a `MergingWeatherProvider` (`src/providers/MergingWeatherProvider.ts`) that wraps the atmospheric providers the operator chose in the `mergeProviders` pick-and-order list (first = primary), in that priority order, and blends their current-conditions results per the `FIELD_MERGE_KINDS` policy defined in `src/providers/mergeWeatherData.ts`. The panel's `MergeProviderList` edits that list (include checkboxes plus up/down reorder, AccuWeather key-gated, and the last included provider cannot be unchecked, so the panel cannot save an empty list); a list that resolves to a single available provider degrades to that single source with no synthesis. After blending the raw fields, heat index, absolute humidity, air density, and gust factor are recomputed from the merged base via `deriveBaseWeatherFields` so they stay internally consistent with the blended values. Every value a notification band READS is instead taken conservatively from the survivors: `beaufortScale` is the highest survivor's own force, `windChill` the lowest survivor's own value, and `heatStressIndex` the highest survivor's own index, alongside the existing `windGustSpeed` and `precipitationLastHour` maxima, `visibility` minimum, `severeCondition` highest severity, and falling-wins `pressureTendency`. Averaging a hazard driver can cancel a band that either provider alone would raise (18.0 m/s Bf8 blended with 15.0 m/s Bf7 yields 16.5 m/s and no gale warning), so a conservative category may sit beside a lower merged measurement; that is deliberate and is the same trade `windGustSpeed: hazard-max` beside `windSpeed: mean` already made. Forecasts and observations delegate to the highest-priority forecast-capable child; the marine layer and warnings run on their own independent paths and are never merged. Every merged delta carries `$source: 'vws-merged'`, which yields to a real onboard sensor under server source priorities exactly as the single-provider sources do. Two deliberate decisions are recorded here so a later reader does not "fix" them: (1) WBGT is NOT averaged but taken from the highest-priority provider that reports it (set AccuWeather as the primary to prefer its measured globe temperature; a `measured` flag for true prefer-measured semantics is a deferred enhancement); (2) the merged v2 observation is served by the designated forecast child rather than blending pressure across all children, for coherence with that child's forecast series (multi-child pressure blending is a deferred enhancement). The three `apparent*` fields (apparent wind speed, angle, and wind chill) are excluded from the merge output and added downstream in `WeatherService` after vessel motion is folded in.

**Optional marine layer (since v1.9.0).** A `marineData` config toggle (off by default) enables a keyless Open-Meteo Marine fetch (`OpenMeteoMarineService`, host `marine-api.open-meteo.com`, or the configured `openMeteoBaseUrl` for self-hosted), independent of the atmospheric provider. `WeatherService` fetches it best-effort on the same cadence and position as the weather update (a marine failure only logs, never fails the weather update), exposing it via `getCurrentMarineData()`. `MarinePathMapper` emits sea surface temperature on the canonical `environment.water.temperature` leaf, surface current on the canonical `environment.current` OBJECT node (`{ drift, setTrue }`, not dotted leaves), and waves/swell on producer-namespaced `environment.water.waves.*` / `swell.*` leaves with meta. Marine deltas carry a distinct `$source: 'open-meteo-marine'` so the model sea temperature and current yield to a real sensor under source priorities. `index.ts` emits the marine delta on the keep-alive cadence past the same staleness gate as weather, restamped, with marine meta shipped once and skipped entirely for inland points (`isMarineDataEmpty`). Pure mapper `src/mappers/OpenMeteoMarineMapper.ts` converts the Open-Meteo Marine current block (directions degrees to radians, SST Celsius to Kelvin, current km/h to m/s) into `MarineData`.

## Commands

### Build
```bash
npm run build          # Full build: clean, types, runtime, panel, panel checks
npm run build:types    # TypeScript declarations only
npm run build:bundle   # esbuild bundle only
npm run build:panel    # Module Federation panel only
npm run dev            # Development with hot reload (tsx watch)
```

### Test
```bash
npm run test           # Run suite once (Vitest); registry/CI safe
npm run test:watch     # Watch mode (Vitest)
npm run test:run       # Run once (alias of test, used by `validate`)
npm run test:coverage  # Coverage report (80% thresholds)
npm run test:browser   # Built-remote Chromium panel suite
npm run test:browser:cross # Built-remote cross-browser panel suite
npm run test:ui        # Interactive UI
```

### Lint and Format
```bash
npm run lint           # Code, Markdown, and spelling checks
npm run lint:fix       # Auto-fix issues
npm run format         # Format code
npm run type-check     # TypeScript verification
npm run verify         # Full non-browser verification
npm run verify:release # Full cross-browser release verification
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
│   ├── cache/                      # CoalescingTtlCache (TTL, single-flight, optional stale-while-revalidate), ForecastCache (on-demand v2 cache), cacheUtils
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
│   ├── PluginConfigurationPanel.tsx  # Shared-UI composition root, section state, and save orchestration
│   ├── sourceState.ts          # deriveSourceState: pure form → source/cadence view-state record (merged, key, Open-Meteo, quota, summary)
│   ├── api-base.ts             # API_BASE plus panel-shared fetch and error helpers
│   ├── components/             # Domain-specific fields, status, source, merge, and notification UI
│   └── hooks/                  # useStatus (visibility-gated polling), usePanelConfig (form state, dirty tracking, save flow)
├── utils/
│   ├── validation.ts           # Config validation, NMEA2000 range sanitization, `assertValidCoordinates`
│   ├── conversions.ts          # Unit conversions (temp, pressure, wind, Beaufort scale), `asTimestamp`, `asOptionalNumber`, `normalizeIsoTimestamp`, `toCoordKey`
│   ├── http.ts                 # Shared fetch helpers: `fetchJson`, `fetchJsonConditional`, `readBoundedJson`, `normalizeBaseUrl`, `setCoordParams`, `DEFAULT_REQUEST_TIMEOUT_MS`
│   └── skDelta.ts              # Shared SK delta primitives: pv / me / buildValuesDelta / buildMetaDelta
├── constants/
│   ├── index.ts                # PGN numbers, Signal K paths, notification paths + thresholds, validation limits, external-text length caps (ACCUWEATHER, WARNINGS), COORD_CACHE_CELL_DECIMALS, ERROR_CODES, PLUGIN.CONTACT_USER_AGENT, TEST_KEY_LOCATION
│   └── notifications-shared.ts # Single source for runtime, schema, and panel: NOTIFICATION_LABELS, DEFAULT_NOTIFICATIONS, CONFIG_DEFAULTS, WEATHER_PROVIDER_IDS, WEATHER_MODE_IDS, resolveWeatherProvider, API_KEY_MIN_LENGTH, QUOTA_WARN_RATIO, PLUGIN_NAME, validateApiKeyCandidate
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
- **Status banner**: `WeatherService.formatStatusBanner()` returns the live `Running, last update Nm ago (N updates, K API requests)` string used by `setPluginStatus` (or `Running, awaiting first update` before the first fetch). The `K API requests` suffix is appended only when the active provider's `getRequestCount()` is non-zero (provider-agnostic; the merging provider sums its children). When `dailyApiQuota > 0` the suffix gains a `, K/Q today` segment showing the rolling 24h count; from 90% the prefix flips to `Running [quota N% used]` carrying the real percentage, and in merged mode the counters also name any child paused at its own quota, and at 100% the plugin trips `setPluginError` via `WeatherService.isQuotaExhausted()` and skips fetches until usage drops. Format and counters live together on `WeatherService`; `index.ts` just routes the call. `getTickBanner()` owns the precedence, most specific cause first: a rejected API key, the quota pause, `Waiting for GPS position`, stale data, the latched message from the last failed fetch, then the live status line. Every failure state is an `error` kind, which is also what `/api/status` reads to clear its `running` flag, so the panel and the admin banner cannot report different health. Both the missing-position state and the last fetch error are LATCHED on `WeatherService`, because the server routes `setPluginStatus` and `setPluginError` through one record that the last write wins: a one-shot error banner was overwritten by the next tick's status line within `emissionInterval` seconds. The banner is pushed on every `emitWeatherTick`, before the no-data short-circuit, so the age and counters stay current and a plugin that has never fetched still reports why.
- **Daily API quota**: `dailyApiQuota` config option (default 50, range 0 to 1000; 0 disables). `AccuWeatherService` tracks usage in an exact rolling 24h timestamp window persisted in the plugin data directory. Accessor: `getRequestCountLast24h()`. Cost arithmetic: each fetch spends one current-conditions call, plus one Locations call per day at a fixed position or per new 1 km cell underway; the fetch timer's jitter only lengthens the interval (0 to 10 percent), so the default 30-minute cadence costs at most 48 plus 1 per day stationary and up to 96 underway. AccuWeather requests authenticate with an `Authorization: Bearer` header set on the `RetryingHttpClient`, never an `apikey` query parameter, so the key never appears in a URL or a log line.
- **PGNs** (when paired with `signalk-nmea2000-emitter-cannon`): 130311/130314 (pressure), 130312/130316 (temperatures via fixed enum slots: temperature, dewPoint, apparentWindChill, theoreticalWindChill, heatIndex), 130313 (relativeHumidity), 130306 (wind: `speedOverGround`, `directionTrue`). The plugin's synthetic apparent wind (`environment.weather.windSpeedApparent` / `windAngleApparent`) is producer-namespaced; it bridges to PGN 130306 only through the cannon's opt-in `WIND_WEATHER_APPARENT` conversion, which is off by default so it cannot compete with a real masthead anemometer. Gust (`environment.weather.speedGust`) does not bridge: the cannon ships no conversion for it. Instance numbers and bus priority are assigned by the companion plugin, not embedded in the deltas this plugin produces.
- **Notifications** (opt-in, off by default): `notifications.environment.*` per SK 1.8.2 notifications.html. Distinct paths per band (`wind.gale|storm|hurricane`, `visibility.low|veryLow`, `heat.caution|high|extreme`, `cold.caution|extreme`, `weather.severe`) so consumers caching by path+id see independent transitions. Value shape `{ state, method, message, timestamp }`, `state: 'normal'` on exit. The notifier is a transition emitter (Map of last-PUBLISHED states): unchanged snapshots produce zero output, with one deliberate exception. `evaluate()` returns `{ transitions, commit }`: the states it would publish stay pending, and the caller calls that evaluation's own `commit` only after the delta reaches `app.handleMessage`, so anything that throws in between cannot latch a band that never emitted (the next evaluation would otherwise see `prior === desired` and never re-emit the entry edge). The recorder is reachable only through the evaluation that produced it and only while that evaluation is still outstanding, so a later evaluation cannot be recorded by an earlier caller and a second call is a no-op. `clearAll()` returns the same pair. While data is stale, emission stops but an active band is never cleared; `markStale()` re-emits each active band once with `(data N min old)` appended to its message so a consumer subscribed to `notifications.environment.*` carries the same caveat the admin banner does. The first `evaluate()` after construction or `reset()` emits every enabled band's current state, including leading `normal`s, so a hazard notification latched by a previous plugin instance clears after a config-change restart instead of staying stuck at warn/alarm/emergency. Once primed, leading `normal`s are suppressed exactly as before. Bridging to N2K Alert PGN 126983 / 126985 requires the separate `signalk-to-nmea2000` plugin: this plugin emits SK-native deltas only. Config branch: `notifications: { enabled, wind, visibility, heat, cold, weather }`.
- **Weather API provider**: `index.ts` registers a Signal K v2 Weather API provider via `app.registerWeatherProvider(...)` in `startServices` whenever the active provider is forecast-capable (`supportsForecasts`), and unregisters via `app.weatherApi.unRegister(PLUGIN.NAME)` in the `stop` closure. Every current provider (Open-Meteo, Met.no, and AccuWeather) implements `ForecastCapableProvider`, so a default keyless install advertises the v2 API; in merged mode the `MergingWeatherProvider` delegates the v2 surface to its designated forecast-capable child. `WeatherProviderAdapter` (`src/services/WeatherProviderAdapter.ts`) is a thin shim over the active provider: `getForecasts('point')` calls `provider.getHourlyForecast`, `getForecasts('daily')` calls `provider.getDailyForecast`, and `getObservations` calls `provider.getObservation`, each returning the SI `WeatherData` envelope built by the provider's own forecast mapper (`OpenMeteoForecastMapper`, `MetNoForecastMapper`, or `WeatherProviderMapper` for AccuWeather, whose `mapCurrentToObservation` adds the pressure and pressure tendency the forecasts lack). The adapter honors the caller-supplied position, not the vessel position. `getWarnings` is served by the keyless, region-aware `WarningsService` (`src/services/WarningsService.ts`): NWS CAP active alerts for US waters and Met.no MetAlerts for Norwegian waters (each with an identifying User-Agent; an outage or a response it cannot parse throws rather than returning an empty list, so the v2 caller sees the failure), and an empty list outside both regions (the server turns a provider throw into an HTTP 400, which would put every consumer outside the US and Norway into an error state for a documented limitation), mapped to the `WeatherWarning` shape by `mapNwsAlertsToWarnings` / `mapMetAlertsToWarnings` in `src/mappers/WarningsMapper.ts`. Warnings ride the v2 provider, so they are exposed for any forecast-capable source. AccuWeather forecast and observation fetches share the one `AccuWeatherService` instance, its location-key cache (keyed by a 0.01 degree cell, about 1 km, and held for 24 hours, so a stationary vessel spends one Locations call per day and a vessel underway one per new cell), and its rolling-24h quota window via an on-demand `ForecastCache` (`FORECAST_CACHE` TTLs: 30 min hourly, 3 h daily, 10 min observations) plus stale-on-quota-exhaustion so a polling consumer cannot exhaust the key; Met.no reuses a short-lived document memo held in the same `CoalescingTtlCache`, which retains an expired document past its TTL so the next fetch can revalidate against it with `If-Modified-Since` and keep the body on a 304; Open-Meteo is keyless and uncapped. Registering the provider is what makes the server advertise `weather` in `/signalk/v2/features`, which is the flag dashboards like signalk-binnacle gate their weather UI on.
- **Notification message enrichment**: each band's `message` packs adjacent context the operator can act on without subscribing to extra paths. Wind: `"Gale-force wind: Bf9 from SW, 19 m/s, gusts 27 m/s, 998 hPa"`. Visibility: `"Reduced visibility: 0.8 km, ceiling 90 m, rain 2.5 mm/h"` (ceiling and precip rate appended when finite; kilometers are rounded DOWN so the figure can never read above the threshold that fired the band). Heat: `"High heat stress: HSI 3, WBGT 32 C, RH 78%, RealFeel (shade) 35 C"`. Cold: `"Cold exposure caution: wind chill -2 C, air 1 C, wind 12 m/s"`. Severe: `"Thunderstorms: Severe thunderstorms approaching, 998 hPa"`. Every message is capped at `MAX_MESSAGE_LENGTH = 80` chars (with `…` truncation) so it renders cleanly on the marine displays most likely to bridge through `signalk-to-nmea2000` (NMEA 2000 Alert PGN Text fields render 64..128 chars across the Garmin/Raymarine/B&G/Furuno fleet; 80 is a safe common denominator). Helpers `formatWindSuffix` / `formatVisibilitySuffix` / `formatHeatSuffix` / `formatColdSuffix` / `formatSevereSuffix` live alongside the `WeatherNotifier` class in `src/notifications/WeatherNotifier.ts` so the format and the band evaluators stay together.
- **Banner dedupe**: every `setPluginStatus` / `setPluginError` call in `index.ts` routes through `setBanner()` which dedupes consecutive identical `(kind, message)` pairs. A flapping API or steady-state quota pause therefore lands one banner write per unique message, not one per 5-second emission tick. `WeatherService.updateWeatherData` also pushes the live banner directly on the first successful update so the "awaiting first update" string flips the moment data lands.
- **Shared SK delta primitives**: `src/utils/skDelta.ts` exports `pv` (PathValue builder), `me` (Meta builder), `buildValuesDelta(values, timestamp, sourceRef)`, `buildMetaDelta(meta, sourceRef)`, the `SELF_CONTEXT` branded-cast constant, and the `toSourceRef` brand helper. Both delta builders REQUIRE an explicit `sourceRef` (there is deliberately no default ref), so a caller that forgets one fails to compile instead of silently mis-stamping a provider. Mapper, notifier, and plugin entry all build deltas through this module instead of hand-rolling the envelope.
- **Federated React config panel**: `src/configpanel/PluginConfigurationPanel.tsx` is the composition root, with domain-specific components and hooks under `src/configpanel/`. `signalk-nearlcrews-ui` 0.11.1 provides the panel shell (`PanelShell`: browser preflight, theme toggle, and `PanelErrorBoundary`), theme persistence, layouts, fields, `NumberField`, feedback, metrics, `Section`, collapsible sections, `RelativeAge`, `LiveRegion`, `VisuallyHidden`, `Text`, and the `SaveActionBar` paired with `useUnsavedChangesGuard`. The panel never re-implements a primitive the library ships. Project CSS stays in focused CSS modules (the glyph tile and the merge-row layout) and consumes public `--snui-*` tokens. The composition root carries no stylesheet at all: `PanelShell` holds the theme selector at the trailing edge itself, in both the `between` and `end` placements, so the panel's own rule for that placement is gone. webpack bundles the shared UI library but consumes React and React DOM from the host through the `shared` map exported by `signalk-nearlcrews-ui/federation`: non-strict singletons with `requiredVersion: '^19.2.0'` and `import: false`, deliberately WITHOUT `strictVersion` (load-bearing): the Signal K Admin registers its React share below the version it actually ships (2.24.0 registers 19.0.0 while bundling 19.2.4), so a strict check rejects a fully compatible host and, with `import: false`, the panel never mounts; the mismatch must warn and continue. The exposed panel stays in one async chunk to avoid duplicate compression overhead. `npm run check:panel` runs `scripts/check-panel-bundle.mjs` (the ESM container export, CSS identifiers, tokens, and the container name surviving webpack, and only the production JSX runtime from React) and then the library's `snui-check-consumer` bin (exact pin equal to the installed release, the `data-snui-version` stamp, no bundled React runtime, the remote and the webpack config consuming exactly the published share map, which also rejects a reintroduced `strictVersion`, and the gzip baseline in `scripts/panel-size-baseline.json`). The JSON `schema()` remains the fallback for older admin UIs.
- **Save bar and focus contract**: `SaveActionBar` owns the Save and Discard rules. Save is enabled for edits or for a plugin the host has never configured and blocked while `invalidMessage` names an invalid cadence draft (an invalid draft never commits, so it never dirties the form on its own); the message names the section so the operator can find the field, because the bar disables Save rather than jumping to it. Submit-time blockers (the API key and the Open-Meteo base URL) keep Save enabled: `doSave` returns a `SaveBlocker` key and the composition root opens the Weather source section and focuses the field through a ref (`inputRef` on `ApiKeyField`, `ref` on the base URL `TextInput`). The panel sets no hard-coded control ids; the shared fields generate them and the browser suite locates controls by role and name. `usePanelConfig` exposes `saveRequestedAt` (set when the host accepted a request, cleared by the next edit) and `action.requested`: a post-request status outcome feeds the bar's `savedMessage` in the library's info tone, while a request the host refused renders a danger `Banner` beside the bar, because the bar has no failure slot and the form is still dirty. The bar's `saving` label reads "Save requested. Checking the current plugin status..." because the host callback is fire-and-forget and the busy state covers the status poll, not a write the panel can observe.
- **Panel compatibility and accessibility**: the shared UI library requires native CSS `@scope`. `PanelShell` runs the `supportsNativeCssScope` preflight and renders the compatibility notice on unsupported browsers. Supported floors are Chromium and Edge 118, Firefox 146, and Safari 17.4. The retired `svws-theme` preference is ignored, not migrated: a panel with only that key present starts at Auto and leaves it untouched. A locked merge row (the last included provider, or an excluded provider that needs a key) takes the library's `ariaDisabled` rather than native `disabled`, so the box the operator is standing on stays focusable and in the tab order instead of being blurred onto the document body; the lock reason rides its description. Built-remote Playwright coverage checks Axe, 320-pixel layouts, a narrow panel inside a wide host, every theme choice including System, number validation, save behavior, focus-preserving merge reordering and group changes, the merge-order and API-key announcers existing before their first message, and the CC BY 4.0 attributions Open-Meteo and Met.no each owe while selected (Open-Meteo's rides its base-URL field description, Met.no's stands alone, so nothing else fails if it stops rendering). Hit targets get their own sweep on every browser project: each control is scrolled to the middle of the viewport first, then measured against the floor the pointer implies (40 with a fine pointer, 44 under `any-pointer: coarse`) and required to be the topmost element at its own centre. Both halves matter. Size alone passes a control that something covers, and measuring without scrolling first falsely blames the docked action bar for overlapping a control the user would have scrolled to anyway. A label counts toward its control's target, which is why a 20-pixel checkbox inside a full-width label passes. Links inside a sentence are out of scope, since their height follows the surrounding line. The merge list's single-glyph reorder buttons are `iconOnly` compact buttons and draw that floor from the shared library, so the panel carries no local size override for them. The stale-poll marker in `StatusDashboard` is deliberately NOT a live region: it wraps a `RelativeAge` that ticks every ten seconds, so announcing it would repeat for as long as the poll stayed down, and a region first mounted with its text already present is not reliably observed. An always-mounted `LiveRegion` beside it carries the one-time transition message instead.
- **ESM federation gotcha (load-bearing)**: because `package.json` has `"type": "module"`, `signalk-server` injects the panel script as `<script type="module">` (see `signalk-server/src/serverroutes.ts` ~line 265), and the admin UI loader expects ESM `.get` / `.init` exports on the resolved module. The webpack config therefore MUST use `experiments.outputModule: true`, `output.module: true`, `output.chunkFormat: 'module'`, and `library: { type: 'module' }`. A `library: { type: 'var' }` bundle would assign to `window.<safeName>` via a classic script and export nothing via ESM, so the admin UI's `await import()` resolves to an empty module and logs `Could not load module signalk-virtual-weather-sensors` with no other diagnostic. v1.5.0 shipped with this bug; v1.5.1 fixes it. Panel chunks are emitted as `.mjs`.
- **JSX-runtime gotcha (load-bearing, same class as the ESM one)**: the
  `esbuild-loader` config in `webpack.config.cjs` MUST retain
  `jsx: 'automatic'`. The federated React singleton from the host supplies the
  production `react/jsx-runtime`; a panel compiled against the development
  `jsxDEV` runtime fails to load. `npm run check:panel` verifies that built
  chunks omit `jsxDEV` and retain the production runtime contract.
- **Retained-section gotcha (load-bearing)**: every `CollapsibleSection` in the
  panel uses `mountStrategy="retain"`, which wraps its children in React's
  `Activity`. Collapsing a section sets `mode="hidden"`, which runs every
  effect cleanup in that subtree and re-runs the effects on reopen, while
  component state survives untouched. A field must therefore never treat an
  effect as "runs once on mount": the library's `NumberField` keeps its draft
  beside the value it was typed against and reports validity on transitions
  only, so a collapse and reopen keeps an invalid cadence draft and its error,
  and `ApiKeyField` clears its test result in the cleanup alongside the abort.
  Two consequences fall on the panel. `NumberField` never reports from an
  unmount, so the composition root releases the quota field's validity entry
  itself when AccuWeather leaves the selection, and a field inside a collapsed
  section reports only once the section is open again, so Discard clears the
  invalid set directly as well as bumping the `resetKey`. Before this was
  understood, collapsing a section silently discarded an invalid cadence draft
  and left the API-key Test button stuck loading forever. Both behaviors are
  pinned by browser tests that collapse and reopen a section.
- **The Node 20.18 lane proves the plugin runtime, not the test toolchain (load-bearing)**:
  `engines.node` stays `>=20.18` because that is the published runtime contract, and the blocking
  `node-20-compatibility` job in `ci.yml` defends it by installing, type-checking, checking module
  boundaries, building, and smoke-loading the built plugin on that exact Node. What it deliberately
  does NOT do is run the unit suite. Vitest 5 declares `node: ^22.12.0 || ^24.0.0 || >=26.0.0`, and
  the two floors are separable: a plugin runs inside the Signal K server process, `signalk-server`
  declares `node: >=22`, so no supported installation ever executes this plugin on Node 20. What the
  floor still promises is that the plugin's own compiled code loads and runs there, which
  `scripts/check-plugin-runtime.mjs` turns from "it compiled" into "it loads, constructs, and
  answers `schema()`". `npm test` on such a Node prints a notice naming the Vitest floor and exits 0
  rather than crashing inside the runner. The predicate lives in `scripts/unit-test-toolchain.mjs`
  with the floors written out rather than parsed, including the gaps at Node 23 and Node 25, and
  `scripts/test-unit-test-toolchain.mjs` pins them at their boundaries from `package:check`. Bump
  the floors there when Vitest bumps its own, and extend the boundary test. `check-workflows.mjs`
  asserts the lane keeps its type-check, boundary, build, and runtime steps, so the proof cannot
  quietly erode into a type-check alone.
- **`devEngines.runtime` stays on `onFail: "warn"` (load-bearing)**: the range
  is the toolchain floor (`^22.22.2 || ^24.15.0 || ^26.0.0`), which deliberately
  excludes the Node 20.18 runtime floor this plugin advertises. The blocking
  `node-20-compatibility` CI job installs the full dev tree on Node 20.18, so
  `onFail: "error"` would abort that job with `EBADDEVENGINES` (npm exits 1)
  before it could type-check or build. Sibling plugins whose runtime floor is
  Node 22 or newer use `"error"` safely; this one cannot while it defends a
  Node 20 floor.
- **Third-party notices**: the panel remote bundles its dependency tree into
  `public/*.mjs`, so the published package redistributes that code and owes
  the MIT and Apache-2.0 notice obligations. `THIRD_PARTY_NOTICES.md` is
  GENERATED by `npm run licenses` from the packages webpack actually bundles,
  with each license text embedded, and `npm run package:check` re-verifies it
  with `--check`. Its header marker records the installed shared UI version,
  read through `require('signalk-nearlcrews-ui/package.json')`, and
  `snui-check-consumer` asserts that version equals the pin. Webpack's terser sidecar covers only the React JSX runtime,
  so it does not discharge the obligation on its own. The esbuild plugin
  bundle carries no third-party code, so it needs no entry. Regenerate after
  any change to the panel's dependency tree.
- **Shared cross-boundary constants**: `src/constants/notifications-shared.ts` is the single source of truth consumed by the TS runtime, the rjsf schema in `src/plugin/schema.ts`, and the federated panel: `NOTIFICATION_LABELS` (5 sub-toggle strings), `NOTIFICATION_MASTER_LABEL`, `NOTIFICATION_BAND_KEYS`, `DEFAULT_NOTIFICATIONS`, `CONFIG_DEFAULTS`, the provider and mode registries (`WEATHER_PROVIDER_IDS`, `WEATHER_PROVIDER_LABELS`, `DEFAULT_WEATHER_PROVIDER`, `resolveWeatherProvider`, `providerRequiresApiKey`, `WEATHER_MODE_IDS`, `WEATHER_MODE_LABELS`, `DEFAULT_WEATHER_MODE`, `resolveWeatherMode`, `DEFAULT_MERGE_PROVIDERS`, `resolveMergeProviders`), `isOpenMeteoActive()` (the single rule for when the self-host base URL applies, shared by the runtime config gate, the panel's `deriveSourceState`, and the panel's save-time check), `API_KEY_MIN_LENGTH`, `QUOTA_WARN_RATIO`, `PLUGIN_NAME` / `PLUGIN_DISPLAY_NAME`, and `validateApiKeyCandidate()`. Existing imports use the `.js` specifier (NodeNext style); webpack resolves them to the `.ts` source via `extensionAlias`. Labels, defaults, bounds, the quota ratio, and the provider and mode lists can no longer drift between the panel, the schema, and the runtime. (Until v1.8.0 this was a plain-JS module with a hand-synced `.d.ts` shim; both collapsed into the single `.ts` file.)
- **Panel-supporting REST endpoints**: `Plugin.registerWithRouter` mounts `GET /api/status` (live banner + 24h API count + minutes since last fetch + active-notification count + `weatherProviderRegistered` flag, typed as `PanelStatusResponse` in `src/types/index.ts`; the panel renders the flag as a "Weather API" On/Off stat card) and `POST /api/test-key` (probes a candidate AccuWeather key with one `AccuWeatherService.verifyApiKey()` call, single AccuWeather API call per test). Both endpoints are read-only or non-mutating; neither persists a key. The panel polls `/api/status` every 10 s. `TEST_KEY_LOCATION` (Greenwich Observatory coords, arbitrary fixed point) lives in `src/constants/index.ts`.

## Technology Stack

- TypeScript 7.0+ (strict mode, ES2023 target)
- Node.js 20.18+ runtime, with Node.js 24.19.0 and npm 12.0.2 for development
- `@signalk/server-api` 2.24+ as a `peerDependency` (the Signal K server provides it at runtime; not bundled). Used for `Plugin`, `ServerAPI`, `Delta`, `PathValue`, `Meta`, `MetaValue`, `SourceRef`, and `SKVersion` types.
- esbuild 0.28+ for bundling (current runtime bundle ~172 KB)
- Biome 2.5 for code linting and formatting, plus Markdown linting and cspell
- Vitest 5 for unit and integration testing, with Stryker mutation testing as an opt-in check. Its `engines.node` is `^22.12.0 || ^24.0.0 || >=26.0.0`, so it cannot run on the Node 20.18 runtime floor; see the runtime-floor lane entry below for why that is not a reason to hold it. Its `@types/node` peer range of `^22.0.0 || >=24.0.0` is reconciled by an `overrides` block pinning that peer to the root `@types/node`, which stays in major 20 to match `engines.node`.
- React 19.3, `signalk-nearlcrews-ui` 0.11.1, webpack 5, esbuild-loader 4.5,
  Vite 8, and Playwright 1.63 for the federated panel
- Repository-owned opt-in Git hooks under `.githooks/`, enabled with `npm run hooks`

## Documentation Structure

Docs are organized by audience. Do not move files back to the repo root: a clean
root is the deliberate first impression for npm and GitHub.

```
root/
  README.md        # end-user landing page, also the npm package page
  CHANGELOG.md     # full Keep-a-Changelog history (canonical release record)
  CLAUDE.md        # this file (tooling convention keeps it at root)
  LICENSE
  THIRD_PARTY_NOTICES.md  # generated; licenses of the packages the panel bundles
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

- **README is the npm page AND the Signal K App Store page.** Keep it a landing page (features, requirements, install, config, what-it-emits, integration, notifications, troubleshooting summary, doc index), not a reference manual. Deep reference lives in `docs/`.
- **`README.md` must contain NO relative markdown file links.** The App Store README view renders link targets unmodified and rewrites only IMAGE paths (against the package CDN), so a relative link to `docs/…`, `CHANGELOG.md`, or `LICENSE` is dead there even though it works on npm and GitHub. Use absolute `https://github.com/NearlCrews/signalk-virtual-weather-sensors/blob/main/…` URLs for every file link; relative image paths stay relative, because the images ship inside the tarball. Nothing enforces this: `lint:docs` and `spellcheck` have no relative-link rule.
- **Relative links cross directories.** Files in `.github/` and `docs/` reach the root with `../` (for example `.github/CONTRIBUTING.md` links `../LICENSE`, `../docs/DEVELOPMENT.md`). After any doc move, re-verify every relative markdown link.
- **`docs/DEVELOPMENT.md` heading anchors are load-bearing.** `.github/pull_request_template.md` links `../docs/DEVELOPMENT.md#signal-k-standards-compliance`; keep that heading text stable.

## Release Process

- **README carries the latest release's notes.** The README has a `## What's new in X.Y.Z` section, placed right after the intro and safety blockquote and before `## What it does`. It holds ONLY the most recent release, overwritten on every release (never an accumulating list); the full history stays in `CHANGELOG.md`.
- **What's new content shape.** A one-sentence lead, then 3 to 5 bolded-lead bullets sourced from the `CHANGELOG.md` entry (`CHANGELOG.md` is canonical, written first), then a closing line linking the version's changelog anchor and the changelog for the full list. Each release heading in `CHANGELOG.md` carries an explicit `<a id="vXYZ"></a>` anchor (version digits without dots, e.g. `#v180` for 1.8.0); link that anchor, not the GitHub auto-generated heading anchor.
- **Release step.** `docs/maintainers/RELEASE.md` Fast Path step 1 includes overwriting the README `## What's new` section. Bump the heading version, add the new `<a id="vXYZ"></a>` anchor in `CHANGELOG.md`, and update the README link each release.

## Shared skills

Domain expertise for this repository lives in the shared skills installed for both Codex and Claude Code from `~/src/nearlcrews-agent-toolkit` (Claude Code: `/skill-name`; Codex: `$skill-name`; both hosts also select them from their descriptions). Load these before working here:

- `marine-weather`: this plugin's provider contract, AccuWeather, Open-Meteo, and Met.no API facts, quota and cache arithmetic, hazard thresholds, notification bands, and LLM weather-risk classification.
- `signalk-development`: Signal K plugin lifecycle, server APIs, deltas, route security, package metadata, App Store, registry score, plugin CI, and release readiness.
- `maritime-ui`: any helm-facing or safety-relevant presentation of weather data.
- `standardize-project-toolchain`: toolchain audits, lint, type, test, and CI alignment, and Node or TypeScript floor decisions.

To delegate, spawn a general-purpose subagent and tell it which of these to load; there are no per-host agent definitions.
