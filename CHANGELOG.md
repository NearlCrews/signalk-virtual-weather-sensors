# Changelog

All notable changes to the signalk-virtual-weather-sensors project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Merge mode blends all available providers into a single synthetic source.**
  Selecting "Merge available providers" (`weatherMode: 'merged'`) builds a
  `MergingWeatherProvider` that polls Open-Meteo, Met.no, and AccuWeather (when a
  key is configured) in parallel and blends the results into unified current
  conditions stamped `$source: 'merged'`. Hazard-bearing fields escalate to the
  most conservative value: severe condition, precipitation, and gust take the
  maximum; visibility takes the minimum; a falling barometer wins. Categorical
  and single-valued fields (WBGT, precipitation type, condition text) are taken
  from the highest-priority provider that reports them, not averaged. Wind
  direction uses a speed-weighted circular mean with an opposing-wind fallback to
  avoid the 0/360-degree wrap artifact. Derived quantities (wind chill, heat
  index, Beaufort scale, absolute humidity, air density, heat-stress index, gust
  factor) are recomputed from the blended base values so they stay internally
  consistent. The marine layer, warnings, and forecasts are not merged: forecasts
  and observations delegate to one designated forecast-capable child for model
  coherence, and the marine layer continues on its own independent fetch.
  Note: switching to merged mode re-stamps every weather delta from the prior
  provider-specific `$source` (such as `open-meteo`, `met-no`, or `accuweather`)
  to `merged`, so any source-priority rule or subscription filter pinned to the
  old ref will stop receiving data until updated.

<a id="v191"></a>

## [1.9.1] - 2026-06-21

A maintenance release: cleaner first-run saves, correct timestamps and alert
ordering, clearer failure reporting, and a quieter marine layer.

### Fixed

- **Config panel could not save a fresh keyless install.** The federated panel
  still required a 20-character AccuWeather key at save time even under the
  default keyless Open-Meteo source, blocking a clean first-run save (and
  force-opening a hidden AccuWeather section). The key is now validated only when
  AccuWeather is the active provider, matching the JSON schema.
- **Open-Meteo observation timestamps now carry a UTC designator.** Open-Meteo
  returns a GMT wall-clock string with no zone; the plugin now normalizes it to
  an RFC 3339 instant (appends `Z`) so a strict consumer cannot misread it as
  local time. Affects both the atmospheric and marine observation times.
- **Weather warnings sort chronologically across time zones.** Active alerts are
  ordered by parsed instant rather than by raw string, so NWS timestamps that
  carry a local UTC offset are no longer ordered incorrectly.
- **Sustained emission failures surface to the status banner.** A persistent
  failure to publish deltas now sets a plugin error banner instead of only
  logging, so an operator is not shown a green "Running" status while no data
  reaches the bus.
- **Best-effort marine layer is quieter and safer.** A marine fetch that
  resolves after the plugin has stopped no longer repopulates a torn-down
  service, and a tolerated marine outage logs once (at debug) instead of
  double-reporting as an error.

### Changed

- **Dev dependencies refreshed.** Updated the build and test tooling to current
  versions and added a `qs` override that clears a dev-only `npm audit` advisory
  pulled in through the mutation-test runner. No runtime dependency changed.

### Documentation

- **Switching the weather source changes the delta `$source`.** Troubleshooting
  now documents that changing `weatherProvider` re-stamps every weather delta
  from `accuweather` to `open-meteo` (or back), so a downstream consumer pinned
  to the old source, such as a `signalk-nmea2000-emitter-cannon` source lock or a
  server source-priority rule, silently stops receiving the data until its lock
  is updated to match.

<a id="v190"></a>

## [1.9.0] - 2026-06-17

A keyless, global weather source so the plugin works out of the box.
AccuWeather retired its permanent free tier (it is now a 14-day trial, then a
paid plan), so a new install defaults to Open-Meteo, which needs no API key and
no signup. Existing AccuWeather installs are preserved unchanged on upgrade.

### Added

- **Open-Meteo provider, free and keyless.** A new global weather source backed
  by national models (ECMWF, GFS, ICON, and others). It supplies temperature,
  wind, pressure, humidity, dew point, cloud cover, UV, visibility, gusts, and
  precipitation, and the plugin recomputes wind chill and heat index and
  estimates the wet-bulb globe temperature so the heat-stress notification band
  still works without a measured value.
- **Weather-source selection.** A `weatherProvider` option (Open-Meteo or
  AccuWeather) with a picker in the config panel. New installs default to
  Open-Meteo; an install that already has an AccuWeather key stays on AccuWeather.
- **Configurable Open-Meteo endpoint.** An `openMeteoBaseUrl` option so a
  commercial user can point at a self-hosted Open-Meteo server or a paid plan
  (the free public service is for non-commercial use).
- **Optional sea-state layer.** A `marineData` toggle (off by default) adds a
  keyless Open-Meteo Marine fetch, independent of the atmospheric source. It
  emits sea surface temperature on the canonical `environment.water.temperature`
  leaf, surface current on the canonical `environment.current` node, and waves
  and swell (significant height, period, direction, and wind-wave height) on
  producer-namespaced `environment.water.waves.*` / `swell.*` leaves with meta.
  The marine deltas carry a distinct `open-meteo-marine` `$source` so the model
  sea temperature and current yield to a real sensor under source priorities,
  and inland points (no marine data) emit nothing.
- **v2 Weather API observations.** With an AccuWeather key, the `observations`
  endpoint now serves current conditions for the requested position (including
  pressure and pressure tendency the forecasts do not carry) instead of
  returning an error, on a short-TTL quota-aware cache.
- **v2 Weather API warnings (US waters).** The `warnings` endpoint now serves
  region-aware severe-weather alerts: NWS CAP active alerts for US waters
  (keyless, best-effort), and an empty list elsewhere rather than a fabricated
  alert. Met.no MetAlerts for Nordic waters is planned. Warnings ride the v2
  provider, so they are exposed while AccuWeather is the active source.

### Changed

- **AccuWeather is now optional.** It remains a supported source for its
  exclusive fields (RealFeel, plain-language conditions text, pressure tendency,
  precipitation type) when a key is configured. The API key is no longer required.
- **Per-provider `$source`.** Deltas now carry the active provider's source ref,
  so Open-Meteo data is `$source: 'open-meteo'` while AccuWeather stays
  `accuweather`. Existing source-priority rules keep working because an upgrade
  never silently switches a configured AccuWeather install.
- **The severe-condition notification is provider-agnostic.** Each source maps
  its own condition encoding (AccuWeather icon code, Open-Meteo WMO weather code)
  to a shared classification, so the band behaves the same regardless of source.
- Plugin icon badge refresh: the thundercloud glyph keeps its design but the
  cloud and lightning bolt are drawn slightly larger and bolder so the badge
  reads better at app-store thumbnail size. The family base (deep-ocean gradient
  and three wave lines) is unchanged, and all PNG sizes are regenerated from the
  updated SVG.

### Internal

- Shared helpers consolidated with no behavior change: a single
  `assertValidCoordinates` coordinate guard in `validation.ts`, a
  `normalizeBaseUrl` base-URL helper and a `DEFAULT_REQUEST_TIMEOUT_MS` constant
  in a new `http.ts`, and an `asStringOrEmpty` coercion in `conversions.ts`,
  plus deduplicated test fixtures.

### Notes

- **Open-Meteo field parity.** Open-Meteo does not provide RealFeel, RealFeel
  shade, a measured wet-bulb globe temperature (the plugin estimates the
  heat-stress index instead), pressure tendency, precipitation type, cloud
  ceiling, visibility obstruction, or the 24-hour temperature departure. Those
  `environment.weather.*` leaves are emitted only under AccuWeather. The severe
  condition text comes from WMO weather codes.
- The Signal K v2 Weather API forecast endpoints are advertised only when
  AccuWeather is the active source; Open-Meteo forecast support is planned.

<a id="v180"></a>

## [1.8.0] - 2026-06-11

A whole-codebase cleanup followed by a full config-panel
rebuild. The panel is now TypeScript end to end and aligned with the
signalk-nmea2000-emitter-cannon panel architecture: design tokens with light,
dark, and night-red themes, WCAG AA contrast, marine-sized touch targets,
dirty-state tracking with Save and Discard, and a first-run callout. On the
runtime side the request timeout now bounds the whole response rather than just
the headers, overlapping weather updates coalesce into a single fetch, and a
quota pause no longer halts the NMEA2000 keep-alive while cached data is still
fresh. No emitted measurement path, delta shape, or notification band changed,
and all 334 tests pass.

### Added

