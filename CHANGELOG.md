# Changelog

All notable changes to the signalk-virtual-weather-sensors project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.3] - 2026-05-09

6-agent codebase-wide cleanup pass following the 12-agent pass in v1.3.2. Findings were verified against the live Signal K master schema and the installed `@signalk/server-api` 2.24 `.d.ts`, not from memory. No public Signal K path or delta-shape changes; no configuration changes.

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

## [1.3.2] - 2026-05-09

12-agent codebase-wide cleanup pass following the Signal K spec compliance work in v1.3.1. No public API changes beyond the dead-export removal listed below; configuration shape unchanged. Fixes a real correctness issue (Magnus formula constant mismatch), adds defensive optional-chaining for free-tier AccuWeather responses, and bounds the error-body read previously bypassed on 4xx/5xx responses.

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

- Doc-vs-code audit fixed several stale claims: clone URL pointed at the `signalk` org instead of `NearlCrews`; `npm run build:deploy` was a phantom script; `Node.js 20.0.0 or higher` understated the actual `>=20.18` floor; AccuWeather test count claimed "+1 skipped" but no skipped tests remain.
- Test file diagram in DEVELOPMENT.md expanded from 3 entries to all 7.
- TODO known-issues section reset (branch coverage moved above threshold).

## [1.3.1] - 2026-05-09

Signal K 1.8.2 spec compliance + ServerAPI hygiene pass. Driven by a 3-agent audit (spec / plugin lifecycle / signalk-server runtime) plus a 3-agent `/simplify` review. **Includes path renames that change the wire output**, so consumers reading the previous path strings must update.

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

## [1.3.0] - 2026-05-05

Toolchain modernization plus a 12-agent simplify pass. No breaking runtime behavior; configuration shape is unchanged. Minor-version bump because the toolchain floor (TypeScript 6, Node 20.18) and the Signal K paths emitted have both shifted in observable ways.

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

## [1.2.3] - 2026-05-03

12-agent code-review pass with no public-API changes. Findings spanned reuse, code quality, efficiency, security, reliability, and the test suite; everything actionable landed (including low-priority items).

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

## [1.2.2] - 2026-04-19

Audit-driven patch release: a 5-expert review pass caught a number of Signal K spec violations, security gaps, and correctness bugs. All findings landed; no public configuration changes.

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

## [1.1.0] - 2026-01-20

### 🚀 Added

#### Test Coverage
- **WeatherService.test.ts**: 25 comprehensive tests covering initialization, lifecycle management, data emission, and configuration validation
- **SignalKService.test.ts**: 40 tests for vessel navigation data retrieval including position, speed, course, heading, caching, and health status
- Total test count increased from 85 to 150 tests

#### Security & Reliability
- **API key log sanitization**: Automatic filtering of sensitive keys (apikey, password, secret, token) from log output
- **Retry-After header support**: Respects server rate limit headers for 429 and 503 responses
- **Exponential backoff**: Falls back to exponential backoff when Retry-After header not present
- **Polling jitter**: ±10% random variation on update intervals to prevent synchronized API requests

### 🔄 Changed

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

### 📝 Documentation

#### Documented Performance Thresholds
- `WEATHER_UPDATE` (5000ms): Based on AccuWeather API typical response times (1-3 seconds)
- `WIND_CALCULATION` (100ms): Vector calculations should complete in <10ms
- `DATA_EMISSION` (1000ms): Delta message creation and Signal K emission
- Memory thresholds: 50MB warning, 100MB critical
- All thresholds now include detailed JSDoc explaining rationale

### 🛠 Technical Improvements

- **Official Signal K types**: Uses `Plugin` and `ServerAPI` from `@signalk/server-api` for maximum compatibility
- **TypeScript 5.9+**: Updated all version references in documentation
- **Vitest 4.x**: Updated testing framework with improved coverage
- **Biome 2.3+**: Updated linting and formatting tooling

### 🐛 Fixed

- Fixed unused import warnings in test files
- Fixed `Math.pow()` usage replaced with `**` operator per linting rules
- Fixed TypeScript strict mode issues with optional properties
- Resolved all Biome linting warnings

## [1.0.1] - 2025-10-13

### 🐛 Fixed

#### CI/CD
- **GitHub Actions Permissions**: Added missing `contents:read` and `issues:write` permissions to `security-audit` job in dependency-updates workflow
- Resolved "Resource not accessible by integration" error that prevented automated security issue creation
- Fixed CI failures in the dependency-updates workflow

## [1.0.0] - 2025-10-03

### 🎉 Initial Release - Modern TypeScript Signal K Weather Plugin

First production release of signalk-virtual-weather-sensors - a comprehensive weather data plugin for Signal K servers with NMEA2000 compatibility and AccuWeather API integration.

### 🚀 Added

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

#### NMEA2000 & `signalk-nmea2000-emitter-cannon` Alignment
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

### 🔄 Changed

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

### 🛠 Technical Improvements

#### Code Quality
- **Zero TypeScript compilation errors** across entire codebase
- **Comprehensive type coverage** with strict mode compliance
- **Modern error handling** with structured error codes and detailed logging
- **Production-ready validation** for all data types and configurations
- **Performance monitoring** with timing thresholds and resource cleanup

#### Build & Development
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

### 📊 Data Coverage Enhancement

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

### 🔧 Compatibility

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

### 🐛 Fixed

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

### 📝 Signal K Standards Compliance
- **95% compliance** with Signal K plugin development standards
- Follows [Signal K Plugin Guidelines](https://demo.signalk.org/documentation/Developing/Plugins.html)
- Implements [Configuration Schema Standards](https://demo.signalk.org/documentation/Developing/Plugins/Configuration.html)
- Adheres to [Weather Provider Patterns](https://demo.signalk.org/documentation/Developing/Plugins/Weather_Providers.html)
- **Note**: Humidity output as percentage (0-100) for Garmin compatibility instead of ratio (0-1)

### 🔗 Repository Information
- **GitHub**: https://github.com/NearlCrews/signalk-virtual-weather-sensors
- **NPM Package**: signalk-virtual-weather-sensors
- **Display Name**: Signal K Virtual Weather Sensors

---

**For technical support and feature requests, please visit the GitHub repository.**
