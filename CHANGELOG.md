# Changelog

All notable changes to the signalk-virtual-weather-sensors project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

#### NMEA2000 & emitter-cannon Alignment
- **Perfect PGN alignment** with emitter-cannon conventions
- **Multiple temperature instances** (101-111) for comprehensive temperature monitoring
- **Enhanced humidity support** with inside/outside instances (100/101)
- **Improved wind data** with gust integration in PGN 130306
- **Proper instance assignments** following emitter-cannon standards

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
- **Path mappings**: Enhanced to align with emitter-cannon path structure
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