- **Config panel themes.** Auto, Light, Dark, and Night (night-red helm mode) via a `--svws-*` design-token contract in `styles.ts`; the panel follows the host Admin UI theme by default and pins an explicit pick to localStorage. Muted text meets WCAG AA contrast in every palette, interactive elements get a visible `:focus-visible` ring, and checkboxes and buttons are sized for wet fingers (22 px and 36 px minimum).
- **Dirty-state handling.** The panel tracks unsaved edits, shows an "Unsaved changes" indicator in a sticky footer with Save and Discard, guards `beforeunload` while dirty, and still confirms the plugin actually restarted after a save before claiming success.
- **First-run callout.** With no API key configured, the panel says so and auto-opens the API key section instead of presenting three collapsed sections.
- **Accessibility wiring.** Collapsible sections expose `aria-expanded` plus `aria-controls` and show a collapsed-state value summary; the API-key test result and save outcome announce via `role="status"` live regions; the notification toggles sit in a `fieldset` with a `legend` and stay readable when disabled.
- **Clamping number inputs.** Cadence fields clamp to their bounds on commit and blur on wheel so scrolling cannot silently change values.
- **Status dashboard improvements.** The five stat cards render when the plugin is stopped (previously hidden exactly when diagnostics were needed), the status dot has an adjacent text label, large counts use locale formatting, "Minutes since fetch" is spelled out, and a failed status poll surfaces a retry banner plus a stale-poll marker instead of silently freezing.
- **Night-mode screenshot** added to the App Store gallery, and **signalk-binnacle** added to the "Works well with" list (it detects and prefers this plugin's Signal K v2 Weather API).

### Fixed

- **Request timeout now bounds the body read.** The abort timer was disarmed when response headers arrived, so a stalled or trickling body was bounded only by undici's 300 s inactivity default instead of the configured 10 s `requestTimeout`. The timer now stays armed across the body read.
- **Overlapping weather updates coalesce (single-flight).** A slow fetch overlapping the next scheduled tick, or a `forceUpdate` racing the timer, ran concurrent fetches that double-spent API quota and raced the post-fetch state writes. Overlapping callers now join the in-flight fetch.
- **Quota pause no longer halts the keep-alive.** Hitting the daily quota stops fetches, but the 5-second re-emission of still-fresh cached data now continues until the staleness guard trips, so NMEA2000 consumers do not drop the virtual sensor; the quota banner still surfaces immediately and wins over the stale message.
- **Misleading notifications label.** "Enable PGN notifications" renamed to "Enable severe-weather notifications" in both the panel and the schema: the plugin emits Signal K-native notifications, and PGN bridging requires the separate signalk-to-nmea2000 plugin.
- **API-key placeholder feedback.** The placeholder check now runs before the min-length check, so "demo"-style keys get the actionable "appears to be a placeholder" message instead of a generic "too short".
- **Log sanitizer redacts inside arrays.** A sensitive key nested in an array entry (for example `{ items: [{ apiKey }] }`) previously bypassed redaction.
- **Documentation corrections.** The location-cache TTL in `docs/troubleshooting.md` (1 hour, not 2), the per-file test breakdown and test tree in `docs/DEVELOPMENT.md` (two Weather API provider test files were missing), and the "24+" data-point count in `CLAUDE.md` (30+).

### Changed

- **Config panel rewritten in TypeScript** from one 612-line JSX file to a composition of `components/`, `hooks/`, `styles.ts`, and `api-base.ts`, type-checked by a dedicated `tsconfig.panel.json` (wired into `npm run type-check`). webpack gains `@babel/preset-typescript` and an `.js`-to-`.ts` `extensionAlias`; the load-bearing ESM module-federation settings are unchanged.
- **`notifications-shared` is now TypeScript.** The plain-JS module and its hand-synced `.d.ts` shim collapsed into one `.ts` file that single-sources the master notification label, the plugin name and display name, the quota warn ratio, the notification band keys, and the API-key length validation for the runtime, the rjsf schema, and the panel.
- **Tick banner selection moved into `WeatherService.getTickBanner()`**, which owns the precedence (quota message, then stale message, then live status) and the stale-message format; the banner's "90%" now derives from `QUOTA_WARN_RATIO` so the text cannot drift from the gate.
- **Notifier band sets carry their comparison direction** (`ascending` for wind and heat, `descending` for visibility and cold), so a miswired evaluator call is unrepresentable; the two near-identical band evaluators merged into one.
- **Dropped the `prepack` script.** `prepublishOnly` already validates and builds on publish; `prepack` made `npm publish` build twice.

### Internal

- **De-duplication.** The course-over-ground fallback chain reuses `readNumericSelfPath`, `capForChartplotter` reuses `truncateToCodePoints`, `pascalsToMillibars` restores converter symmetry, `withEmissionTimestamp` rebuilds through `buildValuesDelta`, `getHealthStatus` reads the clock once via a shared `hasCompleteData`, `CachedVesselData` is `readonly`, and the log sanitizer collapsed to one recursive walker with one depth policy.
- **Panel render hygiene.** A healthy, unchanged status poll performs zero state writes (previously six full-tree re-renders per minute); the panel shares `toErrorText`, `clampNumber`, and `fetchJson` helpers instead of three copies of each.
- **Tests 327 to 334.** New coverage: the stalled-body-read abort, single-flight coalescing, and tick-banner precedence.
- **Dead code removed.** `DEFAULT_CONFIG.DAILY_API_QUOTA_MAX`, an unreachable apparent-wind fallback, a stale Zod reference, and the write-only render-trigger state in the status hook.

<a id="v172"></a>

## [1.7.2] - 2026-05-31

Whole-codebase cleanup pass: correctness fixes to the forecast mapper and
notification clears, broad de-duplication, and doc-accuracy corrections. No emitted measurement path,
delta shape, public config, or notification band changed.

### Fixed

- **Forecast mapper no longer emits 0 K for a missing temperature.** `mapHourlyToForecasts` and `mapDailyToForecasts` route `Temperature.Value` (and the daily min/max) through a finite guard, omitting the leaf when the value is absent rather than letting `celsiusToKelvin` floor non-finite input to absolute zero. `absoluteHumidity`, which needs temperature, is omitted with it.
- **Cleared severe-weather notifications carry an empty message.** The ascending and descending band evaluators now emit `''` on the `state: 'normal'` exit transition, matching `clearBands` and the severe-condition path, so a consumer no longer renders stale hazard text (e.g. "Gale-force wind: Bf6…") on a cleared alert.
- **Speed-over-ground rejects a NaN value.** `getVesselSpeedOverGround` validates through the new `isValidVesselSpeed`, so a NaN (which slipped past the bare `typeof === 'number'` check) is treated as missing rather than reported as a valid speed.
- **Non-retryable HTTP statuses are no longer retried.** In `handleApiError`, a 4xx other than 429 is tagged `API_INVALID_RESPONSE` (non-retryable) instead of `NETWORK_ERROR`, so the client stops burning retry attempts and quota on client errors that cannot succeed on retry; 5xx stays retryable.
- **Consistent non-finite temperature fallback.** `celsiusToKelvin` returns the 0°C-equivalent for non-finite input, matching its sibling converters instead of flooring garbage to absolute zero.

### Internal

- **De-duplication and helper extraction.** Shared cache eviction (`evictOldestOverCap`), a shared retryable-status thrower, a `readNumericSelfPath` accessor behind the navigation getters, a `buildCloudAndPrecip` mapper helper, `formStateFromConfig` in the config panel, and `isValidVesselSpeed` / `isValidBearing` domain validators. The Fahrenheit conversion functions moved out of the `UNITS` data table into `conversions.ts`, leaving `UNITS` pure data.
- **Validator bounds reference `CONFIG_DEFAULTS`.** `NUMERIC_CONFIG_RULES` reads its min/max from `CONFIG_DEFAULTS`, the same source the sanitizer clamps to, so the validator warning threshold and the runtime clamp cannot drift.
- **In-flight location-search coalescing.** Concurrent cold forecast lookups for the same coordinates share one upstream location search, so a dashboard polling both forecast endpoints no longer spends two requests for one lookup.
- **Provider unregistration is leak-safe.** A throw after `registerWeatherProvider` now unregisters the provider during startup-error cleanup, so a half-started plugin cannot leave the provider registered in the server.
- **Mapper failures stop re-logging every tick.** A persistent mapping failure pins the failing snapshot so the emission tick skips re-mapping (and re-logging) it until new data arrives.
- **Dead code and doc rot removed.** Three unused `ERROR_CODES`, a dead apparent-wind guard, an unreachable mapper guard, a dead heat-index term, a reimplemented angle wrap, a double code-point allocation, and several stale or self-restating comments (including a rotted rolling-window doc and a `consecutiveFailures` comment referencing a nonexistent constant). The mapper and wind-calculator constructor "initialized" info logs were demoted to debug.
- **SignalK plugin-ci now passes (App Store Indicators).** Removed the `prepare: husky` script: on Node 22 (npm 10) its lifecycle banner leaked into the App Store install simulation's `npm pack` stdout capture, corrupting the tarball path and failing the Linux and Windows plugin-ci jobs. The pre-commit hook is now opt-in via `npm run hooks`. Corrected the `plugin-ci.yml` comment to match the reusable workflow's current default matrix (Node 22 and 24, plus the armv7 Cerbo GX lane on Node 20 and an es-check es2023 gate).

### Documentation

- Corrected the esbuild bundle size (~98 KB) and the test count (327 across 13 files) in `docs/DEVELOPMENT.md` and `CLAUDE.md`, and the husky hook setup (now manual via `npm run hooks`) in `docs/DEVELOPMENT.md` and `.github/CONTRIBUTING.md`.

<a id="v171"></a>

## [1.7.1] - 2026-05-28

A small observability and cleanup release. The config panel now shows whether
the Signal K v2 Weather API provider is registered this start cycle, via a new
"Weather API" status card backed by a `weatherProviderRegistered` flag on the
`/api/status` payload. The rest of the release is internal de-duplication:
a shared `elapsedSinceMs` time helper, a
`ratio`-parameterized `isApiQuotaReached`, a single-sourced AccuWeather
provider name, and consolidated AccuWeather URL building. No emitted paths,
delta shape, or notification behavior changed, and all 326 tests pass.

### Added

- **Config panel "Weather API" status card.** The panel now surfaces whether the Signal K v2 Weather API provider is registered, so an operator can see at a glance that `/signalk/v2/features` advertises `weather` and the forecast endpoints are live. It is backed by a new `weatherProviderRegistered` boolean on the `/api/status` payload and on the `PanelStatusResponse` type, which is `false` on servers older than the 2.24 peer floor that lack `registerWeatherProvider`, and on a stopped plugin.

### Internal

- **Shared `elapsedSinceMs` time helper.** Extracted to `conversions.ts` and used by both `WeatherService.getDataAgeMs` and `SignalKService.getDataAge`, so the "clamp at zero against a backward NTP or wall-clock jump" rationale lives in one place instead of being duplicated across the two accessors.
- **`isApiQuotaReached` takes a `ratio` parameter.** The hand-rolled `used / quota >= WARN_RATIO` guard in `WeatherService.shouldShowQuotaWarning` now delegates to the shared helper, so the disable-cap semantics (quota 0, non-finite, or negative) back both the warn and exhaust thresholds from one place.
- **AccuWeather provider name single-sourced as `PLUGIN.PROVIDER_NAME`.** The `'AccuWeather'` literal was repeated in `WeatherProviderAdapter` and the registration log; both now reference the constant so the provider identity cannot drift.
- **Consolidated AccuWeather URL building.** New `buildApiUrl` and `buildLocationKeyUrl` helpers remove the `apikey` / `language` / `details` query-param triplet that was hand-built in three places, and the location-key path guard that was duplicated in two. The current-conditions, location-search, and forecast hops now route through them.
- **`getHealthStatus` reads the data age once.** It derived `dataAge` and `isStale` from separate `getDataAge()` calls; both now come from a single read via a private `isAgeStale` helper, so the reported age and staleness cannot disagree across a clock tick.

<a id="v170"></a>

## [1.7.0] - 2026-05-28

A feature release that turns the plugin into a Signal K v2 Weather API
provider, so dashboards and apps can pull AccuWeather forecasts directly over
REST instead of subscribing to the delta stream. Registering the provider is
also what makes the server advertise `weather` under `/signalk/v2/features`,
the flag dashboards like signalk-open-binnacle gate their weather UI on.
Forecasts are mapped to SI units, cached on demand, and share the plugin's
rolling-24h API quota so a polling client cannot exhaust a free key. The
release also adds config panel screenshots and registry metadata, and all 326
tests pass.

### Added

- Signal K v2 Weather API provider: the plugin now registers a `WeatherProvider` via `app.registerWeatherProvider(...)` and unregisters it on stop. `getForecasts('point')` is backed by the AccuWeather 12-hour hourly endpoint and `getForecasts('daily')` by the 5-day daily endpoint, both mapped to the SI `WeatherData` envelope. Consumers query `/signalk/v2/api/weather/forecasts/point` or `/signalk/v2/api/weather/forecasts/daily`. Forecasts are cached (30 min hourly, 3 h daily) and share the daily API quota so a polling client cannot exhaust a free key. `getObservations` and `getWarnings` are not served yet (Phases 2 and 3).
- Config panel screenshots shipped in the package and declared via `signalk.screenshots` in `package.json`, so the Signal K Appstore and the plugin registry render them.

### Changed

- `npm test` now runs the suite once and exits (previously Vitest watch mode). Use `npm run test:watch` for the interactive watch runner. This keeps CI and the Signal K plugin registry from hanging on the test step.

### Internal

- Promoted `asOptionalNumber` to `conversions.ts` and reused it in the forecast mapper, extracted a shared `locationCacheKey` helper and a `quotaReachedError` helper in `AccuWeatherService`, and widened `isApiQuotaReached` to treat an undefined quota as disabled.

<a id="v164"></a>

## [1.6.4] - 2026-05-25

A correctness and spec-polish release: 44 fixes across spec compliance,
TypeScript lifecycle, and calculator, mapper, and notifier math. Highlights: every banner write now routes through the
plugin entry's dedupe so a flapping API or steady-state quota pause produces
one banner per unique message rather than one per emission tick; a rejected
API key now surfaces on the status banner and on the admin panel's `running`
flag instead of leaving the panel showing a green indicator on a plugin that
has stopped fetching; three more AccuWeather decode sites (`Ceiling`,
`Precip1hr`, `Past24HourTemperatureDeparture`) carry the same `typeof` guard
already used for `uvIndex`; the rolling 24h quota window zeroes on a backward
clock jump instead of leaving stale-labelled buckets that could overcount; and
visibility plus cloud ceiling pin marine-convention `displayUnits`
(nautical miles and feet) so the data browser stops rendering them in statute
miles. Internal: 38 new tests pin exact-threshold mutation guards, suffix
coverage gaps, sanitizer NaN handling, and `apparentWindAngle` boundary
folding. The delta envelope and the notification value shape are unchanged,
and all 303 tests pass.

### Changed

- **Every status / error banner write routes through the entry-point dedupe.** `WeatherService` previously called `app.setPluginStatus` and `app.setPluginError` directly on the quota-exhausted path, the first-update path, and both branches of the fetch-failure path, bypassing the `setBanner()` wrapper in `index.ts` that owns the `(kind, message)` dedupe. A `BannerSink` callback supplied by the plugin entry now sinks every banner write through `setBanner` so identical consecutive messages land one banner per unique string.
- **`WeatherService.formatStatusBanner()` surfaces the API-key-rejected state.** When a 401 has tripped `apiKeyRejected`, the banner returns `"API key rejected: update key in plugin settings"` instead of the running banner. The admin panel's `/api/status` `running` flag is also `false` in that state so the panel does not show a green indicator on a plugin that will never recover until the operator updates the key.
- **Visibility and cloud ceiling carry `displayUnits` for nautical miles and feet.** Both paths previously rendered in statute miles via the Signal K distance category default. The `environment.weather.visibility` path now pins a custom conversion to nautical miles, and `environment.weather.cloudCeiling` pins a custom conversion to feet, matching marine and aviation convention regardless of the operator's distance-preference setting. The emitted values and `units` are unchanged.
- **`environment.outside.apparentWindChillTemperature` carries a meta override.** The canonical leaf now ships an operator-visible description that documents the silent fallback to the theoretical wind chill when no vessel-motion data is available. The fallback behaviour and emission contract are unchanged.
- **Wind-chill formula attribution corrected.** The activation gates (`T <= 10 C`, wind >= 4.8 km/h) follow the NWS regime of the JAG/TI 2001 formula, not the stricter Environment Canada operational gates. The formula itself is identical between the two agencies; only the in-code comment moved.
- **Threshold-direction documentation clarified for descending bands.** The `NOTIFICATION_THRESHOLDS` comment now distinguishes the ascending semantics (`>= threshold` activates) for wind and heat from the descending semantics (`< threshold` activates) for visibility and cold, so an operator reading the doc does not believe visibility of exactly 1 nm trips the band.

### Fixed

- **Three AccuWeather decode sites now reject non-numeric values.** `Ceiling.Metric.Value`, `Precip1hr.Metric.Value`, and `Past24HourTemperatureDeparture.Metric.Value` were assigned directly from the response with no `typeof` check, so a `null` from a partial response could slip through the optional-spread guard and land on `environment.weather.*` paths typed as numeric. Each is now decoded through the same defensive helper used for `uvIndex` and is omitted when not a number.
- **The rolling 24h API-quota window zeroes on a backward clock jump.** The previous fix re-anchored the hour index but left the 24 hourly buckets carrying counts under their now-future labels, so up to 24 hours of subsequent reads could overcount and falsely trip the quota-exhausted state. A backward jump now clears every bucket: undercounting briefly is far safer than capping fetches against ghost requests.
- **`AccuWeatherService` API-key validation runs before any field assignment.** A throw from the constructor previously left `this.config` already assigned with the bad key. Validation now happens first, so an instance that throws cannot leak a partially-initialised state.
- **`WeatherService.getDataAgeMs()` and `SignalKService.getDataAge()` clamp at zero.** A backward wall-clock jump produced a negative age that rendered as `"last update -3m ago"` on the banner and slipped past staleness comparisons. Both accessors now floor at zero.
- **`isWithinNMEA2000Ranges` no longer lets `NaN` slip the fast path.** `NaN < min` and `NaN > max` are both false per IEEE-754, so a `NaN` numeric field with every other field in range would short-circuit the sanitizer and land on the bus. Non-finite values now force the slow clamping path, which floors them to the configured minimum.
- **`sanitizeLogMetadata` guards depth and cycles.** A cyclic metadata reference could stack-overflow the Node process when a `warn` or `error` was logged. The function now carries a depth cap and a `WeakSet` of seen objects, returning `[CIRCULAR]` for cycles and a sentinel for over-depth.
- **Notifier method arrays are frozen.** `VISUAL_ONLY`, `VISUAL_AND_SOUND`, and `NO_METHODS` were shared module-scope references attached to every notification by `methodsFor`. They are now `Object.freeze`d so a downstream consumer that casts away the readonly contract cannot mutate the shared instance.
- **Invalid-input wind-analysis fallback never surfaces a negative speed.** `trueWindSpeed || 0` would let `-5` through as the fallback because negative numbers are truthy. The fallback now clamps any non-finite or negative input to zero.
- **WeatherIcon severity table covers flurry variants 19, 20, and 21.** Codes 19 (Flurries), 20 (Mostly cloudy with flurries), and 21 (Partly sunny with flurries) now warrant the same `warn` severity as code 22 (Snow). Codes 12 to 14 (rain showers) and 18 (Rain) remain absent: liquid precipitation without thunder is surfaced through the visibility band's rain-rate suffix, not as a standalone severe-weather alert.
- **The dead `CONSECUTIVE_FAILURE_LIMIT` indirection is gone.** The static was set to 1, so the gate `consecutiveFailures >= 1` was true on every failure. The control flow is now unconditional with the same observable behaviour: dedupe in the new banner sink keeps repeated identical messages from flooding the admin UI.
- **Two dead exports in `src/utils/conversions.ts` are documented `@internal`.** `isWithinBounds` and `calculateSaturationVaporPressure` are still exported because the conversions test suite exercises them directly, but external callers should reach them through the domain-specific wrappers.

### Internal

- 38 new tests pin previously-uncovered cases: exact-threshold mutation guards on all four band axes (Beaufort 8 for gale-only, visibility 1852 m for `<` strictness, wind chill 273.15 K, HSI 2 for caution-only), wind-suffix gust equals sustained, visibility-suffix rain segment omitted at zero or non-finite precipitation, severe suffix missing description and missing pressure, cardinal-rose 22.5-degree boundary handling, `getActiveCount` across categories, `WindCalculator` invalid-input fallback shape, full-frame apparent-wind angle coverage including tail wind (`+pi`) and head wind (`0`), sanitizer NaN clamping on numeric fields and angles, and `apparentWindAngle` plus `windDirection` boundary folding at `+/- pi` and `2 pi`.
- The `BannerSink` plumbing keeps `WeatherService` constructable without a sink (tests fall back to direct `app.setPlugin*` writes) so the change does not require touching every existing test fixture.

<a id="v163"></a>

## [1.6.3] - 2026-05-22

Corrects how precipitation and the 24-hour temperature departure are presented
to Signal K consumers. `environment.weather.precipitationCurrent` is removed: it
re-expressed AccuWeather's past-hour precipitation accumulation as an `m/s`
rate, which duplicated `environment.weather.precipitationLastHour` (the same
underlying quantity) and made the Signal K data browser render it as a vessel
speed in mph. The two surviving non-canonical paths most prone to
mis-categorisation now ship a `displayUnits` hint so the data browser stops
converting them: precipitation depth renders in millimetres instead of miles,
and the 24-hour temperature departure renders as a Kelvin delta instead of an
absolute Fahrenheit temperature. This release also fixes three
latent bugs: severe-weather notification bands that could latch in an active
state when their driver reading was missing from a partial response, an
unguarded UV-index assignment, and a rolling-quota-window miscount after a
backward clock jump. There is no change to the delta envelope or the
notification value shape, and all 265 tests pass.

### Changed

- **Precipitation depth and 24h temperature departure carry a `displayUnits` meta hint.** The Signal K unit-preferences system categorises non-canonical paths by their SI base unit, so `environment.weather.precipitationLastHour` (`m`) was bucketed with distances and shown in miles, and `environment.weather.temperatureDeparture24h` (`K`) was treated as an absolute temperature and shown with the Kelvin-to-Fahrenheit offset applied. Both paths now pin a `displayUnits` conversion (millimetres and an identity Kelvin delta, respectively) so the data browser renders them correctly. The emitted values and `units` are unchanged.
- **The severe-weather notification rain suffix is sourced from `precipitationLastHour`.** A past-hour accumulation in millimetres equals an average rate in mm/h over that window, so the `"rain X mm/h"` message text is unchanged.

### Removed

- **`environment.weather.precipitationCurrent`.** AccuWeather's current-conditions response carries no instantaneous precipitation rate; this path was derived from the same past-hour accumulation as `precipitationLastHour` and converted to `m/s`, which both duplicated that path and collided with the speed category in the Signal K data browser. Consumers needing precipitation should read `environment.weather.precipitationLastHour` (liquid-equivalent depth over the past hour, in metres).

### Fixed

- **Severe-weather notification bands no longer latch when their driver reading is absent.** When a partial AccuWeather response omitted the wet-bulb-globe block (so `heatStressIndex` was undefined) or the visibility block, the heat and visibility evaluators returned early without driving their bands, leaving a previously active `warn`, `alarm`, or `emergency` notification stuck on the bus with no exit edge. All four scalar evaluators (wind, visibility, heat, cold) now clear their bands to `normal` when the driver reading is missing, matching the existing behaviour of the severe-condition path.
- **UV index is guarded against a non-numeric API value.** `transformWeatherData` assigned `uvIndex` directly from `UVIndexFloat` with no type check, and the response validator never probed that field, so a `null` from a partial response could reach `environment.weather.uvIndex`. The field is now decoded with the same `typeof` guard used for the other optional conditions, and is omitted when not a number.
- **The rolling 24h API-quota window survives a backward clock jump.** An NTP correction that moved the wall clock backward left the window's hour index stranded in the future, so subsequent requests landed in a stale bucket and aged out at the wrong time, which could falsely trip or falsely clear the quota-exhausted state. A backward jump now re-anchors the window's hour index to the corrected time.

<a id="v162"></a>

## [1.6.2] - 2026-05-21

Widens the emitted data set. Four AccuWeather condition-detail values the
plugin had not been publishing now reach Signal K on the producer-namespaced
`environment.weather.*` branch, and wind chill is split across both canonical
leaves: theoretical (computed from the true wind) and apparent (recomputed
against the apparent wind a moving vessel experiences). There is no change to
the delta envelope or the notification value shape, and all 259 tests pass.

### Added

- **Four condition-detail paths.** `environment.weather.pressureTendency` (barometric trend: -1 falling, 0 steady, +1 rising), `environment.weather.description` (plain-language condition summary), `environment.weather.precipitationType` (Rain / Snow / Ice / Mixed), and `environment.weather.visibilityObstruction` (fog, haze, smoke). Each carries information not already emitted and is omitted when AccuWeather does not supply it.
- **Theoretical wind chill.** `environment.outside.theoreticalWindChillTemperature` carries wind chill computed from the true, ground-referenced wind. `environment.outside.apparentWindChillTemperature` now carries a genuine apparent wind chill, recomputed against the apparent wind once the vessel's own motion is folded in; it falls back to the theoretical value when no vessel-motion data is available.

### Changed

- **`environment.weather.gustFactor` is omitted when the gust reading does not exceed the sustained wind speed.** A gust factor below 1 is not a gust factor; it reflects stale or inconsistent upstream samples rather than real gustiness.
- **Development dependencies updated to their latest releases** (Vitest 4.1.7, webpack 5.107.0, tsx 4.22.3, `@types/node` 25.9.1, lint-staged 17.0.5) and the `codecov/codecov-action` CI step bumped to v6.0.1. No runtime dependency changed.

### Removed

- **Unused validation code.** The exported `validateWeatherData` family, `isValidLatitude` / `isValidLongitude`, the internal `isValidWindDirection` helper, and the unreferenced `ERROR_CODES.SYSTEM.MEMORY_LIMIT` constant had no production caller and were removed.

<a id="v161"></a>

## [1.6.1] - 2026-05-19

Bug-fix release correcting twelve silent failures and pieces of incorrect
logic across the AccuWeather client, the orchestration layer, the
notification formatter, and the Admin UI config panel, plus follow-up
cleanup. There is no change to the delta envelope or the
notification value shape, and all 259 tests pass.

### Fixed

- **Partial AccuWeather responses no longer throw an untagged `TypeError`.** `validateAccuWeatherResponse` now checks the nested `Metric.Value` of Temperature, Pressure, DewPoint, and `Wind.Speed`, plus `Wind.Direction.Degrees` and a numeric `RelativeHumidity`, so a malformed response fails validation with a tagged error instead of crashing `transformWeatherData`.
- **Missing `CloudCover` is omitted instead of reported as 0.** A response without `CloudCover` previously coerced to a real-looking "clear sky" `environment.weather.cloudCover` of 0; the field is now absent when AccuWeather omits it.
- **A transient 403 no longer disables the plugin permanently.** Only a 401 (invalid key) stops the update timer; a 403, which can be a temporary IP block or plan glitch, surfaces an error but keeps retrying so it recovers on its own.
- **`calculateWindChill` propagates a non-finite input** instead of returning 0 K (absolute zero), a value that had passed downstream finite-value guards and could trip a false extreme-cold notification.
- **Wind direction is normalized into `[0, 2π)` on ingestion**, so an exact 360-degree reading no longer lands on a boundary the NMEA2000 range check rejects.
- **Notification message capping measures and truncates in the same unit** (Unicode code points), so a capped message can no longer exceed the 80-character ceiling.
- **The wind notification suffix reports a gust even when sustained wind is unavailable**, rather than dropping it on a comparison against a non-finite value.
- **The location-key cache uses one TTL** (the configured `locationCacheTimeout`) for both the read-path freshness check and the prune sweep, instead of disagreeing 1h versus 2h.
- **Config panel: the "Saving..." indicator appears during the save**, not after it has already completed.
- **Config panel: the form resyncs when the host supplies a new configuration object**, instead of keeping stale values after a save and restart.
- **Config panel: a save reports honestly when the plugin restart cannot be confirmed**, polling the status endpoint a few times and flagging an error rather than claiming success.

### Changed

- **Vitest test discovery no longer scans `.claude/` worktrees**, so a local test run reflects only the project's own suite.

<a id="v160"></a>

## [1.6.0] - 2026-05-16

Documentation reorganization plus codebase fixes spanning Signal K
compliance, weather science, and code quality, with follow-up cleanup.
The Admin UI config panel also gained collapsible sections. Several
consumer-visible path and value changes are listed under Changed; there is
no change to the delta envelope or the notification value shape. 272 tests
pass.

### Changed

- **Admin UI config panel sections collapse by default.** The panel opens as a compact Status summary; the API key, fetch-cadence, and notification sections each expand on click. The gap above the Status header was tightened so the panel sits flush under the host page heading, and the save-status message moved below the Save Configuration button so the button no longer shifts when the message appears.
- **Apparent wind moved off the canonical wind leaves.** The plugin's calculated apparent wind is no longer emitted on `environment.wind.speedApparent` / `angleApparent`; it now uses producer-namespaced `environment.weather.windSpeedApparent` and `environment.weather.windAngleApparent`. The value is doubly synthetic (AccuWeather regional ground wind plus vessel motion) and was squatting the canonical leaves a real masthead anemometer owns. The apparent-wind angle now references true heading rather than course over ground.
- **`environment.outside.heatIndexTemperature` now carries a computed NWS Rothfusz heat index** from air temperature and humidity, instead of AccuWeather RealFeel. RealFeel is a proprietary all-season index that can read below air temperature, which is physically impossible for a heat index. AccuWeather RealFeel is now published on `environment.weather.realFeel`.
- **Beaufort scale and the wind notification bands use sustained wind only**, per the WMO definition. A gust no longer inflates the reported Beaufort force or trips a gale / storm / hurricane alarm.
- **Heat-stress index bands tightened to the US military WBGT flag cutoffs** (26.7 / 27.8 / 29.4 / 32.2 C). Each band activates slightly earlier, a precautionary bias on a crew-safety index.
- **Resolved notifications clear with `method: []`** (was `['visual']`) so consumers drop the cue for a cleared hazard.
- **Fetch failures surface the underlying error immediately** rather than waiting for the 2x-staleness watchdog.
- **Documentation reorganized by audience.** Community files moved to `.github/`; reference and maintainer docs into `docs/` (`docs/decisions/`, `docs/maintainers/`). The README gained a What's New section, and the package description and keywords were tightened for the npm page.

### Fixed

- **The node-red source-exclusion guard now works.** It read a `source.label` object that `app.getSelfPath` never returns; it now matches the `$source` string, so the feedback-loop guard fires as intended.
- **`WindChillTemperature`, `RealFeelTemperature`, `Visibility`, and `Ceiling` are optional-chained.** A partial or lower-tier AccuWeather response missing one of these no longer throws a TypeError that aborts the whole fetch.
- **`errorCount` no longer double-counts** a scheduled-update failure.
- **`/api/test-key` failure messages are length-bounded and control-stripped** on the non-500 path, matching the 500 path.
- **Notification message truncation is code-point safe**, so a surrogate pair at the 80-character boundary is never split into a lone surrogate.

### Removed

- **Dead `WeatherData.quality` field** and its `calculateDataQuality` computation, which were never read by any consumer or banner.

<a id="v153"></a>

## [1.5.3] - 2026-05-16

Documentation and maintenance release. The README is restructured for a
cleaner npm and GitHub landing page, reference material moves into `docs/`,
and a full-codebase cleanup removes duplication. No behavioral
changes: all 275 tests pass and every `environment.*` / `notifications.*`
delta keeps the same shape.

### Changed

- **README restructured** from 245 to 129 lines so it reads as a landing page rather than a reference manual. The three Signal K path tables, the PGN table, and the two notification tables move into a new `docs/signal-k-paths.md`; the seven-entry troubleshooting catalog moves into a new `docs/troubleshooting.md`. A new Requirements section surfaces the Signal K server version, AccuWeather key, and GPS-position prerequisites. The data-flow diagram moves into `DEVELOPMENT.md`.
- **Codebase cleanup.** Behavior-preserving dedup: `SignalKService.getVesselNavigationData` delegates to `getCachedNavigationData` instead of duplicating the navigation-data assembly; `WeatherNotifier` gains a shared `evaluateDescendingBands` with `VISIBILITY_BANDS` / `COLD_BANDS` tables, replacing the copy-pasted visibility/cold evaluators; `validation.ts` numeric-config validators collapse into one `NUMERIC_CONFIG_RULES` table and the field validators share a `requireFiniteField` guard; `WeatherService.formatStatusBanner` reads the rolling 24h request count once per build; the federated panel's `doSave` routes through `fetchStatus`. Gas constants and standard air density in `conversions.ts` are now named module constants.

### Removed

- **Dead code.** `NMEA2000PathMapper.countEnhancedFields` and its 19-entry `ENHANCED_PATHS` set, which ran on every emission tick only to feed a debug-log counter.
- **Stale docs.** `docs/app-store-status.md` (a Signal K App Store verification snapshot pinned to v1.3.2) and `TODO.md` (mostly completed checkboxes duplicating this changelog).

<a id="v152"></a>

## [1.5.2] - 2026-05-12

Maintenance release rolling up code consolidation, Signal K path
corrections, error-handling and safety hardening, and notification-message
enrichment. No breaking changes; existing `notifications.environment.*`
deltas now carry richer `message` text but the same value shape. 275 tests
pass (was 267; 8 new for the enriched messages in `WeatherNotifier.test.ts`).

### Added

- **Enriched notification messages.** Each `notifications.environment.*` band's `message` field now packs adjacent readings the operator can act on without subscribing to extra paths. Wind: `Gale-force wind: Bf9 from SW, 19 m/s, gusts 27 m/s, 998 hPa`. Visibility: `Reduced visibility: 0.8 km, ceiling 90 m, rain 2.5 mm/h`. Heat: `High heat stress: HSI 3, WBGT 32 C, RH 78%, RealFeel 35 C`. Cold: `Cold exposure caution: wind chill -2 C, air 1 C, wind 12 m/s`. Severe: `Thunderstorms: Severe thunderstorms approaching, 998 hPa`. Optional segments drop out cleanly when AccuWeather doesn't provide them (free-tier responses without a WindGust block omit `gusts ...`; calm winds where gust <= sustained likewise suppress it). Every message is capped at `MAX_MESSAGE_LENGTH = 80` chars (with `…` truncation on overflow) so it renders across the chartplotter fleet bridged via `signalk-to-nmea2000` to NMEA 2000 Alert PGN 126985 (Garmin GMI ~32, Raymarine ~80, B&G Zeus ~80, Furuno ~64). Wind direction renders as a 16-point cardinal label.
- **Notification meta**. `NMEA2000PathMapper.buildMetaDelta()` now also ships meta entries for every `notifications.environment.*` path (displayName + description for each of the 11 bands) so plotters render the alert with a human label rather than the bare path.
- **Shared config defaults module.** `src/constants/notifications-shared.js` now also exports `CONFIG_DEFAULTS` (UPDATE_FREQUENCY, EMISSION_INTERVAL, DAILY_API_QUOTA plus their min/max bounds) and `API_KEY_MIN_LENGTH`. The rjsf schema in `src/index.ts`, the runtime sanitiser in `src/utils/validation.ts`, and the federated React panel all import from one source: numeric defaults and the 20-char API-key floor can no longer drift between code paths.
- **`isFiniteNumber` type guard** in `WeatherNotifier.ts` collapses the repeated `value !== undefined && Number.isFinite(value)` pattern.

### Changed

- **Safety: bad API keys stop the update timer.** A 401/403 from AccuWeather inside `WeatherService.updateWeatherData` now flags the key rejected, clears the periodic-update timer, and trips `setPluginError("AccuWeather rejected the configured API key. Update the key in plugin settings: ...")`. Previously the plugin retried every `updateFrequency` minutes against a known-bad key, burning the daily quota before any actionable error surfaced. (HIGH)
- **Safety: consecutive-failure escalation.** Three consecutive non-auth fetch failures now trip `setPluginError("Weather updates failing (N consecutive): ...")` so operators see the underlying error before the 2x-staleness watchdog kicks in at twice the `updateFrequency`. (HIGH)
- **Safety: mapper errors drop the cached delta.** A throw inside `mapToSignalKPaths` (during `emitWeatherTick`) now clears `instance.cachedDelta` and publishes an error banner instead of continuing to emit stale data with a fresh emission timestamp. (HIGH)
- **AccuWeather request-count timing.** `requestCount` and the rolling-24h-window bucket no longer increment until after `fetch()` returns a response. Network timeouts and connection refusals no longer count against the operator's daily quota. (MED)
- **`/api/test-key` rate limit.** The federated panel's key-test endpoint now caps at 10 requests per rolling 60 s with a 429 on overflow, and 500 responses go through a length-bounded sanitiser that strips control chars. Prevents a LAN-side client from draining the quota with `curl POST` floods. (MED)
- **`capString` truncation is now code-point safe.** AccuWeather descriptions with emoji or CJK supplementary characters at the truncation boundary no longer leave a lone surrogate that would break JSON-encoded downstream consumers. (LOW)
- **`environment.weather.gustFactor` meta:** dropped `units: 'ratio'` because the value routinely exceeds 1 (gust > sustained); strict consumers that clamp ratio paths to [0, 1] for percent-style rendering would mis-render values above 1. Now follows the same convention as `uvIndex`, `beaufortScale`, `heatStressIndex` (no `units`, dimensionless).
- **`environment.weather.temperatureDeparture24h` meta description** now explicitly states the value is a temperature DELTA (not absolute K) and warns consumers against applying a K-to-C subtraction.
- **`sanitizeConfiguration` uses `??` consistently** for `updateFrequency` / `emissionInterval` (was `||`), so an explicit 0 cannot be silently coerced to the default. The lower-bound clamp at 1 still rejects sub-min values.
- **`NUMERIC_FIELD_RULES` covers every emitted numeric leaf.** Added rows for `absoluteHumidity`, `airDensityEnhanced`, `windGustFactor`, and `temperatureDeparture24h` so the mapper's "every emitted leaf is sanitized" docstring claim is now literally true. The four bounds are wide enough never to clamp a meteorologically plausible value but tight enough to catch obvious numerical garbage. Angle fields (`windDirection`, `apparentWindAngle`) remain handled inline via wrap-around normalization, and the rule-table docstring now says so explicitly.
- **`WeatherServiceStatus` uses `ReturnType<>`.** The nested `signalKHealth` and `cacheStats` shapes are derived from the underlying service methods so the public contract tracks the service signatures automatically.
- **Federated panel: visibility-aware polling.** `/api/status` polling pauses when `document.visibilityState !== 'visible'` and resumes immediately on `visibilitychange`. Saves CPU on multi-tab admin UIs.
- **Federated panel: save verification.** `doSave` now re-fetches `/api/status` after the host's save callback resolves and only reports success when `running === true`. A silent server-side save failure no longer produces a green "Saved" banner.
- **JSON parse errors on AccuWeather error bodies** now log at `warn` (was `debug`), so malformed-body cases surface without enabling DEBUG.
- **Notification severe-exit message is empty.** When the icon falls outside the severity table the bus sees `state: 'normal'` with an empty `message` instead of the literal phrase `"No severe weather"`, which downstream parsers were treating as a real condition.

### Refactored

- **Consolidation sweep.** Consolidated `TWO_PI` to a single export from `src/utils/conversions.ts`; added `msToWholeMinutes` and used it at 3 sites (was three inline `Math.floor(ms / 60_000)`); replaced inline range checks in `src/utils/validation.ts` with the existing `isValidTemperature` / `isValidPressure` / `isValidHumidity` / `isValidWindSpeed` / `isValidWindDirection` predicates from `conversions.ts`; refactored `WeatherService.formatStatusBanner` to build segments via `string[]` + `join(', ')` (regex strip on the leading separator is gone); flattened `BEAUFORT_THRESHOLDS` to a `readonly number[]` indexed by Beaufort number; lazy-ified the wall-clock timestamp and per-band message strings in `WeatherNotifier` so steady-state evaluations allocate nothing; dropped redundant 2nd params from the 5 `format*Suffix` helpers; replaced the file-local `ratioToPercent` with `Math.round(ratioToPercentage(...))` from conversions.ts; routed `paToHpa` through `UNITS.PRESSURE.MILLIBAR_TO_PASCAL` instead of a bare 100.

### Docs

- **README, CLAUDE.md**: new notification-message sample table; the 80-char cap and the chartplotter rationale are documented; per-band fields list.
- **DEVELOPMENT.md**: bundle size, Build Outputs (incl. the federated panel `public/`), Project Structure (now includes `configpanel/`, `notifications/`, `examples/`, `docs/`, `public/`, `webpack.config.cjs`), corrected SK-compliance row that previously claimed all log levels go through `app.debug` (warn/error actually go through `app.error`), refreshed Test Structure block.
- **CONTRIBUTING.md, RELEASE.md**: `master` to `main` (default branch renamed 2026-05-12 was unreflected); added `configpanel/` and `notifications/` to file-organisation.
- **SECURITY.md**: supported versions 1.4.x to 1.5.x.
- **docs/manual-server-test.md**: default `updateFrequency` 5 to 30; auth-rejection banner text matches the new "AccuWeather rejected the configured API key" escalation.
- **docs/app-store-status.md**: noted that the snapshot is pinned to 1.3.2; current latest is 1.5.x.
- **`.github/pull_request_template.md`**: redirected the broken compliance-checklist anchor to `DEVELOPMENT.md#-signal-k-standards-compliance`.
- **CLAUDE.md spec-compliance bullet**: "once per plugin lifetime" tightened to "once per start() cycle".

### Dependencies

- Dev-deps bumped: `@types/node` ^25.6.2 to ^25.7.0, `@vitest/coverage-v8` / `@vitest/ui` / `vitest` ^4.0.17 to ^4.1.6, `react` ^19.2.4 to ^19.2.6, `webpack` ^5.105.4 to ^5.106.2. No prod dep changes. `npm audit` clean.

### Repo hygiene

- `.remember/` added to root `.gitignore` (the redundant `.remember/.gitignore` containing `*` was removed).

<a id="v151"></a>

## [1.5.1] - 2026-05-12

Critical fix for the v1.5.0 federated config panel, plus follow-up refinements. Operators on v1.5.0 saw a silent `Could not load module signalk-virtual-weather-sensors` in the admin UI console with the panel never rendering: the panel chunks all served 200 OK but the Module Federation library type was wrong for an ESM package. Plus a UX rename, a deduplication of label strings between the panel and the schema, and a typed `/api/status` payload. 267 tests pass (was 266; 1 new for the long-key-rejected path through `/api/test-key`).

### Fixed

- **Federated panel failed to load in Signal K Admin UI v2.27+** (the version that ships with current `signalk-server`). The root cause is a three-way interaction: `package.json` declares `"type": "module"`, which makes `signalk-server` inject the panel as `<script type="module" src=".../remoteEntry.js"></script>` (see `signalk-server/src/serverroutes.ts` ~line 265); the admin UI loader then does `await import(remoteEntryUrl)` and looks for `.get` / `.init` ESM exports (`@signalk/server-admin-ui/src/views/Webapps/dynamicutilities.ts:toLazyDynamicComponent`). Our v1.5.0 webpack used `library: { type: 'var', name: ... }`, which assigns to `window.signalk_virtual_weather_sensors` via a classic script and exports nothing via ESM. The import therefore resolved to an empty module and the loader logged `Could not load module signalk-virtual-weather-sensors`. Fix: switch webpack to `experiments.outputModule: true`, `output.module: true`, `output.chunkFormat: 'module'`, and `library: { type: 'module' }`. `remoteEntry.js` now ends with `export { ... as get, ... as init }`. Panel chunk filenames change from `.js` to `.mjs`. The sibling plugin `signalk-openrouter-companion` already hit this issue and uses the same configuration. (HIGH)

### Changed

- **Master notifications toggle renamed** from `Enable notifications` to `Enable PGN notifications` in both the panel JSX (`src/configpanel/PluginConfigurationPanel.jsx`) and the rjsf schema title (`src/index.ts`), so older admin UIs that fall back to the auto-generated form see the same wording.
- **Removed the help paragraph under the master notifications toggle** in the panel JSX. The paragraph was floating out to the right at the field-row indent (designed for input rows, not checkbox rows) and looked disconnected. The bridge-PGN-dependency caveat survives in the schema-level `description` field on the `notifications` object for rjsf-fallback consumers, and in the project README + CLAUDE.md for documentation consumers.
- **Notification labels and defaults extracted to a shared module** (`src/constants/notifications-shared.js` + `.d.ts` shim). The TS plugin runtime (schema titles in `src/index.ts`, `DEFAULT_CONFIG.NOTIFICATIONS` defaults in `src/constants/index.ts`) and the JSX panel both import from one source. Labels and defaults can no longer drift between the federated panel and the rjsf fallback form. Plain ESM JS so the JSX webpack bundle resolves it cleanly under `@babel/preset-react`; co-located `.d.ts` declares the types for TypeScript consumers under `allowJs: false` + NodeNext resolution.
- **`PanelStatusResponse` interface** added to `src/types/index.ts`. The `/api/status` route handler builds its payload as `const payload: PanelStatusResponse = {...}`, so a typo on the producer side fails compile-time instead of silently shipping a mismatched field name to the panel.
- **`TEST_KEY_LOCATION` constant moved** from the bottom of `src/index.ts` to `src/constants/index.ts` alongside the other AccuWeather constants. Single import site in `index.ts`.
- **Panel state pairs consolidated**: `testKeyState` + `testKeyMessage` collapsed into one `testKey: { state, message }` object, and `actionStatus` + `actionError` into `action: { message, isError }`. Same render output, but the paired setters can no longer drift between `setTestKeyState('ok')` and a forgotten `setTestKeyMessage` update.
- **`POST /api/test-key` handler converted to `async`** so test code can await the full round-trip instead of polling `res.json.mock.calls`.

### Tests

- New test in `src/__tests__/index.test.ts` covers the long-but-AccuWeather-rejected key path: stubs `global.fetch` with a 401 response, fires `POST /api/test-key` with a 20+ char key, asserts `{ok: false, message: /API_UNAUTHORIZED/}` and `body.status === undefined` (the route returns 200 with the diagnostic message; only the length guard uses 400). `index.test.ts` now carries 11 tests; total project count is 267 across 11 test files.

### Notes for operators on v1.5.0

- The published v1.5.0 npm bundle has the broken panel. The plugin runtime works correctly on v1.5.0 (deltas emit normally, REST endpoints respond, JSON schema fallback renders for admin UIs older than 2.13), but the federated config panel never shows for admin UI v2.13+. Upgrading to v1.5.1 is recommended.

<a id="v150"></a>

## [1.5.0] - 2026-05-12

Adds a federated React config panel: when the Signal K Admin UI v2.13+ sees the new `signalk-plugin-configurator` keyword it loads the panel via Module Federation in place of the auto-generated rjsf form. The existing JSON schema is preserved as a fallback for older admin UIs. 266 tests pass (was 263; 3 new for the panel's REST endpoints).

### Added

- **React config panel** under `src/configpanel/`, bundled by webpack via `ModuleFederationPlugin` into `public/remoteEntry.js` (~40 KB total across 4 chunks: `main.js`, `remoteEntry.js`, a React-fallback chunk, and the panel chunk). React 19 is declared `singleton` so the panel shares the host admin UI's React instance. Plain JSX, no TypeScript, no CSS framework: styles live in one inline `S = {}` object mirroring the `signalk-questdb` plugin's pattern.
- **Panel features**: live status card with banner string and four counter tiles (updates / 24h API calls / active alerts / minutes since last fetch), inline "Test" button on the API key field that probes AccuWeather without persisting, sectioned form for the 5 existing config fields (api key, update frequency, broadcast interval, daily quota, severe-weather notifications), dependency-aware notifications block (sub-toggles dim when the master is off).
- **`registerWithRouter` REST endpoints** at `/plugins/signalk-virtual-weather-sensors/api/`:
  - `GET /api/status`: returns running state, live banner, update count, rolling 24h API count, minutes since last fetch, active-notification count. Polled by the panel every 10 s.
  - `POST /api/test-key`: takes `{apiKey}` in the body, runs one AccuWeather location-search call against a fixed reference point (Greenwich Royal Observatory), returns `{ok, message}`. Costs exactly one AccuWeather API call per test, half what a full currentconditions probe would.
- **`signalk-plugin-configurator` keyword** in `package.json` triggers the Signal K Admin UI to load the federated panel.
- **`AccuWeatherService.verifyApiKey(location)`** public method: thin wrapper around the internal `searchLocation` so the panel's test-key endpoint exercises the auth path with a single API call. Exported alongside `API_KEY_MIN_LENGTH` from `utils/validation.ts` so the panel route and the configuration validator agree on the 20-character floor.
- **`WeatherService.getRequestCountLast24h()`** and **`WeatherNotifier.getActiveCount()`** accessors for the panel's status endpoint.

### Changed

- **Build pipeline**: `npm run build` now does `clean` then types then esbuild bundle then webpack panel. esbuild still produces the plugin runtime; webpack only produces the panel into `public/`. Two build systems by design, mirroring the QuestDB plugin's approach.
- **Tarball additions**: `public/` joins `dist/` + `assets/icons/` in the `files` array. Tarball size grows from roughly 78 KB to roughly 120 KB.
- **devDependencies**: added `react`, `webpack`, `webpack-cli`, `babel-loader`, `@babel/core`, `@babel/preset-react`, `@types/express`.
- **`webpack.config.cjs`** (not `.js`): our `package.json` declares `"type": "module"` so the webpack config has to be CommonJS-flagged. The QuestDB plugin doesn't hit this because they aren't ESM at the package level.

### Notes for consumers

- **No breaking changes for existing installations.** Operators on older Signal K Admin UIs that don't honour `signalk-plugin-configurator` will continue to see the JSON-schema-rendered form (functionally identical to v1.4.x).
- **The panel is React 19 singleton-shared.** If the Signal K Admin UI host upgrades to React 20, a matching plugin bump will be needed or the panel will fall back to its bundled React copy (still works, slightly bigger payload).
- **Bridging notifications to NMEA 2000 Alert PGNs (126983/126985)** still requires the separate `signalk-to-nmea2000` plugin. The panel does not change this.

<a id="v144"></a>

## [1.4.4] - 2026-05-12

Maintenance release. Dev-deps and CI-action bumps only: the published `dist/` is byte-identical to 1.4.3 (no source code changed). Plugin behaviour, public API, and Signal K paths are unchanged.

### Changed

- `github/codeql-action` bumped from v3 to v4 in `.github/workflows/codeql.yml` (PR #9). v3 was end-of-lifed; CodeQL Default Setup was disabled in the repo settings at the same time to resolve a long-standing "advanced configurations cannot be processed when the default setup is enabled" SARIF-upload failure on every CodeQL run. Every CodeQL run on `main` is green from this release forward.
- Dev-deps bumped via the Dependabot dev-deps group (PR #8): `@types/node` 25.6.2 to 25.7.0, `vitest` / `@vitest/coverage-v8` / `@vitest/ui` 4.1.5 to 4.1.6. The Vitest 4.1.6 release notes flag a deprecation of the `sequential` test API and one browser-test fix; neither surface is in use by this plugin's 263 tests.

<a id="v143"></a>

## [1.4.3] - 2026-05-12

Opt-in severe-weather notifications under `notifications.environment.*` plus a cluster of bug fixes. 263 tests pass (was 242; 21 net new: 19 in WeatherNotifier.test.ts and 2 in index.test.ts for the stale/quota emission-tick branches).

### Added

- **Severe-weather notifications**, opt-in (off by default), under `notifications.environment.*` per Signal K 1.8.2. Eleven distinct paths so consumers that cache by path+id (Garmin plotters, the `signalk-to-nmea2000` Alert PGN bridge) see independent transitions rather than one rising/falling state ladder:
  - `notifications.environment.wind.gale` (warn at Beaufort 8), `.storm` (alarm at Beaufort 10), `.hurricane` (emergency at Beaufort 12)
  - `notifications.environment.visibility.low` (warn under 1 nm), `.veryLow` (alarm under 0.5 nm)
  - `notifications.environment.heat.caution` (warn at heat-stress index 2), `.high` (alarm at 3), `.extreme` (emergency at 4)
  - `notifications.environment.cold.caution` (warn at wind chill below 0 C), `.extreme` (alarm below -20 C)
  - `notifications.environment.weather.severe` (state varies by AccuWeather `WeatherIcon`: thunderstorm / ice / sleet / freezing rain / snow). Bridges to NMEA 2000 Alert PGNs 126983 / 126985 only when `signalk-to-nmea2000` is also installed on the server; this plugin produces SK-native deltas.
- `notifications` config subobject in the admin form schema with master `enabled` toggle plus per-category sub-toggles (`wind`, `visibility`, `heat`, `cold`, `weather`). The notifier is a pure transition emitter (Map of last-seen states), so steady-state ticks do not flap the bus.
- `WeatherIcon` (1..44) now flows from the AccuWeather response onto `WeatherData.weatherIcon` so the notifier classifies severe conditions without re-parsing the upstream payload.

### Fixed

- **Banner flap on flapping API.** `setPluginStatus` / `setPluginError` calls in `emitWeatherTick` and the lifecycle handlers now route through a single `setBanner()` helper that dedupes consecutive identical `(kind, message)` pairs. A persistent quota-exhausted state or oscillating stale/recovery edges no longer rewrites the admin UI banner every 5 seconds: each unique message lands exactly once. (MED)
- **`WindGust` block was non-optional in the type and unguarded in `transformWeatherData`.** Free-tier and partial AccuWeather responses occasionally omit `WindGust` entirely; the previous code threw a `TypeError` that propagated into `errorCount` and flapped the banner. `AccuWeatherCurrentConditions.WindGust` is now optional, `transformWeatherData` optional-chains `WindGust?.Speed?.Metric?.Value`, `WeatherData.windGustSpeed` is conditionally spread, and `calculateDataQuality` no longer dereferences a missing block. (MED)
- **Cold-start banner showed `Running, awaiting first update` for up to one emission interval past the first successful fetch.** `WeatherService.updateWeatherData` now pushes the live banner directly on the first successful update, so the `last update Nm ago` string lands the moment data arrives instead of waiting for the next 5-second emission tick. (LOW)

### Changed

- **Reuse: shared `SELF_CONTEXT`, `ACCUWEATHER_SOURCE`, `pv`, `me`, `buildValuesDelta`, `buildMetaDelta` lifted into `src/utils/skDelta.ts`.** Mapper and plugin entry point now build deltas through the same call sites instead of hand-rolling the `{ context, updates: [{ $source, timestamp, ... }] }` envelope. The notifier consumes `pv()` too. Eliminates three duplicate definitions of the `vessels.self` literal and the branded-type casts.
- `AccuWeatherCurrentConditions` type stripped to the fields the plugin actually consumes. Dropped 10 cosmetic fields (`HasPrecipitation`, `PrecipitationType`, `IsDayTime`, `IndoorRelativeHumidity`, `PressureTendency`, `UVIndexText`, `ObstructionsToVisibility`, `TemperatureSummary`, `MobileLink`, `Link`) and the no-longer-used `AcwTempRange` helper type. The test fixture in `setup.ts` was tightened to match.

### Tests

- New `src/__tests__/notifications/WeatherNotifier.test.ts` (19 tests): master enable / disable, no-leading-`normal` on first evaluation, entry / exit edges across each band, idempotent re-evaluation of unchanged snapshots, per-category toggles, severity mapping for `WeatherIcon` 15 / 24 / off-table, SK 1.8.2 value-shape conformance (`state`, `method`, `message`, `timestamp`), and `reset()` semantics.
- Two new emission-tick tests in `src/__tests__/index.test.ts`: stale-data branch (age past `STALENESS_FACTOR * updateFrequency` produces one `setPluginError` with the dedupe-collapsed `Weather data stale` message), quota-exhausted branch (`setPluginError` carries the quota message and takes precedence over staleness).
- Test count: 263 across 11 files.

<a id="v142"></a>

## [1.4.2] - 2026-05-11

A UI-focused fix batch covering the admin form, status banner, meta delta, and App Store presentation, followed by full-codebase fixes across the runtime, supporting modules, tests, and docs and build. Adds a coordinated plugin icon family across the `@NearlCrews` Signal K plugin set. 242 tests pass (was 235; 7 net new tests across banner grammar, quota messaging, `validateDailyApiQuota`, and calculator non-finite paths).

### Fixed

- **`sanitizeForNMEA2000` only clamped 6 of ~22 emitted leaves.** The mapper's "every emitted leaf is sanitized" contract was false. Extended via a single-source `NUMERIC_FIELD_RULES` table now driving both `isWithinNMEA2000Ranges` and the clamping pass (temperatures, apparent-wind speed/angle normalization, visibility, cloud cover/ceiling, beaufort, heat-stress index, precipitation hourly + rate caps in raw mm units before unit conversion). New emitted fields require a matching row; the mapper docstring carries this invariant. (HIGH)
- **Banner refresh was clobbering the quota-exhausted error every 5 seconds.** The unconditional `setPluginStatus(formatStatusBanner())` added in the v1.4.1 banner-refresh fix overwrote any active `setPluginError`, including the "quota reached, fetches paused" message. `emitWeatherTick` now gates the recovery refresh behind `isQuotaExhausted()` and re-pushes the quota error instead of clobbering it. Stale-data recovery still works as before. (HIGH)
- **Default `updateFrequency` was 5 minutes, producing 288 calls/day vs the default 50/day quota cap, so every fresh free-tier install tripped its own `setPluginError` on day one.** Default raised to 30 minutes (48/day, comfortably under the cap). `STALENESS_FACTOR` doc comment updated for the new 60-minute staleness window. Operators who want faster updates can lower the cadence and raise `dailyApiQuota` (or set it to 0 to disable). (HIGH)
- Banner grammar: `1 update` instead of `1 updates`, `1 API request` instead of `1 API requests`. Stale-data error: `1 minute ago` instead of `1 minutes ago`, and the age uses `Math.floor` so a delta only 31 seconds past threshold no longer shows "1m ago". (MED)
- Quota-exhausted `setPluginError` message rewritten to be operator-actionable: explicitly tells the operator how to resume (raise `dailyApiQuota` or `updateFrequency`). Hoisted to public `formatQuotaExhaustedMessage()` for testability. (MED)
- Stale `signalk-virtual-weather-sensors stop failed:` / `startup failed:` prefixes trimmed to `Stop failed:` / `Startup failed:`. The admin UI plugin list already prefixes banner text with the plugin's display name, so the package-name repeat was redundant. (LOW)

### Changed

- **`signalk.displayName` and `PLUGIN.DISPLAY_NAME`** trimmed from `Signal K Virtual Weather Sensors` to `Virtual Weather Sensors`. The admin UI is already Signal K's, so the prefix was duplicative; matches sibling plugin convention (`signalk-questdb` ships `QuestDB History`). (HIGH, cosmetic)
- Admin form schema types: `updateFrequency`, `emissionInterval`, `dailyApiQuota` retyped `number` → `integer` so the updown widget cannot submit fractional values. Runtime validation already tolerated floats, so legacy stored configs are unaffected. Titles now embed units inline (`(minutes)`, `(seconds)`), descriptions tightened. uiSchema gained `ui:autocomplete: 'off'` + placeholder on the API-key field and `ui:help` text on each numeric field explaining the quota interaction. (MED + LOW)
- Meta delta: heat-stress index 0..4 scale now spells out the WBGT thresholds (<27, 27..29, 29..31, 31..33, >=33 °C) and category labels (low / moderate / high / very high / extreme). 12 producer-namespaced paths gained meaningful `description` fields (RealFeel vs canonical wind chill, wet bulb vs WBGT, apparent temperature, absolute humidity, visibility, cloud cover, cloud ceiling, precipitation last hour vs rate, 24h temp departure sign convention, wind gust). Two `displayName` strings shortened (`Wet bulb globe temperature` → `Wet bulb globe temp`, `24h temperature departure` → `24h temp departure`) to dodge Instrument Panel row truncation. (MED + LOW)
- Examples updated for the new default: `sailboat.json` `updateFrequency` 5 → 30, `slow-update.json` 15 → 60. `examples/README.md` settings reference reconciled.

### Removed

- Dead `PLUGIN.STATUS.SERVICE_RUNNING` / `SERVICE_STOPPED` constants and their `setPluginStatus` writes in `WeatherService.start()` / `stop()`: both were overwritten on the same event-loop turn by `finalizePluginStart` and `stop()`. The dead `staleErrorActive` field on `PluginInstance` also dropped (set but never read). (LOW)

### Docs

- README Configuration table reflects the new 30-minute default and notes the 48 calls/day fit under the free-tier 50/day cap.
- README Troubleshooting headings updated to match the post-edit banner strings verbatim so operators can grep their admin UI banner straight into the README.
- README UV index and heat-stress rows now ship the legend inline (`0..2 low / 3..5 moderate / 6..7 high / 8..10 very high / 11+ extreme` for UV; the WBGT band table for heat stress).
- DEVELOPMENT.md test count refreshed (235 → 238, WeatherService.test.ts 25 → 28).

### Added

- Plugin icon. 512x512 SVG source at `assets/icons/icon.svg` rasterized via `librsvg2-bin` to PNGs at 72/96/192/512. Joins a coordinated icon family across `@NearlCrews` Signal K plugins (`signalk-nmea2000-emitter-cannon`, `signalk-openrouter-companion`): rounded-square ocean gradient + three stacked wave lines as the family motif, with a bottom-right circular badge varying per plugin. This variant's badge is warm yellow with a dark cloud silhouette. `package.json` gains `signalk.appIcon: "./assets/icons/icon-192.png"` and the `files` array now includes `assets/icons/` so the PNGs ship in the tarball. Closes the long-standing missing-icon gap.

### Follow-through

After the UI fixes and icon work landed, a second cleanup cycle followed. Notable lower-severity outcomes folded in here for traceability:

- Lifecycle: `isPluginAlreadyRunning` now also blocks a concurrent `start()` while a prior `stop()` is awaiting cleanup. `SignalKService` no longer silently maps `dataAge: 0` to `undefined` (`||` to explicit null-check). `setupEnhancedEmissionSystem` now consumes `PLUGIN.STALENESS_FACTOR` instead of an inline `2 *`, eliminating the magic-number-vs-doc drift.
- Schema: outer `title` + `required` removed from `schema()`. The Signal K admin UI's rjsf wrapper discards both; enforcement is the field-level `minLength: 20` plus `ConfigurationValidator`. Schema docblock records the rationale.
- Wind math: `calculateApparentWindWithCompleteData` collapsed two separate calculator calls into one shared trig computation via `calculateWindAnalysis`, halving the per-update arithmetic.
- Dead-code sweep: `PLUGIN.AUTHOR`, `DEFAULT_CONFIG.ENABLE_EVENT_DRIVEN` / `USE_VESSEL_POSITION`, three unused `UNITS` factors (inches-Hg, atm, mph), three unused `VALIDATION_LIMITS` (`COURSE_TRUE`, `VESSEL_DATA_WARN_AGE`, `VESSEL_DATA_ERROR_AGE`), and the unreachable Rothfusz low-humidity branch in `calculateHeatIndex` (gated at HEAT_INDEX_MIN_HUMIDITY_PCT=40).
- Validation: `isValidLatitude` / `isValidLongitude` composed via `isWithinBounds` instead of inlining `Number.isFinite + bounds`. `validateUpdateFrequency` / `validateEmissionInterval` warn-over-error rationale documented (resolving the schema-vs-runtime drift question).
- Tests: 6 net new tests (`validateDailyApiQuota` 4 cases, calculator non-finite paths 2 cases); two flaky wall-clock perf tests removed (false negatives on slow CI without proving anything determinism tests do not); `AccuWeatherService.test.ts` switched its module-scope `global.fetch = vi.fn()` to `vi.stubGlobal` + `vi.unstubAllGlobals`; local `mockResponse` factory replaced with shared `createMockFetchResponse` from `setup.ts`.
- Docs/build: TODO.md P1 items marked shipped; `RELEASE.md` gained a "Fast path (what we actually do)" section describing the master-commit + GH-Release-fires-publish.yml flow used for 1.4.1; stale `stryker.conf.json` checker comment rewritten; `publish.yml` workflow_dispatch example tag refreshed to v1.4.2.
- Comment cleanup: trimmed comment proliferation (six WHAT-narrative lines in `cleanup()` / `validateAndNormalizeSettings()` removed, verbose constant explainers shortened, fragile cross-file pointer dropped, multi-paragraph quota-vs-staleness ordering note tightened, dead-code tense fix on `WindCalculator`, rolling-window rotation comment now states actual `O(min(elapsed, 24))` cost instead of an implicit `O(1)` claim).
- Test count: 242 across 10 files. Coverage 86.74 statements / 82.36 branches / 93.78 functions / 86.86 lines, all above the 80% floor.

<a id="v141"></a>

## [1.4.1] - 2026-05-11

Signal K 1.8.2 spec-compliance release plus a follow-through cycle. **Includes Signal K path renames that change the wire output**: every non-1.8.2 leaf this plugin previously emitted under `environment.outside.*` or `environment.wind.*` now lives under a new producer-namespaced `environment.weather.*` branch. Consumers reading the previous path strings must update. Beyond the spec pass, this release adds an opt-in daily-quota visibility surface, a banner-refresh fix, mutation-testing infrastructure (67.44% score on the pure-function modules), end-to-end and schema-conformance test suites, four operator-facing documentation spikes, and a routine GitHub Actions + dev-deps refresh.

> **Note on the version skip:** 1.4.0 was published to npm from an earlier internal upload on 2025-10-13 and does not match the spec-compliance work described below. The 1.4.0 slot is therefore unusable for this release, and 1.4.1 is the first npm release of the spec-compliance codebase. There is no 1.4.0 → 1.4.1 changelog (this is the spec-compliance release content, re-numbered).

### Changed -- Signal K paths (BREAKING)

The 1.8.2 vocabulary defines `environment.outside` and `environment.wind` as leaf-only containers. The previous layout squatted an object node `derived` under each (`environment.wind.derived.beaufortScale`, `environment.outside.derived.heatStressIndex`), and emitted multiple AccuWeather extensions as if they were canonical leaves (`environment.outside.uvIndex`, `environment.outside.absoluteHumidity`, etc.). Both patterns put non-vocab content under canonical containers, breaking consumers that walk those containers expecting only spec leaves.

Everything outside the 1.8.2 vocabulary now lives under `environment.weather.*` (flat, no further nesting). Source provenance stays in `$source`, not in the path. Old → new path mapping:

| Old (1.3.x) | New (1.4.0) |
|-------------|-------------|
| `environment.outside.realFeelShade` | `environment.weather.realFeelShade` |
| `environment.outside.wetBulbTemperature` | `environment.weather.wetBulbTemperature` |
| `environment.outside.wetBulbGlobeTemperature` | `environment.weather.wetBulbGlobeTemperature` |
| `environment.outside.apparentTemperature` | `environment.weather.apparentTemperature` |
| `environment.outside.absoluteHumidity` | `environment.weather.absoluteHumidity` |
| `environment.outside.uvIndex` | `environment.weather.uvIndex` |
| `environment.outside.visibility` | `environment.weather.visibility` |
| `environment.outside.cloudCover` | `environment.weather.cloudCover` |
| `environment.outside.cloudCeiling` | `environment.weather.cloudCeiling` |
| `environment.outside.precipitationLastHour` | `environment.weather.precipitationLastHour` |
| `environment.outside.precipitationCurrent` | `environment.weather.precipitationCurrent` |
| `environment.outside.temperatureDeparture24h` | `environment.weather.temperatureDeparture24h` |
| `environment.outside.derived.heatStressIndex` | `environment.weather.heatStressIndex` |
| `environment.wind.speedGust` | `environment.weather.speedGust` |
| `environment.wind.derived.gustFactor` | `environment.weather.gustFactor` |
| `environment.wind.derived.beaufortScale` | `environment.weather.beaufortScale` |

Canonical `environment.outside.*` (temperature, pressure, relativeHumidity, dewPointTemperature, apparentWindChillTemperature, heatIndexTemperature) and `environment.wind.*` (speedOverGround, directionTrue, speedApparent, angleApparent) leaves are unchanged. The one-shot meta delta now describes the new `environment.weather.*` paths.

### Added

- Daily AccuWeather API quota visibility. New `dailyApiQuota` setting (default 50, range 0 to 1000, 0 disables) caps requests per rolling 24-hour window. `AccuWeatherService.getRequestCountLast24h()` is backed by 24 one-hour buckets that rotate as time advances, so memory stays constant. The status banner gains a `, K/Q today` segment when the cap is enabled, switches to a `Running [quota 90% used]` prefix at 90% usage, and at 100% `WeatherService.updateWeatherData` skips the fetch and surfaces a setPluginError until usage drops back below the cap.
- Per-instance API request counter on `AccuWeatherService` (`getRequestCount()`). The status banner now reports `Running, last update Nm ago (N updates, K API requests)` once any fetch attempt has happened, so operators can see at a glance how chatty the plugin has been with AccuWeather. The counter increments on the fetch path (default 5-minute cadence), not the 5-second emission tick, so there is no hot-path overhead.

### Fixed

- **`environment.{outside,wind}.derived.*` removed.** The 1.8.2 vocab defines those containers as leaf-only; nesting an object node under them violated the spec and broke consumers walking the containers. The CLAUDE.md guidance that previously recommended this pattern has been revised.
- **Meta delta now follows the first values delta** instead of preceding it. The 1.8.2 spec (`data_model.html`) does not specify ordering between meta and value updates, so this is an admin-UI rendering workaround (Instrument Panels that attach units lazily on first paint render correctly without a refresh), not a spec requirement.
- **Per-tick delta is built fresh instead of stamping the cached delta in place.** `withEmissionTimestamp(cached)` returns a new `Delta` with restamped `updates[].timestamp`; the cached delta is no longer mutated. Removes an awkward `as` cast and matches the "treat deltas as immutable from the caller's perspective" expectation.
- **Status banner shows live counters.** `setPluginStatus` now reports `Running, last update Nm ago (N updates)` (or `Running, awaiting first update` before the first fetch) so operators can see at a glance whether the plugin is fetching. Previously hardcoded to the static string `Running`.
- **Status banner refreshes on every emission tick.** Earlier in the 1.4.0 cycle the banner was pushed to `setPluginStatus` once during `finalizePluginStart` (when `lastUpdate` was still null) and never refreshed except on stale-error recovery, so weather data could be flowing while the admin UI showed the start-time `Running, awaiting first update` string indefinitely. `emitWeatherTick` in `index.ts` now re-pushes `formatStatusBanner()` on every fresh tick, which also subsumes the old `staleErrorActive` recovery flag flip.

### Verified -- already correct, do not regress

- `directionTrue` receives the `degreesToRadians` conversion in `AccuWeatherService.transformWeatherData`, so the `rad`-typed canonical path is fed radians as the spec requires. AccuWeather documents the field as "Wind direction in azimuth degrees from north" without a qualifier; per the WMO surface-wind convention (Guide to Meteorological Instruments WMO-No. 8), all meteorological surface-wind observations are referenced to true north. Mapping to `environment.wind.directionTrue` is therefore correct; the rationale is now pinned next to the conversion call.
- `Plugin.start` is `async` even though the typed contract is sync; signalk-server doesn't await `start()`, so the existing try/catch funnels failures to `setPluginError` instead of letting them surface as unhandled rejections. The trap comment at `index.ts:80-82` is preserved.

### Tests

- 235 tests passing across 10 files. Mapper tests rewritten to assert the new `environment.weather.*` paths.
- Mutation-tested the pure-function modules (calculators, conversions, validation) with Stryker.js 9.6.1 + `@stryker-mutator/vitest-runner`. Baseline 989 mutants, 61.78% killed; after adding 8 targeted unit tests the score lifted to 67.44% overall (WindCalculator 57.96 to 74.34, conversions 86.39 to 94.67, validation 56.23 to 57.07). New tests pin: the `normalizeAnglePiToPi(-π) = +π` boundary, the Magnus humid-air density branch, the Beaufort threshold strict-less-than, the NWS heat-index reference values for 95F/70% (baseline polynomial) and 85F/90% (high-humidity adjustment branch), the 4.81 km/h wind-chill activation boundary, the exact apparent-wind angle for beam wind, and a defined-but-NaN field path through `validateWeatherData`. Run via `npm run mutation-test` (opt-in, ~5 minutes on a Pi 5; not wired into `validate`).
- End-to-end integration smoke test (`src/__tests__/integration/weather-flow.integration.test.ts`) that drives the real `WeatherService` + `AccuWeatherService` + `NMEA2000PathMapper` triple against a mocked `global.fetch`, covering the happy-path delta shape, the 429 retry path, and the 401 unauthorized error code.
- Schema-conformance tests (`src/__tests__/mappers/delta-schema.test.ts`, 8 cases) that validate every delta this plugin emits against the canonical `@signalk/signalk-schema@1.8.2/schemas/delta.json` JSON Schema using Ajv (with `ajv-draft-04` for the schema's draft-04 dialect). Both the values delta from `mapToSignalKPaths` (minimal and fully enhanced fixtures) and the one-shot meta delta from `buildMetaDelta` are checked, plus a vocabulary assertion that every `environment.outside.*` and `environment.wind.*` path falls in the 1.8.2 leaf set (the canonical leaf list is loaded from the live `groups/environment.json`, not hand-encoded, so a future spec drop that adds a leaf does not produce false positives). New devDependencies: `ajv`, `ajv-formats`, `ajv-draft-04`, `@signalk/signalk-schema@1.8.2`. The meta-delta validation uses a relaxed copy of the meta sub-schema with `required: ['description']` removed: the spec prose at https://signalk.org/specification/1.8.2/doc/data_model.html shows meta blocks with only `units` and `displayName`, and the wider Signal K ecosystem ships meta updates without `description`, so the schema's strictness here is a known upstream bug rather than a producer-side requirement.
- New regression test in `src/__tests__/index.test.ts` ("refreshes the status banner on emission ticks after weather data is available") pins the banner-refresh fix.

### Documentation

- `docs/api-key-storage.md` (spike on plugin secrets handling). Surveys signalk-server's `savePluginOptions` storage path, confirms `@signalk/server-api` 2.24 ships no plugin-facing secrets API, compares four peer plugins that hold third-party API keys, and recommends closing the long-standing "encrypt the API key in configuration storage" P2 TODO as not-applicable. The plugin already exceeds the ecosystem hardening baseline (password widget, log redaction, schema `minLength`); a custom symmetric layer without an external key store would be theatre on a single-user appliance.
- `docs/app-store-status.md` documenting the Signal K App Store verification (plugin is live as of 2026-05-10, listed under "Weather", auto-discovered via the `signalk-node-server-plugin` npm keyword) plus a reproducible curl check. Closes the long-standing P3 "Signal K App Store submission" TODO: there is no submission step, the App Store keys off the npm keyword and the plugin already carries it.
- `docs/weather-provider-migration.md` (migration spike to `@signalk/server-api` 2.24's `WeatherProvider`) and `docs/manual-server-test.md` (operator checklist for verifying a live install).

### Cleanup

- Test helpers consolidated. `createMockSignalKApp` (in `setup.ts`) gained a typed `selfPaths` override map and is now used by both `index.test.ts` and the new integration test instead of three near-duplicate `buildMockApp` variants. `createMockFetchResponse` replaces the dead `createMockFetch` helper and provides the real Fetch API shape (Headers + content-length + text/json) that AccuWeatherService actually exercises. `getValuesFromDelta` is now the single source of truth for extracting values out of a delta and is imported by mapper, integration, and delta-schema tests.
- `AccuWeatherService.getCacheStats()` no longer mixes location-cache state with HTTP-fetch state. The previous `{ size, requestCount }` return shape was a leaky abstraction. `getCacheStats()` is back to `{ size }`; the API request count is exposed as a dedicated top-level `apiRequestCount` field on `WeatherServiceStatus` and via `AccuWeatherService.getRequestCount()`. Two accessors collapsed to one source of truth.
- Integration test stubs `global.fetch` via `vi.stubGlobal` / `vi.unstubAllGlobals` so the original is restored after each test instead of being permanently shadowed.
- Verbose 19-line meta-schema relaxation comment in `delta-schema.test.ts` trimmed to the load-bearing WHY (spec prose vs schema requirement, ecosystem behaviour); the draft-04 empty-required-array detail is left as a self-explanatory code spread.

### Build / dependencies

- GitHub Actions bumps merged from Dependabot: `actions/checkout` 4 → 6, `actions/setup-node` 4 → 6, `actions/github-script` 7 → 9, `peter-evans/create-pull-request` 7 → 8, `codecov/codecov-action` 5 → 6. The checkout/setup-node bumps clear the "Node 20 actions are deprecated" annotation that was showing on prior workflow runs.
- Dev-deps bumps merged from Dependabot: `@types/node` 20.19.40 → 25.6.2, `lint-staged` 16.4.0 → 17.0.4. Dev-only; runtime `engines.node` floor stays at 20.18.

### Future direction

- `@signalk/server-api` 2.24 ships a first-class `WeatherProvider` interface (`registerWeatherProvider` + a typed `WeatherDataModel` whose `outside` block already covers `uvIndex`, `cloudCover`, `horizontalVisibility`, `feelsLikeTemperature`, `absoluteHumidity`, `precipitationType`, `precipitationVolume`, etc.). For data that is genuinely "weather provider" data (which this plugin is), that API is the canonical home. The producer-namespaced delta path is a defensible stopgap, not the long-term shape; a future major version should evaluate migrating to `WeatherProvider`.

<a id="v133"></a>

## [1.3.3] - 2026-05-09

Codebase-wide cleanup pass following v1.3.2. Findings were verified against the live Signal K master schema and the installed `@signalk/server-api` 2.24 `.d.ts`, not from memory. No public Signal K path or delta-shape changes; no configuration changes.

### Fixed -- correctness, reliability

- **Admin dashboard status strings.** `PLUGIN.STATUS.RUNNING` / `STOPPED` were `'SK to N2K Weather running'` / `'SK to N2K Weather stopped'`, leftover from the pre-rename `signalk-n2k-weather-provider` package. Now `'Running'` / `'Stopped'`. The Signal K dashboard already shows the plugin name next to the status, so the prefix was redundant as well as stale.
- **`stop()` no longer wipes the AccuWeather location-key cache.** The cache has a 2-hour TTL by design. Wiping it on every plugin restart (config change, error recovery) burned a fresh paid `LOCATION_SEARCH` API call on every restart. The cache now persists for the lifetime of the `AccuWeatherService` instance and is GC'd when the service is dropped.
- **`warn` and `error` log levels now route through `app.error`** instead of `app.debug`. Per `@signalk/server-api` 2.24 `serverapi.d.ts`, `app.debug` is gated by `DEBUG=plugin-id` and is silent in production. Operators now see warnings and errors in the server log without enabling debug logging. Plugin-level Admin UI banner state still goes through `setPluginError` separately.
- **`enhanceWeatherData` no longer recomputes `windChill`, `heatIndex`, `dewPoint`.** AccuWeather's `currentconditions` endpoint always populates these fields, so the `??` fallback to `WindCalculator.calculate*` was dead code. The function now only adds apparent-wind to the weather payload.

### Changed -- code reuse

- **`AccuWeatherService.transformWeatherData`** now calls the existing `millibarsToPA`, `kmhToMS`, `degreesToRadians` helpers from `utils/conversions.ts` instead of inline `* UNITS.PRESSURE.MILLIBAR_TO_PASCAL` etc. Style-matches the temperature path which already used `celsiusToKelvin`.
- **`SignalKService` course-fallback list hoisted to a module-level `COURSE_FALLBACK_PATHS` constant** so the array isn't re-allocated every call. The path that was previously inlined as a string literal (`'navigation.courseOverGroundMagnetic'`) is now in `SIGNALK_PATHS.NAVIGATION.COURSE_OVER_GROUND_MAGNETIC`.
- **`validation.validateDataAge` uses `VESSEL_DATA_WARN_AGE` / `VESSEL_DATA_ERROR_AGE` constants** instead of bare `60` / `300` literals.
- **`validation.validateNMEA2000Ranges` and `validateEnhancedFields` use `VALIDATION_LIMITS.HUMIDITY` constants** for the cloud-cover and humidity range checks instead of bare `0` / `1`.
- **`EXCLUDED_SOURCE_LABELS` deduplicated.** `'signalk-node-red'` was a substring of `'node-red'`, so the bare `'node-red'` entry already covered it.

### Removed -- dead code

- **Six unused public methods on `WindCalculator`:** `calculateBeaufortScale` (delegated to the standalone function in `utils/conversions.ts`), `calculateRelativeWindDirection`, `calculateWindDirectionHeading`, `calculateWindDirectionMagnetic`, `convertWindSpeed`, `convertWindDirection`, `getWindSummary`. Plus `calculateWindAnalysis`'s `validateWindInputs` is now `private` (no external callers).
- **`generateMockWeatherData` removed from `WeatherService`.** Test-only stub on a production class. The two tests that exercised it have been removed alongside.
- **Unused exports in `utils/conversions.ts`:** `pascalsToMillibars`, `knotsToMS`, `mphToMS`, `msToMPH`, `isValidNumber`, `calculateVaporPressureDeficit`. Their tests went too.
- **Unused exports in `utils/validation.ts`:** `validateNavigationData`, `isCompleteForWindCalculations`, `validateCompleteWeatherData`, `validateTemperatureConsistency` (was a private dep of `validateCompleteWeatherData`), `getValidationSummary`. Their tests went too.
- **`GeoLocation.isValid` field.** Set to `true` at every construction site, never read in production. Pure noise on the type.

### Changed -- package metadata / build

- **`package.json` `exports` map added** so consumers go through the typed entry point. Modern ESM convention; matches what `@signalk/server-api` itself ships.
- **`sideEffects: false`** added so bundlers tree-shake when this plugin is consumed by a webapp build.
- **`appstore` block dropped.** Per the canonical Signal K plugin example, the only documented `signalk` field members are `displayName` and `appIcon`. `appstore` and `signalk.supportedVersions` are not part of the documented plugin registry shape.
- **`signalk-category-nmea-2000` keyword added** to match the spelling used by the companion `signalk-nmea2000-emitter-cannon` plugin.
- **`.node-version` bumped from `20.0.0` to `20.18.0`** to match the `engines.node` floor; previously a `.node-version`-aware tool would install a runtime older than the declared minimum.

### Changed -- linting

- **Biome 2.4 `nursery.noFloatingPromises` and `noMisusedPromises` enabled.** Catches unawaited async paths that the previous ruleset missed.
- **Biome bumped to `^2.4.15`** (latest patch). `biome.json` `$schema` URL updated to match.

### Tests / coverage

- 206 tests passing across 8 files.
- New test file `src/__tests__/index.test.ts` covers the plugin entry point's meta-delta one-shot invariant and lifecycle wiring (4 cases).
- New `HTTP Error Handling` block in `AccuWeatherService.test.ts` (5 cases): 403 → `API_FORBIDDEN`, 429 retried then succeeds, 429 exhausted → `API_RATE_LIMIT`, 503 with `Retry-After: 0` retried then succeeds, oversized `content-length` → `RESPONSE_TOO_LARGE`.
- Tests covering removed dead exports (~30) were dropped alongside the exports.

<a id="v132"></a>

## [1.3.2] - 2026-05-09

Codebase-wide cleanup pass following the Signal K spec compliance work in v1.3.1. No public API changes beyond the dead-export removal listed below; configuration shape unchanged. Fixes a real correctness issue (Magnus formula constant mismatch), adds defensive optional-chaining for free-tier AccuWeather responses, and bounds the error-body read previously bypassed on 4xx/5xx responses.

### Fixed -- correctness, reliability

- **Magnus formula constants are now a single source of truth.** `WindCalculator.calculateDewPoint` previously used `(17.625, 243.04)` while `conversions.calculateSaturationVaporPressure` used `(17.27, 237.7, 6.112)`. The two variants returned different dew-point values for the same input. Both now read from `MAGNUS.{A,B,C}` in `constants/index.ts` (August-Roche-Magnus variant). The published `calculateSaturationVaporPressure` at 20°C shifts from ~2339 Pa to ~2333 Pa (within the ~5 Pa variant tolerance).
- **`AccuWeatherService.transformWeatherData` no longer throws on free-tier API responses.** Optional chaining added on `Precip1hr`, `PrecipitationSummary.PastHour`, and `Past24HourTemperatureDeparture` (those fields are absent on free-tier subscriptions). The corresponding `WeatherData` fields are now omitted via conditional spread when undefined, so `exactOptionalPropertyTypes` stays satisfied.
- **Error response bodies are bounded.** `handleApiError` now reads error response bodies via `readBoundedJson` instead of unbounded `response.json()`, applying the same 1 MiB cap that already protected success paths.

### Changed -- code reuse / consistency

- **`toErrorMessage(error)` helper** in `utils/conversions.ts` consolidates 19 occurrences of the `error instanceof Error ? error.message : String(error)` pattern across `index.ts`, `WeatherService.ts`, `AccuWeatherService.ts`, and `SignalKService.ts`.
- **Navigation paths are constants.** `SIGNALK_PATHS.NAVIGATION` adds canonical names for the six paths `SignalKService` reads via `app.getSelfPath` (`navigation.{position,speedOverGround,courseOverGroundTrue,headingTrue,headingMagnetic,magneticVariation}`). String literals in `SignalKService.ts` now reference the constants, so a typo in any input path becomes a type error rather than a silent runtime undefined.
- **Magnus + length conversion constants.** New `MAGNUS` block in `constants/index.ts`. `UNITS.LENGTH.KM_TO_M` replaces the file-private `KM_TO_M` literal in `AccuWeatherService.ts`.
- **Course-over-ground gets its own range constants.** `VALIDATION_LIMITS.COURSE_TRUE` mirrors `WIND_DIRECTION` numerically but is named for the semantic it actually validates, so changing one bound does not silently shift the other.
- **Stale-observation threshold is named.** `STALE_OBSERVATION_THRESHOLD_MS` in `AccuWeatherService.ts` replaces the bare `3600000` magic number used by `calculateDataQuality`.
- **Vessel-data age thresholds are named.** `VALIDATION_LIMITS.VESSEL_DATA_WARN_AGE` (60 s) and `VESSEL_DATA_ERROR_AGE` (300 s) replace inline magic numbers in `validation.ts`.
- **`calculateApparentWindSpeed` and `calculateApparentWindAngle` delegate to `calculateWindAnalysis`.** Eliminates the duplicate four-trig-call pair that the v1.3.0 optimization already collapsed once. Net per-call: 4 sin/cos calls instead of 8.
- **`STALENESS_FACTOR: 2` constant** in `PLUGIN` documents the implicit 2x-update-frequency threshold previously hard-coded inside `setupEnhancedEmissionSystem`.
- **`DEW_POINT_FALLBACK_K` constant** names the previously bare `temperatureK - 5` fallback in `WindCalculator.calculateDewPoint`.

### Changed -- package metadata / build

- **`@signalk/server-api`** stays declared as a `peerDependency` (v1.3.1 change); restored bundle size (~65 KB).
- **`@types/node`** pinned from `^25.0.9` down to `^20.18.0` to match the `engines.node` floor. Eliminates the silent type-vs-runtime drift where Node-25-only APIs would type-check but fail at runtime on the supported Node 20.18+.
- **Removed `optionalDependencies`** entirely; `@rollup/rollup-win32-x64-msvc` was vestigial since the bundler is esbuild, not Rollup.
- **Dropped duplicate `npm` script aliases** `typecheck` and `check` (kept the `type-check` and `lint` canonical names).
- **Removed stale `signalk.compatibility` block** in `package.json` (`nmea2000: true`, `signalkVersion: ">=2.0.0"`). The block is not part of the Signal K plugin registry schema; `signalk.supportedVersions` already carries the version constraint.
- **Removed `appstore` block** keys that the Signal K app store schema doesn't recognize. The block is gone from this version since the project's app-store metadata lives elsewhere.
- **`files` array** dropped `DEVELOPMENT.md` and `TODO.md` from the published npm tarball; those are dev-internal docs.
- **`tsconfig.json`** dropped the dead `ts-node` configuration block. The dev runner is `tsx`, which doesn't read `ts-node` config.
- **`esbuild.config.js`** minify gating made coherent: `minifyWhitespace` and `minifySyntax` are always on (cheap, no debug cost); `minifyIdentifiers` only in production so dev sourcemaps stay readable.
- **`vitest.config.ts`** bumped `hookTimeout` from 10 s to 15 s so async `beforeAll` / `afterAll` setup has more headroom than individual tests.
- **CI workflow** added `concurrency.cancel-in-progress` to cancel duplicate runs on rapid PR pushes; bumped `codecov/codecov-action` from `@v4` to `@v5`.
- **Dependency-updates workflow** bumped `peter-evans/create-pull-request` from `@v6` (Node 16, deprecated) to `@v7`; this was almost certainly the cause of 35 consecutive failed weekly runs.
- **Publish workflow** added a `Verify tag matches package.json version` step (mirrors the cannon's setup) so tag/version drift is caught before npm publish.

### Removed -- dead code

- Conversion helpers with no production callers: `convertTemperature`, `inchesHgToPascals`, `atmToPascals`, `roundTo`, `percentageChange`, `sanitizeWeatherData`, `normalizeHumidity`. Their tests were removed alongside.
- `TemperatureUnit` type alias (only used by the removed `convertTemperature`).
- `PGN` constant block in `constants/index.ts`. PGN instance assignment is delegated to the companion `signalk-nmea2000-emitter-cannon` plugin per the project's stated architecture; the constant was dead and actively misleading.
- `ACCUWEATHER.LOCATION_SEARCH_RADIUS` constant (unused).
- `PLUGIN.ENHANCED_FIELD_COUNT` constant. The hard-coded value (24) diverged from the runtime path count and was a documentation-debt trap. Status messages no longer suffix the count.
- Internal `countEnhancedFields` function in `AccuWeatherService.ts` (only used by one debug log; inlined or dropped).
- Dead test infrastructure in `__tests__/setup.ts`: `createOrderedMock`, the `toBeCloseTo` override (which silently masked Vitest's native semantics), and the `toBeValidSignalKDelta` matcher (never invoked, accepted invalid deltas).

### Tests / coverage

- 231 tests passing across 7 files (down from 244 because the 13 tests covering removed dead-export helpers are gone).
- Branch coverage now 81.57% (above the documented 80% threshold; previously 78.86%).

### Documentation

- Doc-vs-code reconciliation fixed several stale claims: clone URL pointed at the `signalk` org instead of `NearlCrews`; `npm run build:deploy` was a phantom script; `Node.js 20.0.0 or higher` understated the actual `>=20.18` floor; AccuWeather test count claimed "+1 skipped" but no skipped tests remain.
- Test file diagram in DEVELOPMENT.md expanded from 3 entries to all 7.
- TODO known-issues section reset (branch coverage moved above threshold).

<a id="v131"></a>

## [1.3.1] - 2026-05-09

Signal K 1.8.2 spec compliance and ServerAPI hygiene pass. **Includes path renames that change the wire output**, so consumers reading the previous path strings must update.

### Changed -- Signal K paths (breaking)

- `environment.outside.humidity` → `environment.outside.relativeHumidity` (1.8.2 vocabulary). The value remains a ratio in `[0, 1]`.
- `environment.outside.windChillTemperature` → `environment.outside.apparentWindChillTemperature` (1.8.2 vocabulary; AccuWeather's `WindChillTemperature` is computed from observed wind, so it is "apparent" by spec definition).
- `environment.wind.beaufortScale` → `environment.wind.derived.beaufortScale` (not in 1.8.2 vocabulary, namespaced under `.derived.`).
- `environment.wind.gustFactor` → `environment.wind.derived.gustFactor` (same rationale).
- `environment.outside.heatStressIndex` → `environment.outside.derived.heatStressIndex` (same rationale).
- **`environment.wind.speedTrue` is no longer emitted.** AccuWeather wind is ground-referenced; emitting it as `speedTrue` (water-referenced per the 1.8.2 vocabulary) clobbered any real anemometer feed on a moving vessel. The plugin now emits ground-referenced wind to `environment.wind.speedOverGround` only. Consumers needing water-referenced wind should derive it from `speedOverGround` and the vessel's water-track speed.

### Added -- delta envelope

- **Explicit `$source: 'accuweather'`** on every update (constant lives in `PLUGIN.SOURCE_REF`). Lets users configure source priorities to prefer real onboard sensors over the API feed when both are present.
- **One-shot meta delta** at plugin start. `NMEA2000PathMapper.buildMetaDelta()` returns a `Delta` with a `meta` update entry describing units, displayName, and description for every non-canonical path. `index.ts` ships it exactly once per plugin lifetime (Signal K spec recommends emitting meta only when it changes; this plugin's meta is fully static). Lets the Admin UI / Instrument Panel render units and labels for the non-canonical paths.

### Fixed -- plugin lifecycle / ServerAPI

- **Logger no longer routes warn/error to `app.error`.** `app.error` is the Admin UI status channel per the official plugin developer docs, not a logging API. All four log levels now go through `app.debug` (with a `[DEBUG]`/`[INFO]`/`[WARN]`/`[ERROR]` prefix on each line). Plugin-level error STATUS is reported separately via `app.setPluginError`.
- **`start()` no longer rethrows from its catch.** The Signal K plugin contract reports startup failures via `setPluginError`; rethrowing surfaced as an unhandled rejection because signalk-server does not await `start()`.
- **Stale-data recovery flag** in `emitWeatherTick`. When the staleness check fires `setPluginError`, an `instance.staleErrorActive` flag is set; the next successful tick clears the Admin UI banner via `setPluginStatus`. Previously the banner persisted indefinitely after recovery.
- **`SKVersion.v1`** is now passed to `app.handleMessage(id, delta, SKVersion.v1)`, making v1/v2 routing explicit per the `@signalk/server-api` 2.24 contract.
- **Removed `if (app.setPluginStatus)` / `if (app.setPluginError)` existence guards** (7 sites across `index.ts` and `WeatherService.ts`). Both methods are required members of `ServerAPI` 2.x; the guards contradicted the declared types and were dead code.

### Changed -- package metadata

- `signalk.supportedVersions` is now an array (`[">=2.0.0"]`) per the Signal K plugin registry convention. Was a bare string `"^2.0.0"` which the registry treats as a literal version, not a semver range.
- `signalk.compatibility.signalkVersion` changed from `^2.0.0` to `>=2.0.0` to match.
- Dropped `appstore.tier`, `appstore.verified`, and the duplicate `appstore.compatibility` block (none of these fields are part of the official app store metadata schema).
- `@signalk/server-api` declared range bumped from `^2.10.2` to `^2.24.0`.
- `@signalk/server-api` moved to `peerDependencies`. The Signal K server provides it at runtime; this also restores the bundle from 161 KB back to ~66 KB (the bundle bloated when `SKVersion` became a value import, since esbuild only externalizes declared `dependencies` and `peerDependencies`).

### Removed -- dead code

- `WeatherData.pressureTendency` (`string` field). It was extracted from the AccuWeather response in `AccuWeatherService.transformWeatherData` but never reached the delta wire because the path was a free-text label on a numeric path slot. AccuWeatherService.ts also dropped the `capString` / `LocalizedText` extraction.
- `SignalKDelta` interface in `src/types/index.ts`. Dead since the mapper switched to returning the `@signalk/server-api` `Delta` brand directly. The matching `createMockSignalKDelta` helper in `__tests__/setup.ts` was also removed.
- `SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.PRESSURE_TENDENCY` constant.
- The cast `'vessels.self' as Context` was kept (server accepts both this literal and `undefined`); the `'as ReadonlyArray<string>'` cast on the mapper's `ENHANCED_PATHS` set was dropped (no narrowing benefit).

### Changed -- code reuse

- `'accuweather'` source ref consolidated into `PLUGIN.SOURCE_REF`.
- `MM_TO_M` and `MMH_TO_MS` (precipitation conversions) consolidated into `UNITS.PRECIPITATION`.
- `NMEA2000PathMapper` gained a `me(path, value)` helper that mirrors the existing `pv(path, value)` helper, eliminating 17 inline `as Path` casts in the meta block.
- Test helper `getValues(delta)` in `NMEA2000PathMapper.test.ts` replaces 9 duplicated `delta.updates.find((u) => 'values' in u)` extractions.
- `index.ts` mapper meta clone removed: the meta delta is built once per plugin lifetime instead of cloning the static meta array on every delta rebuild.

### Tests

- 244 tests passing across 7 files (was 243). One new test added for the one-shot `buildMetaDelta()` API.
- Mapper test rewritten to extract values via `getValues(delta)` helper and assert the new path names + `$source` field.

### Documentation

- README path tables, PGN tables, and Features section updated to reflect the new path names, `$source` semantics, meta delta, and 8-temperature path count (was incorrectly listed as 7).
- DEVELOPMENT.md compliance section reorganized; bundle size and test counts refreshed; humidity-format section updated to reference `relativeHumidity`.
- TODO.md compliance summary updated; the inaccurate "errors route to `app.error`" claim corrected.
- CLAUDE.md NMEA2000-compliance section expanded into a Signal K 1.8.2 compliance section covering canonical paths, `.derived.` namespace, `$source`, meta, and PGN routing.

<a id="v130"></a>

## [1.3.0] - 2026-05-05

Toolchain modernization plus a codebase cleanup. No breaking runtime behavior; configuration shape is unchanged. Minor-version bump because the toolchain floor (TypeScript 6, Node 20.18) and the Signal K paths emitted have both shifted in observable ways.

### Changed -- toolchain

- **TypeScript 5.9 → 6.0.3.** Removed the now-deprecated `downlevelIteration` compiler option, added `"types": ["node"]` and `"rootDir": "./src"` (TS 6 stricter emit rules), and accepted the `unknown` return from `app.getSelfPath` introduced in `@signalk/server-api` 2.24.
- **`@signalk/server-api` 2.10 → 2.24.0.** `NMEA2000PathMapper.mapToSignalKPaths` now returns the official `Delta` type from `@signalk/server-api` directly (was a custom `SignalKDelta` interface that required a double-cast at the consumer). Internal `pv()` helper performs the single boundary cast from plain string to the branded `Path` type.
- **esbuild 0.27 → 0.28.0**, **Vitest 4.0 → 4.1.5**, **Biome 2.3 → 2.4.14**, **lint-staged 16.2 → 16.4**, **`@types/node` 25.0 → 25.6**.
- **Engine floor raised to Node `>=20.18`** (was `>=20.0.0`) to match the `signalk-nmea2000-emitter-cannon` companion plugin.
- **Build/release script alignment with `signalk-nmea2000-emitter-cannon`:** added `prepack`, `typecheck` alias, `check` alias, `create-release`, and `release` scripts. Tightened `prepublishOnly` to run validate + build.

### Fixed -- spec / behavior

- **API key validator no longer false-positives on legacy keys.** The old `^[a-zA-Z0-9]{20,40}$` regex warned on any AccuWeather key containing punctuation (hyphens, underscores, dots), which can appear in older keys. Replaced with a whitespace/control-character check so paste mistakes still warn but valid non-alphanumeric keys do not.
- **Logger level prefix is now consistent across all four levels.** `LOG_PREFIX` had empty strings for `debug` and `error` and a duplicate `[WARN]` in the fallback path, so error-level lines were indistinguishable from debug-level lines in production logs unless `app.error` was available. Now every level emits a visible `[DEBUG]`/`[INFO]`/`[WARN]`/`[ERROR]` marker.
- **Signal K `Delta` cast hardening.** Dropped two `as unknown as` double-casts in `index.ts` (the mapper now returns a properly-typed `Delta`).

### Removed -- dead code

Confirmed unused via grep across the entire `src/` tree:

- Types: `NMEA2000Message`, `WeatherSource`, `ErrorSeverity`, `ApiResponse`, `isCompleteWeatherData`, `metadata` named export from `index.ts`.
- Constants: `TEMPERATURE_INSTANCES`, `HUMIDITY_INSTANCES`, `NMEA2000_PRIORITY`, `NMEA2000_DESTINATION`, `PGN.ENVIRONMENTAL_PARAMETERS`, `PGN.ACTUAL_PRESSURE`.
- Signal K paths in `SIGNALK_PATHS.ENVIRONMENT.OUTSIDE`: `THEORETICAL_WIND_CHILL_TEMPERATURE`, `RELATIVE_HUMIDITY`. Section: `INSIDE.*`.
- Signal K paths in `SIGNALK_PATHS.ENVIRONMENT.WIND`: `ANGLE_TRUE`, `DIRECTION_MAGNETIC`, `DIRECTION_APPARENT`, `ANGLE_TRUE_WATER`. The README previously documented `directionApparent` and `directionMagnetic` as emitted; that was inaccurate (they were never in any push path).
- `PERFORMANCE.MEMORY_THRESHOLDS`, `PERFORMANCE.INTERVALS`, `PERFORMANCE.MAX_PROCESSING_TIME.{WIND_CALCULATION,DATA_EMISSION}`. Only `MAX_PROCESSING_TIME.WEATHER_UPDATE` was actually read.
- Test helpers: `expectToThrow` and `withTimeZone` (zero call sites; `withTimeZone` also had a `process.env.TZ = undefined` bug that would have set the env var to the literal string `"undefined"`).

### Changed -- code reuse

- `AccuWeatherService`: `clamp(quality, 0, 1)` instead of nested `Math.max(0, Math.min(1, …))`. `kelvinToCelsius()` instead of inline subtraction. `User-Agent` header now derives from `PLUGIN.NAME` and `PLUGIN.VERSION` (was a hard-coded `signalk-virtual-weather-sensors/1.0.0` that silently went stale at every release). Named `KM_TO_M`, `MAX_RETRY_AFTER_MS`, `CACHE_PRUNE_INTERVAL_MS` constants instead of inline magic numbers.
- `WeatherService`: uses `isCompleteNavigationData` type guard (which itself was tightened to actually narrow `speedOverGround`/`courseOverGroundTrue` to non-undefined). `??` instead of `||` for the wind-calculator injection (matches the other two services). Drops two duplicated guard blocks.
- `WindCalculator`: uses `kelvinToCelsius`, `celsiusToKelvin`, `kelvinToFahrenheit`, `fahrenheitToKelvin`, `msToKMH`, `msToKnots`, `msToMPH`, `radiansToDegrees`, `clamp` instead of recomputing the same conversions inline. Named threshold constants for the Wind Chill (Environment Canada) and Heat Index (Rothfusz) regression boundaries.
- `validation.ts`: `kelvinToCelsius`/`celsiusToKelvin` for NMEA2000 sanitization. `VESSEL_SPEED.MAX` and `DEFAULT_CONFIG.UPDATE_FREQUENCY/EMISSION_INTERVAL` constants instead of inline literals. Required-fields list hoisted to module scope. Truthiness `if (a && b)` checks for `number | undefined` properties replaced with explicit `!== undefined`, so a legitimate `0` value no longer silently skips the consistency checks.
- `NMEA2000PathMapper`: 19 inline `{ path: ..., value: ... }` literals consolidated through a single `pv(path, value)` helper.

### Changed -- efficiency

- `sanitizeForNMEA2000` now returns the input reference unchanged when every field is in range, skipping the 24-field shallow copy on the common per-tick path. Pre-computed Kelvin range constants avoid a C↔K round-trip per tick.
- `WindCalculator.calculateWindAnalysis` computes the four shared trig terms once and derives both apparent speed and angle from them (was 8 trig calls per analysis: 4 in `calculateApparentWindSpeed`, 4 in `calculateApparentWindAngle`).
- Hoisted module-level constants: `COMPASS_DIRECTIONS`, `REQUIRED_ACCUWEATHER_FIELDS`. `Date.now()` captured once per `getLocationKey` call. `new URL(url)` instead of `new URL(url.toString())` in `sanitizeUrlForLogging`.
- `SignalKService.cachedData.lastUpdate: Date` → `lastUpdateMs: number` (skips a `Date` allocation per `getVesselNavigationData` call). `getHealthStatus` derives `isStale` from `dataAge` directly instead of calling `getDataAge` twice. `isVesselMoving` prefers cached speed over a fresh `getSelfPath` call.
- `SENSITIVE_LOG_KEYS` array of 6 `String.includes` calls replaced with one regex (`SENSITIVE_LOG_KEY_PATTERN`).

### Removed -- runtime

- `ApiResponse<T>` wrapper. `makeApiRequest<T>` now returns `Promise<T>` directly (the wrapper's `timestamp` field was never read; the `error` discriminator was never set because errors were thrown).
- `LOG_PREFIX` empty-string entries that produced ambiguous log output.

### Tests

- 243 tests passing, 0 skipped (was 241 + 1 skipped). The previously-skipped `should handle API errors gracefully` test was un-skipped and now actually exercises the 401/`API_UNAUTHORIZED` path through the existing `mockResponse` helper.
- New test: `does not warn on punctuation in API keys (some legacy keys contain them)` covers the relaxed validator.

### Documentation

- README path tables corrected: dropped `environment.wind.directionApparent` and `environment.wind.directionMagnetic` (never emitted). Tech-stack versions updated. Test count corrected to 243. References to `signalk-nmea2000-emitter-cannon` use the full package name.
- Em-dashes purged from comments and runtime log strings (was 11 occurrences across 5 files).

<a id="v123"></a>

## [1.2.3] - 2026-05-03

Cleanup release with no public-API changes. Fixes span reuse, code quality, efficiency, security, reliability, and the test suite; everything actionable landed (including low-priority items).

### Fixed -- correctness, reliability

- **Apparent wind angle no longer emitted as absolute bearing when no heading is available.** `calculateApparentWindAngleFromHeading` previously returned the absolute true-wind direction (e.g. 3.14 rad = 180°) and emitted it under `environment.wind.angleApparent`, looking like a valid bow-relative angle to consumers. Now returns `null` and the path is omitted from the delta until heading is available.
- **In-flight `updateWeatherData` no longer writes to torn-down state.** A `stop()` call during a fetch left the resolved promise to assign `currentWeatherData`/`lastUpdate` against a service whose timers had been cleared. Post-fetch assignments now early-return when state is no longer `running`/`starting`.
- **`WindCalculator.normalizeAngle` is finite-safe.** Delegated to `normalizeAnglePiToPi` which guards `Number.isFinite`; previously a `NaN` input fell straight through into deltas.
- **`isCompleteWeatherData` type guard now actually verifies completeness.** Added missing `dewPoint`/`windChill`/`heatIndex` checks; the guard previously asserted `WeatherData` for objects missing required fields.
- **`VesselNavigationData.dataAge` units corrected** -- typed comment claimed milliseconds but `validateDataAge` compared against seconds.

### Fixed -- Signal K spec / NMEA2000

- **Stripped duplicate `SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.DEW_POINT`** -- only `DEW_POINT_TEMPERATURE` ever reaches the bus; the orphan key was a maintenance trap.
- **Removed `NMEA2000_DESTINATION.NULL` alias** -- was identical to `GLOBAL: 255` and would have silently diverged.
- **Capped descriptive AccuWeather strings** (`WeatherText`, `PressureTendency.LocalizedText`, `LocalObservationDateTime`) and stripped control characters, in case future consumers log them.

### Fixed -- security

- **`EpochTime` validated with `Number.isFinite` in quality scoring** -- previously a `NaN`/`Infinity` value silently kept `quality = 1.0`.

### Changed -- efficiency (Raspberry Pi-class hosts)

- **O(1) angle normalization** in `normalizeAngle0To2Pi`/`normalizeAnglePiToPi` (and via them, `WindCalculator`) -- `while`-loop forms were O(N) for any value out of range or accumulated drift.
- **Per-tick emission no longer spreads the cached delta** -- `withEmissionTimestamp` cloned the entire 24-field delta on every 5-second tick. Replaced with in-place timestamp mutation; the delta is private to the plugin instance.
- **`Date.now()` captured once** in the staleness guard hot path.
- **`WeatherService.getLastUpdate()`** added so the emission tick reads one field instead of constructing the full `WeatherServiceStatus` (which itself triggers `signalKService.getHealthStatus()`) every 5 seconds.
- **Cached one-time computation hoisted in `WindCalculator.calculateWindChill`** -- `windKmh ** 0.16` was evaluated twice (`Math.pow` under the hood).
- **Hoisted module-level constants:**
  - `SENSITIVE_LOG_KEYS` (was rebuilt per warn/error log call)
  - `EXCLUDED_SOURCE_LABELS` (SignalKService excluded-source check)
  - `API_KEY_PLACEHOLDER_PATTERNS` (was 6 `RegExp` literals constructed per `validateApiKey` call)
  - `ENHANCED_PATHS` Set in `NMEA2000PathMapper.countEnhancedFields` -- replaced O(N×M) substring scan with O(1) Set lookup, and the substring heuristic also missed/mismatched several real paths.

### Changed -- reuse / consolidation

- **`AccuWeatherService.transformWeatherData` now uses helpers** -- `celsiusToKelvin()` (8 sites), `percentageToRatio()` for humidity and cloud cover (adds defensive clamp), and `isValidCoordinates`/`isValidTemperature`/`isValidPressure`/`isValidHumidity`/`isValidWindSpeed` in the validators.
- **`SignalKService` deduplicated** -- private `isValidGeoLocation`, `msToKnots`, `radToDegrees` removed in favour of the existing `conversions.ts` exports; `getVesselHeadingTrue`/`getVesselHeadingMagnetic` collapsed onto a shared `getHeading(path)` helper.
- **`WindCalculator` angle helpers** delegate to the canonical `conversions.ts` functions instead of three separate while-loop implementations.
- **`sanitizeForNMEA2000` and `validateNMEA2000Ranges`** read from new `NMEA2000_LIMITS` constants instead of inline `-40`/`85`/`80000`/`102.3` magic numbers in three places.
- **`CourseOverGround` validator** uses `VALIDATION_LIMITS.WIND_DIRECTION.MAX` instead of inline `2 * Math.PI`.
- **`WeatherService.updateWeatherData`** fetches navigation data once and reuses the position from it (removed the duplicate `getVesselPosition()` call per cycle).

### Removed (dead code)

- `NMEA2000_DESTINATION.NULL` (alias of `GLOBAL`).
- `SIGNALK_PATHS.ENVIRONMENT.OUTSIDE.DEW_POINT` (duplicate of `DEW_POINT_TEMPERATURE`).
- `ACCUWEATHER.API_VERSION` (orphan -- version embedded in endpoints).
- `ConstantKeys` / `ConstantValues` / `ExtractSignalKPath` utility types (unused).
- Empty `try/catch` swallowing branch in `calculateHeatStressIndex` (pure arithmetic, can't throw).
- Module-level `ENHANCED_FIELD_COUNT` literal in `index.ts` -- moved to `PLUGIN.ENHANCED_FIELD_COUNT`.
- Trivial `getWeatherPosition()` passthrough in `WeatherService`.
- Stale "Check if error is retryable" JSDoc orphan in `AccuWeatherService`.
- Dead `_warnings` parameter on `validateHumidityField`.

### Added

- `PLUGIN.STATUS` constants (`RUNNING`, `STOPPED`, `SERVICE_RUNNING`, `SERVICE_STOPPED`) -- replaces scattered string literals in `index.ts` and `WeatherService.ts`.
- `PLUGIN.INITIAL_UPDATE_DELAY_MS` -- replaces the magic `5000` in the start-up timer.
- `NMEA2000_LIMITS`, `UV_INDEX_LIMITS`, `VISIBILITY_LIMITS_M`, `BEAUFORT_LIMITS` -- single source of truth for spec ranges.
- `ACCUWEATHER.MAX_DESCRIPTION_LENGTH` / `MAX_LABEL_LENGTH` for string capping.
- `WeatherService.getLastUpdate()` (lightweight accessor for the emission tick).
- `capString(value, max)` helper in `AccuWeatherService` (strips control chars + truncates).

### Tests

- Fixed brittle exact-string assertions on init log messages (now `expect.stringContaining('initialized')`).
- Fixed humidity assertion that compared a 0-1 ratio against `≤100` (always passed; never caught regressions). Now asserts `≤1` per Signal K spec.
- Replaced the misleading "concurrent mapping requests" test (was wrapping a synchronous call in `Promise.resolve`) with a real "no state leakage across calls" check that verifies distinct payloads round-trip.
- Updated `validateLocation` error-message assertion to match the new (more informative) error text.

All 241 tests pass; type-check clean; biome clean.

<a id="v122"></a>

## [1.2.2] - 2026-04-19

Patch release fixing a number of Signal K spec violations, security gaps, and correctness bugs. All findings landed; no public configuration changes.

### Fixed -- Signal K spec compliance

- **`environment.wind.angleTrueWater` no longer fabricated** -- was incorrectly emitted equal to `apparentWindAngle`. They are different physical quantities; downstream consumers (chartplotters, emitters) were publishing false true-wind. Only `angleApparent` is emitted now.
- **Precipitation now in SI units** -- `precipitationLastHour` is meters (was `mm`) and `precipitationCurrent` is m/s (was `mm/h`), per Signal K spec. Consumers reading these as SI were off by 1000×.
- **Duplicate humidity path removed** -- was emitting both `environment.outside.humidity` and `environment.outside.relativeHumidity` with identical values; only the schema-standard `humidity` path remains.
- **`environment.outside.pressureTendency` no longer emitted** as a free-text string on a numeric path. Dropped pending proper PGN 130311 tendency-code mapping.
- **Explicit `source` literal removed from delta** -- `app.handleMessage(pluginId, …)` already stamps `$source` from the pluginId; the redundant `source: { label, type: 'Plugin' }` also used a non-standard `type` value.
- **Delta `meta` no longer stripped silently** -- meta was being computed then thrown away by the value mapper. Single-allocation delta build (also eliminates per-tick double allocation).

### Fixed -- correctness, security, reliability

- **Logger now routes errors to `app.error`** -- previously every level (including error/warn) went through `app.debug()`, making errors invisible in production unless debug mode was on.
- **Stale observation timestamp** -- emission delta now stamps `updates[0].timestamp` with the current emission time per tick, not the original AccuWeather observation time. Added a max-staleness guard (2× update interval) that calls `app.setPluginError` and skips emission when the upstream is stale, so API outages show as data gaps instead of stale data flowing forever.
- **Negative wind angles map correctly** -- `convertWindDirection('compass')` was silently returning `'N'` for port-tack negative radians (negative array index). Now wraps modulo correctly.
- **`calculateWindChill` returns `temperatureK` on bad input** -- previously returned literal `0` K (~ −273 °C), inconsistent with sibling fallbacks.
- **AccuWeather response validation wired up** -- `validateAccuWeatherResponse()` (already in the codebase but unused) now runs before the cast in `getCurrentConditions` and `searchLocation`. Schema drift or MITM injection no longer reaches downstream transforms unchecked.
- **AccuWeather response body capped at 1 MiB** -- pre-checks `Content-Length`, then re-checks after read; prevents silent OOM on constrained devices (Raspberry Pi).
- **`locationKey` URL-injection guard** -- keys returned by AccuWeather are now regex-validated (`^[a-zA-Z0-9_-]+$`) before interpolation into URL paths or caching.
- **429/503 double-delay fixed** -- `handleApiError` no longer sleeps internally; the caller's retry loop owns backoff. Previously each retry incurred 2× the configured delay.
- **`Retry-After` header still honored** -- restored after the double-delay fix; the retry loop now prefers the header value when present, falls back to linear backoff otherwise.
- **Type guards require `Number.isFinite`** -- `isCompleteWeatherData` and `isCompleteNavigationData` previously checked `!== undefined`; NaN slipped through and propagated into downstream math.

### Changed

- **`WeatherService` is now DI-friendly** -- constructor accepts optional `accuWeatherService` and `signalKService` params (defaults preserved). Mirrors the existing `WindCalculator` injection pattern.
- **`WeatherServiceStatus` interface exported** -- replaces inline `ReturnType<…>` leaks of internal service shapes from `getServiceStatus()`.
- **Type-cast cleanups** -- `cachedDelta` typed as `Delta` from `@signalk/server-api`; `cachedWeatherDataRef` typed as `WeatherData | null`; intermediate `Record<string, unknown>` config cast removed.
- **`isRetryableError`** -- lowercased error-code substrings precomputed as a module-level frozen `Set` instead of being recomputed per call.
- **Hot-path debug log on emission tick** -- replaced 4× filter+length passes with a one-line summary.
- **esbuild `legalComments: 'none'`** -- strips license headers from the production bundle.

### Added

- **`PGN.HUMIDITY` (130313) and `PGN.ACTUAL_PRESSURE` (130314) constants** -- replace magic numbers in mapper.
- **`ERROR_CODES.NETWORK.API_INVALID_RESPONSE` and `RESPONSE_TOO_LARGE`** for the new validation paths.
- **Schema metadata** -- `title` and `description` on the schema root for admin UI labeling; `minLength: 20` on the API key field.
- **NMEA2000 instance maps moved into `constants/index.ts`** -- were file-local in mapper.
- **101 new utility tests** -- `src/__tests__/utils/conversions.test.ts` (48 tests) and `src/__tests__/utils/validation.test.ts` (53 tests). Total tests: **241** (was 149).

### Removed

- **`es-toolkit` dependency** -- was unused in `src/`. Production `dependencies` is now empty.
- **`statusMessage()` method on the Plugin object** -- `app.setPluginStatus()` is the actively-used path. Note: per-tick dynamic status updates (which previously used this) are no longer pushed; status is set at lifecycle transitions only.
- **Dead constants**: `LOGGING`, `FEATURE_FLAGS`, `SignalKPath` union, `SignalKSource` type.
- **Dead public methods on `NMEA2000PathMapper`**: `getSupportedPGNs`, `getTemperatureInstanceMap`, `getHumidityInstanceMap`, `getPathStatistics`, `validateWeatherDataForMapping` -- all were test-only.

### Coverage

- Statements 81.9%, Branches 78.06%, Functions 90.75%, Lines 81.87% -- branches just below the 80% threshold (concentrated in `WeatherService.ts` error paths) but the Vitest threshold is currently advisory.

<a id="v120"></a>

## [1.2.0] - 2026-04-08

### Fixed

- **SignalKService: valid zero values discarded** -- `||` operator converted `speedOverGround=0` (vessel at rest) and `headingTrue=0` (heading North) to `undefined`. Replaced with `??` throughout.
- **WeatherService: API-provided derived values overwritten** -- `enhanceWeatherData` unconditionally recalculated `windChill`, `heatIndex`, and `dewPoint` using simpler local formulas, discarding AccuWeather's meteorological model values. Now only fills in missing values.
- **Double delta emission** -- `WeatherService.emitWeatherData()` built and emitted its own Signal K delta on every weather update, while `index.ts` independently built another via `NMEA2000PathMapper` every 5 seconds. Two slightly different deltas were sent nearly simultaneously. Removed the WeatherService copy.
- **Inconsistent enhanced field counts** -- `WeatherService.countEnhancedFieldsInDelta` and `NMEA2000PathMapper.countEnhancedFields` used different path lists to count the same thing.

### Changed

- **Emission delta caching** -- The 5-second emission timer now caches the mapped delta and only rebuilds when weather data changes (reference comparison). Previously rebuilt the delta, ran NMEA2000 sanitization, and allocated 30+ metadata objects on every tick.
- **Reduced redundant SignalK reads** -- `getVesselNavigationData()` was called 3 times per weather update (18+ `getSelfPath` calls). Vessel data is now fetched once.
- **`enhanceWeatherData` made synchronous** -- Was marked `async` with no `await` expressions, adding a needless microtask per weather update.
- **`Logger` type alias** -- Replaced 6 inline repetitions of the logger function signature with a shared `Logger` type from `types/index.ts`.

### Removed

- **`src/utils/metrics.ts`** (332 lines) -- `MetricsCollector` and `createPluginMetrics` were never imported or used.
- **WeatherService emission system** (~240 lines) -- `emitWeatherData()`, `createSignalKDelta()`, 7 `add*Data` helper methods, `shouldEmitOnChange()`, `countEnhancedFieldsInDelta()`, and the duplicate `normalizeAngle()`. Emission is handled solely by `index.ts` via `NMEA2000PathMapper`.
- **Unused conversion utilities** (~125 lines) -- 5 AccuWeather-specific converters, 4 "fast" converters, and 10 namespace export objects from `conversions.ts`. None were imported by any source file.
- **Unused validation namespace objects** -- `WeatherDataValidator`, `VesselDataValidator`, `ApiResponseValidator`, `ValidationOrchestrator` from `validation.ts`.
- **Unnecessary try/catch in WindCalculator** -- Removed from 9 pure math methods. JS math operations return `NaN`/`Infinity` (handled by existing `isFinite` checks), they don't throw.

<a id="v110"></a>

## [1.1.0] - 2026-01-20

### Added

#### Test Coverage
- **WeatherService.test.ts**: 25 comprehensive tests covering initialization, lifecycle management, data emission, and configuration validation
- **SignalKService.test.ts**: 40 tests for vessel navigation data retrieval including position, speed, course, heading, caching, and health status
- Total test count increased from 85 to 150 tests

#### Security and Reliability
- **API key log sanitization**: Automatic filtering of sensitive keys (apikey, password, secret, token) from log output
- **Retry-After header support**: Respects server rate limit headers for 429 and 503 responses
- **Exponential backoff**: Falls back to exponential backoff when Retry-After header not present
- **Polling jitter**: ±10% random variation on update intervals to prevent synchronized API requests

### Changed

#### Improved Logger Implementation
- Warning messages now call `app.setPluginStatus()` for Signal K UI visibility
- Error messages now call `app.setPluginError()` for Signal K UI visibility
- All log metadata automatically sanitized to remove sensitive information

#### Enhanced API Key Validation
- Minimum length validation (20 characters)
- Maximum length warning (>40 characters)
- Alphanumeric format validation via regex pattern
- Detection of common placeholder patterns (your-api-key, test, demo, etc.)

#### Memory Management
- **Location cache pruning**: Automatic removal of expired entries (>2 hours old)
- **Cache size limits**: Maximum 100 entries with LRU-style eviction
- Cache pruning runs every 5 minutes to prevent memory growth

### Documentation

#### Documented Performance Thresholds
- `WEATHER_UPDATE` (5000ms): Based on AccuWeather API typical response times (1-3 seconds)
- `WIND_CALCULATION` (100ms): Vector calculations should complete in <10ms
- `DATA_EMISSION` (1000ms): Delta message creation and Signal K emission
- Memory thresholds: 50MB warning, 100MB critical
- All thresholds now include detailed JSDoc explaining rationale

### Technical Improvements

- **Official Signal K types**: Uses `Plugin` and `ServerAPI` from `@signalk/server-api` for maximum compatibility
- **TypeScript 5.9+**: Updated all version references in documentation
- **Vitest 4.x**: Updated testing framework with improved coverage
- **Biome 2.3+**: Updated linting and formatting tooling

### Fixed

- Fixed unused import warnings in test files
- Fixed `Math.pow()` usage replaced with `**` operator per linting rules
- Fixed TypeScript strict mode issues with optional properties
- Resolved all Biome linting warnings

<a id="v101"></a>

## [1.0.1] - 2025-10-13

### Fixed

#### CI/CD
- **GitHub Actions Permissions**: Added missing `contents:read` and `issues:write` permissions to `security-audit` job in dependency-updates workflow
- Resolved "Resource not accessible by integration" error that prevented automated security issue creation
- Fixed CI failures in the dependency-updates workflow

<a id="v100"></a>

## [1.0.0] - 2025-10-03

### Initial Release: Modern TypeScript Signal K Weather Plugin

First production release of signalk-virtual-weather-sensors: a comprehensive weather data plugin for Signal K servers with NMEA2000 compatibility and AccuWeather API integration.

### Added

#### Enhanced AccuWeather Integration
- **Indoor Humidity** monitoring from AccuWeather API
- **Wind Gust Data** for enhanced marine safety assessment
- **Advanced Temperature Readings**: Wet bulb, wet bulb globe, RealFeel shade, apparent temperature
- **Atmospheric Visibility Data**: UV index, visibility distance, cloud cover, cloud ceiling
- **Weather Trend Analysis**: Pressure tendency, 24-hour temperature departure
- **Precipitation Monitoring**: Current and historical precipitation data

#### Marine-Specific Calculations
- **Beaufort Scale** calculation from wind + gust data for standardized wind assessment
- **Heat Stress Index** from wet bulb globe temperature (military/marine standard)
- **Enhanced Air Density** calculations including atmospheric corrections
- **Absolute Humidity** precision calculations for atmospheric analysis
- **Wind Gust Factor** analysis for wind safety assessment

#### NMEA2000 and `signalk-nmea2000-emitter-cannon` Alignment
- **Perfect PGN alignment** with `signalk-nmea2000-emitter-cannon` conventions
- **Multiple temperature instances** (101-111) for comprehensive temperature monitoring
- **Enhanced humidity support** with inside/outside instances (100/101)
- **Improved wind data** with gust integration in PGN 130306
- **Proper instance assignments** following `signalk-nmea2000-emitter-cannon` standards

#### Modern Architecture
- **Complete TypeScript 5.9+** conversion with strict mode compliance
- **Hybrid emission system** combining event-driven updates with reliable intervals
- **Service-oriented architecture** with dependency injection and comprehensive error handling
- **Advanced validation framework** for NMEA2000 compatibility
- **Performance optimizations** for real-time marine applications

#### Developer Experience
- **Modern build system** with esbuild (109.9kb bundle in 16ms)
- **Comprehensive test suite** with 85+ tests covering all functionality
- **Type safety** preventing runtime errors with comprehensive interfaces
- **Development tooling** with hot reload, linting, formatting, and coverage
- **Production logging** with structured metadata for monitoring

### Changed

#### Breaking Changes
- **Plugin name**: `@signalk/signalk-n2k-weather-provider` → `signalk-virtual-weather-sensors`
- **Main entry**: `plugin/index.js` → `dist/index.js` (built from TypeScript)
- **Module system**: CommonJS → ESM modules throughout
- **Configuration**: Enhanced with new optional settings for advanced features
- **Dependencies**: Updated to latest versions (node-fetch v3.3.2, TypeScript 5.9+)

#### Enhanced Features
- **Data coverage**: 8 basic fields → 25+ comprehensive environmental measurements
- **Path mappings**: Enhanced to align with `signalk-nmea2000-emitter-cannon` path structure
- **Wind calculations**: Improved vector mathematics with comprehensive validation
- **Error handling**: Production-ready with structured error codes and recovery
- **Performance**: Significantly improved with TypeScript optimizations

### Technical Improvements

#### Code Quality
- **Zero TypeScript compilation errors** across entire codebase
- **Comprehensive type coverage** with strict mode compliance
- **Modern error handling** with structured error codes and detailed logging
- **Production-ready validation** for all data types and configurations
- **Performance monitoring** with timing thresholds and resource cleanup

#### Build and Development
- **Fast builds**: esbuild configuration for rapid development and production builds
- **Modern testing**: Vitest framework with comprehensive test coverage
- **Code quality**: Biome linting and formatting with TypeScript support
- **Developer productivity**: Hot reload, type checking, automated formatting

#### Architecture
- **Service-oriented design** with clear separation of concerns
- **Dependency injection** for testability and modularity
- **Comprehensive validation** at all data transformation points
- **Resource management** with proper cleanup and memory optimization
- **Extensible design** for future weather data sources

### Data Coverage Enhancement

#### Temperature Monitoring (8 Types)
- Air temperature, dew point, wind chill, heat index
- Wet bulb temperature, wet bulb globe temperature
- RealFeel temperature, RealFeel shade temperature

#### Wind Analysis (7 Measurements)
- True wind speed/direction, apparent wind speed/angle
- Wind gust speed, gust factor, Beaufort scale

#### Atmospheric Conditions (8 Parameters)
- Pressure, humidity (inside/outside), UV index
- Visibility, cloud cover, cloud ceiling, pressure tendency

#### Marine Safety Indices (4 Assessments)
- Heat stress index, Beaufort wind safety
- UV exposure assessment, visibility safety

### Compatibility

#### Backward Compatibility
- **Configuration**: All existing settings supported with sensible defaults
- **Core paths**: All original Signal K paths preserved
- **NMEA2000**: Enhanced compatibility while maintaining existing integrations
- **Signal K server**: Compatible with all current Signal K server versions

#### Forward Compatibility
- **Extensible architecture** for additional weather data sources
- **Modular design** supporting future NMEA2000 PGN additions
- **Type-safe interfaces** facilitating safe feature additions
- **Performance headroom** for additional computational features

### Fixed

#### Issues from v1.0
- **Type safety**: Eliminated runtime type errors with comprehensive TypeScript types
- **Error handling**: Improved API error recovery and graceful degradation
- **Performance**: Optimized calculations and reduced memory usage
- **Data validation**: Enhanced NMEA2000 range checking and sanitization
- **Configuration**: Better validation and error messages for invalid settings

#### Code Quality
- **Linting**: Zero linting errors with modern code standards
- **Testing**: Comprehensive test coverage with validated functionality
- **Documentation**: Complete inline documentation with JSDoc comments
- **Build process**: Reliable, fast builds with proper dependency management

### Signal K Standards Compliance
- **95% compliance** with Signal K plugin development standards
- Follows [Signal K Plugin Guidelines](https://demo.signalk.org/documentation/Developing/Plugins.html)
- Implements [Configuration Schema Standards](https://demo.signalk.org/documentation/Developing/Plugins/Configuration.html)
- Adheres to [Weather Provider Patterns](https://demo.signalk.org/documentation/Developing/Plugins/Weather_Providers.html)
- **Note**: Humidity output as percentage (0-100) for Garmin compatibility instead of ratio (0-1)

### Repository Information
- **GitHub**: https://github.com/NearlCrews/signalk-virtual-weather-sensors
- **NPM Package**: signalk-virtual-weather-sensors
- **Display Name**: Signal K Virtual Weather Sensors

---

**For technical support and feature requests, please visit the GitHub repository.**
