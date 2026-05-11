# TODO - signalk-virtual-weather-sensors

This file tracks remaining tasks, known issues, and future enhancements for the signalk-virtual-weather-sensors Signal K plugin.

## 🔄 Signal K Standards Compliance

### Status: Aligned with Signal K 1.8.2 (v1.4.0)

The plugin uses official `@signalk/server-api` 2.24+ types and follows Signal K plugin standards as documented at:
- https://signalk.org/specification/1.8.2/doc/ (data model and vocabulary)
- https://demo.signalk.org/documentation/Developing/Plugins.html (plugin developer guide)
- https://demo.signalk.org/documentation/Developing/Plugins/Configuration.html
- https://demo.signalk.org/documentation/Developing/Plugins/Weather_Providers.html

### ✅ Compliant Areas
- [x] **Official Types**: uses `Plugin`, `ServerAPI`, `Delta`, `Path`, `PathValue`, `Context`, `Timestamp`, `Meta`, `MetaValue`, `SourceRef`, `SKVersion` from `@signalk/server-api` 2.24+
- [x] Plugin structure (default export, start/stop methods)
- [x] Configuration schema (JSON Schema with validation)
- [x] Delta message format (proper context, updates array, values/meta XOR)
- [x] **Canonical Signal K paths** under canonical containers per the 1.8.2 vocabulary: `environment.outside.{temperature,pressure,relativeHumidity,dewPointTemperature,apparentWindChillTemperature,heatIndexTemperature,airDensity}` and `environment.wind.{speedOverGround,directionTrue,speedApparent,angleApparent}`
- [x] **Producer-namespaced extensions** under `environment.weather.*` (16 leaves: AccuWeather observations like UV, visibility, cloud cover, plus plugin-derived Beaufort scale, gust factor, heat stress index). Keeps canonical containers leaf-only as the spec requires *(restructured in v1.4.0; previously misnamed `environment.{outside,wind}.derived.*`)*
- [x] **Explicit `$source: 'accuweather'`** on every update so users can configure source priorities to prefer real onboard sensors
- [x] **One-shot meta delta** on plugin start so the Admin UI / Instrument Panel can render units and labels for non-canonical paths. Shipped after the first values delta (admin-UI rendering workaround, not a spec ordering requirement).
- [x] **`SKVersion.v1`** passed to `app.handleMessage` so v1/v2 routing is explicit
- [x] Status reporting (`setPluginStatus` / `setPluginError`) with stale-data recovery flag in `emitWeatherTick`. Banner string includes live counters (last-update age + update count) via `WeatherService.formatStatusBanner()` *(v1.4.0)*
- [x] **`directionTrue` true-north convention** verified against the WMO surface-wind standard (Guide to Meteorological Instruments WMO-No. 8); rationale pinned in `AccuWeatherService.transformWeatherData` *(v1.4.0)*

### ⚠️ Known Deviations

None tracked.

## 📋 Enhancement Backlog

### Testing & Validation

- [x] **Comprehensive unit test coverage** *(v1.2.2)*
  - ✅ WeatherService tests (21 tests): initialization, lifecycle, data emission
  - ✅ SignalKService tests (40 tests): position, speed, course, heading, caching
  - ✅ AccuWeatherService tests (22 tests): API integration, retry, validation, error paths (403/429/503/RESPONSE_TOO_LARGE)
  - ✅ WindCalculator tests (34 tests): vector math, edge cases (negative angles, NaN)
  - ✅ NMEA2000PathMapper tests (16 tests): delta build, sanitization, one-shot meta delta, `environment.weather.*` path assertions
  - ✅ utils/conversions tests (32 tests): all conversions plus edge cases *(new in v1.2.2)*
  - ✅ utils/validation tests (37 tests): sanitize, validators, response schema *(new in v1.2.2)*
  - ✅ index.ts tests (4 tests): plugin lifecycle and meta-delta one-shot invariant *(new in v1.3.3)*
  - ✅ Total: 206 tests across 8 test files (v1.4.0 mapper tests rewritten to assert the new `environment.weather.*` paths; total unchanged)

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
  - `MetricsCollector` and `createPluginMetrics` were removed in v1.2.0: they were never imported by any production code (332 lines of dead instrumentation). To re-add observability, prefer Signal K server's built-in metrics or a lightweight per-call timer instead.

## 🐛 Known Issues

_None tracked. Branch coverage held above the 80% threshold through v1.4.0._

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

- [x] **Code quality improvements** *(v1.1.0 onwards)*
  - ✅ Test coverage at 206 tests across 8 files
  - ✅ debug/info routed through `app.debug`; warn/error routed through `app.error` so they appear in production logs without enabling DEBUG. Plugin-level error STATUS still goes to `app.setPluginError` separately. *(v1.3.3)*
  - ✅ Logger sanitizes API keys at all levels
  - ✅ `toErrorMessage(error)` helper consolidates 19 sites of `error instanceof Error ? error.message : String(error)` *(v1.3.2)*
  - ✅ Biome `noFloatingPromises` and `noMisusedPromises` enabled to catch unawaited async paths *(v1.3.3)*
  - [ ] Add mutation testing

---

## Priority Matrix

### P0 - Critical (Next Release)
- None currently

### P1 - High (Within 1-2 releases)
- ~~Add comprehensive test coverage~~ *(Completed v1.1.0)*
- ~~Publish to npm~~ *(Completed: package published; release workflow in `.github/workflows/publish.yml`)*
- Add delta message format validation tests
- Test with real Signal K server
- Evaluate migrating to `@signalk/server-api`'s `WeatherProvider` API as the canonical home for AccuWeather data (future major version, see CHANGELOG 1.4.0 "Future direction")

### P2 - Medium (Future releases)
- Additional weather data sources
- Weather alerting system
- Web UI for configuration

### P3 - Low (Nice to have)
- Video tutorials
- Usage analytics
- Community features

---

**Last Updated**: 2026-05-10

**Maintainer**: Signal K Community

**Contributing**: See DEVELOPMENT.md for contribution guidelines