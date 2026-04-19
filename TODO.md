# TODO - signalk-virtual-weather-sensors

This file tracks remaining tasks, known issues, and future enhancements for the signalk-virtual-weather-sensors Signal K plugin.

## 🔄 Signal K Standards Compliance

### Status: 100% Compliant ✅

The plugin uses official `@signalk/server-api` types and follows Signal K plugin standards as documented at:
- https://demo.signalk.org/documentation/Developing/Plugins.html
- https://demo.signalk.org/documentation/Developing/Plugins/Configuration.html
- https://demo.signalk.org/documentation/Developing/Plugins/Weather_Providers.html

### ✅ Compliant Areas
- [x] **Official Types**: Uses `Plugin` and `ServerAPI` from `@signalk/server-api`
- [x] Plugin structure (default export, start/stop methods)
- [x] Configuration schema (JSON Schema with validation)
- [x] Delta message format (proper context and updates array)
- [x] Signal K path conventions (environment.outside.*, environment.wind.*)
- [x] Source metadata -- stamped automatically via `app.handleMessage(pluginId, …)` (no explicit `source` literal)
- [x] Status reporting (setPluginStatus / setPluginError)

### ⚠️ Known Deviations

_None as of v1.2.2._ The previous percentage-vs-ratio humidity deviation was resolved in v1.2.2: `environment.outside.humidity` is now emitted as a ratio (0--1) per Signal K spec, with the duplicate `relativeHumidity` path removed.

## 📋 Enhancement Backlog

### Testing & Validation

- [x] **Comprehensive unit test coverage** *(v1.2.2)*
  - ✅ WeatherService tests (24 tests) - initialization, lifecycle, data emission
  - ✅ SignalKService tests (40 tests) - position, speed, course, heading, caching
  - ✅ AccuWeatherService tests (17 tests, +1 skipped) - API integration, retry, validation
  - ✅ WindCalculator tests (45 tests) - vector math, edge cases (negative angles, NaN)
  - ✅ NMEA2000PathMapper tests (15 tests) - delta build, sanitization
  - ✅ utils/conversions tests (48 tests) - all conversions + edge cases *(new in v1.2.2)*
  - ✅ utils/validation tests (53 tests) - sanitize, validators, response schema *(new in v1.2.2)*
  - ✅ Total: 241 tests across 7 test files (coverage: 81.9% stmts, 90.75% funcs)

- [ ] **Add delta message format validation tests**
  - Unit tests to verify proper Signal K delta structure
  - Test all path mappings against Signal K specification
  - Validate metadata format

- [ ] **Test with real Signal K server**
  - Install on actual Signal K server instance
  - Verify paths appear in data browser
  - Test NMEA2000 network integration
  - Validate with Garmin displays

- [ ] **Add integration tests**
  - End-to-end testing with AccuWeather API
  - Test error handling and recovery
  - Performance testing under load

### Documentation

- [ ] **Create comprehensive example configurations**
  - Different vessel types (sailboat, powerboat, etc.)
  - Various geographic locations
  - Different update frequencies

- [ ] **Add troubleshooting guide**
  - Common issues and solutions
  - API key problems
  - Network connectivity issues
  - Data display problems

- [ ] **Create video tutorials**
  - Installation walkthrough
  - Configuration guide
  - NMEA2000 network setup

### Features

- [ ] **Additional weather data sources**
  - OpenWeather API support
  - NOAA API integration
  - Weather underground support
  - Fallback between sources

- [ ] **Weather alerting system**
  - Configurable alert thresholds
  - Push notifications
  - Email alerts
  - Integration with Signal K notifications

- [ ] **Historical data storage**
  - Database integration
  - Trend analysis
  - Export capabilities
  - Data visualization

- [ ] **Web UI for configuration**
  - Modern React-based interface
  - Real-time data preview
  - Configuration wizard
  - Data visualization dashboard

### Performance

- [ ] **Optimize bundle size**
  - Review dependencies for tree-shaking opportunities
  - Consider lazy loading for optional features
  - Target: <100KB bundle

