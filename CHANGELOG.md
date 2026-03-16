# Changelog

All notable changes to the signalk-virtual-weather-sensors project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-03-16

### 💥 Breaking Changes

- **Wind chill path renamed**: `environment.outside.windChillTemperature` → `environment.outside.apparentWindChillTemperature` to match Signal K spec v1.7.0
- **Deprecated `environment.outside.humidity` path removed**: Use `environment.outside.relativeHumidity` instead (was already deprecated in Signal K spec)
- **Removed unused production dependencies**: `es-toolkit`, `node-fetch`, `rxjs`, `zod` — none were imported
- **Formatting**: Switched to Biome defaults (tabs, double quotes). Removed `biome.json` config file
- **Duplicate emission system removed**: `index.ts` no longer runs its own emission timer; `WeatherService` handles all emissions

### 🚀 Added

- **Official `@signalk/server-api` types**: Replaced hand-rolled `SignalKApp`, `SignalKDataValue`, `SignalKDelta` interfaces with official `ServerAPI`, `Plugin`, `Delta` types from `@signalk/server-api`
- **Weather Provider registration**: Plugin now registers as an official Signal K Weather Provider via `app.registerWeatherProvider()`, implementing `getObservations`, `getForecasts`, and `getWarnings`
- **Weather Provider adapter** (`src/providers/WeatherProviderAdapter.ts`): Converts internal weather data to the official `@signalk/server-api` `WeatherData` format
- **`fetchWeatherForPosition()`**: New public method on `WeatherService` for fetching weather at arbitrary positions
- **`Logger` type alias**: Centralized logger type replaces 12+ inline signature repetitions
- **`@extension` JSDoc annotations**: Non-standard Signal K paths are now clearly documented as plugin extensions
- **Weather Provider test suite** (`src/__tests__/providers/WeatherProviderAdapter.test.ts`)

### 🐛 Fixed

- **`sanitizeForNMEA2000` zero-value bug**: Truthy checks replaced with `!== undefined` so zero values (calm wind, north direction) are properly sanitized
- **`convertAccuWeather*` zero-value bug**: Same fix for AccuWeather converter functions rejecting valid `0` values (0°C, calm wind, north direction)
- **Beaufort scale threshold inconsistency**: Scale 9 threshold corrected to 24.5 m/s (WMO standard) in `WindCalculator` — was 25.0 m/s
- **Duplicate emission**: Removed second emission timer in `index.ts` that was causing double-publishing to NMEA2000 bus
- **Redundant vessel data calls**: `getVesselNavigationData()` now called once per emission cycle instead of 3 times
- **`getCacheStats` redundant field**: Removed `size` field that was identical to `entries`
- **`app.error()` used for errors**: Error-level log messages now use `app.error()` instead of routing through `app.debug()`

### 🔄 Changed

- **All devDependencies updated** to latest versions:
  - `@signalk/server-api`: ^2.3.0 → ^2.23.0
  - `@biomejs/biome`: ^2.2.5 → ^2.4.7
  - `@types/node`: ^22.10.2 → ^25.5.0
  - `vitest` / `@vitest/coverage-v8` / `@vitest/ui`: ^3.2.4 → ^4.1.0
  - `typescript`: ^5.7.3 → ^5.9.3
  - `esbuild`: ^0.24.2 → ^0.27.4
  - `lint-staged`: ^15.2.11 → ^16.4.0
  - `tsx`: ^4.19.2 → ^4.21.0
- **Removed optional chaining** on `app.setPluginStatus()`, `app.setPluginError()`, `app.handleMessage()` — these are non-optional in `ServerAPI`
- **Removed duplicate code**: `calculateAbsoluteHumidity`, `calculateAirDensity`, `calculateBeaufortScale`, `normalizeAngle` consolidated to single implementations
- **Removed `SignalKApp`/`SignalKDataValue`/`SignalKDelta`/`SignalKSource`/`SignalKPath`** from types — use `@signalk/server-api` exports
- **Removed redundant namespace exports** (`LegacyConverters`, `TemperatureConverter`, etc.) from `conversions.ts` and `validation.ts`
- **Location cache bounded** to 50 entries with FIFO eviction
- **Plugin entry simplified**: Removed `NMEA2000PathMapper` from `index.ts` (emission handled by `WeatherService`)
- **Test count**: 85 → 91 tests (added Weather Provider tests)

### 📝 Signal K Standards Compliance

- **Wind chill path**: Now uses spec-correct `apparentWindChillTemperature`
- **Deprecated humidity path**: Removed; only `relativeHumidity` emitted
- **Official types**: Uses `Plugin`, `ServerAPI`, `Delta` from `@signalk/server-api`
- **Weather Provider API**: Registered through official `registerWeatherProvider()`

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

#### NMEA2000 & sk-n2k-emitter Alignment
- **Perfect PGN alignment** with sk-n2k-emitter conventions
- **Multiple temperature instances** (101-111) for comprehensive temperature monitoring
- **Enhanced humidity support** with inside/outside instances (100/101)
- **Improved wind data** with gust integration in PGN 130306
- **Proper instance assignments** following sk-n2k-emitter standards

#### Modern Architecture
- **Complete TypeScript 5.3+** conversion with strict mode compliance
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
- **Dependencies**: Updated to latest versions (TypeScript 5.3+)

#### Enhanced Features
- **Data coverage**: 8 basic fields → 25+ comprehensive environmental measurements
- **Path mappings**: Enhanced to align with sk-n2k-emitter path structure
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
