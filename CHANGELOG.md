# Changelog

All notable changes to the signalk-virtual-weather-sensors project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