- [x] **Add caching layer** *(v1.1.0)*
  - ✅ Cache location lookups with 2-hour max age
  - ✅ Automatic cache pruning (every 5 minutes)
  - ✅ LRU-style eviction with 100 entry max
  - [ ] Cache weather data between updates

- [x] **Performance monitoring** *(removed in v1.2.0)*
  - `MetricsCollector` and `createPluginMetrics` were removed in v1.2.0 -- they were never imported by any production code (332 lines of dead instrumentation). To re-add observability, prefer Signal K server's built-in metrics or a lightweight per-call timer instead.

## 🐛 Known Issues

- **Branch coverage at 78.06%** -- below the documented 80% threshold (concentrated in `WeatherService.ts` error paths). Vitest currently treats the threshold as advisory; tightening the test suite is tracked under "Code quality improvements" below.

## 🔐 Security

- [ ] **Implement API key encryption**
  - Encrypt API key in configuration storage
  - Use Signal K security context
  - Add key rotation support

- [x] **Add rate limiting support** *(v1.1.0, refined in v1.2.2)*
  - ✅ Retry-After header parsing for 429/503 responses
  - ✅ Linear backoff fallback when header is absent
  - ✅ Polling jitter (±10%) to prevent synchronized requests
  - [ ] Monitor API quota usage dashboard

- [x] **API key protection** *(v1.1.0, hardened in v1.2.2)*
  - ✅ Automatic log sanitization (filters apikey, password, secret, token)
  - ✅ Enhanced API key validation (length, format, placeholder detection)
  - ✅ Schema-level `minLength: 20` enforcement *(v1.2.2)*
  - [ ] Encrypt API key in configuration storage

- [x] **AccuWeather response trust boundary** *(v1.2.2)*
  - ✅ `validateAccuWeatherResponse()` runs before downstream transforms
  - ✅ 1 MiB response body cap (Content-Length pre-check + post-read recheck)
  - ✅ `locationKey` regex validation before URL interpolation

## 📦 Distribution

- [ ] **Publish to npm**
  - Prepare package for npm registry
  - Set up automated publishing via GitHub Actions
  - Create release tags

- [ ] **Submit to Signal K App Store**
  - Prepare appstore metadata
  - Create screenshots
  - Write detailed description
  - Submit for review

## 🤝 Community

- [ ] **Create GitHub Discussions**
  - Setup Q&A section
  - Feature requests area
  - Show and tell for user implementations

- [ ] **Create example projects**
  - Sample Signal K server configurations
  - Integration examples
  - Custom display examples

## 📊 Metrics & Analytics

- [ ] **Usage analytics** (opt-in)
  - Track popular features
  - Monitor error rates
  - Understand usage patterns

- [ ] **Performance benchmarks**
  - Publish performance metrics
  - Compare with other weather plugins
  - Track improvements over time

## 🔄 Continuous Improvement

- [ ] **Setup dependency updates**
  - Configure Dependabot
  - Automate security patches
  - Regular dependency reviews

- [x] **Code quality improvements** *(v1.1.0, expanded v1.2.2)*
  - ✅ Increased test coverage (241 tests; 81.9% stmts, 90.75% funcs)
  - ✅ Enhanced logger with Signal K UI integration; errors now route to `app.error`
  - ✅ Logger sanitizes API keys at all levels
  - [ ] Increase branch coverage above 80% (currently 78.06%, gaps in WeatherService error paths)
  - [ ] Add mutation testing

---

## Priority Matrix

### P0 - Critical (Next Release)
- None currently

### P1 - High (Within 1-2 releases)
- ~~Add comprehensive test coverage~~ *(Completed v1.1.0)*
- Add delta message format validation tests
- Test with real Signal K server
- Publish to npm

### P2 - Medium (Future releases)
- Additional weather data sources
- Weather alerting system
- Web UI for configuration

### P3 - Low (Nice to have)
- Video tutorials
- Usage analytics
- Community features

---

**Last Updated**: 2026-04-19

**Maintainer**: Signal K Community

**Contributing**: See DEVELOPMENT.md for contribution guidelines