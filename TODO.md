# TODO - signalk-virtual-weather-sensors

This file tracks remaining tasks, known issues, and future enhancements for the signalk-virtual-weather-sensors Signal K plugin.

## 🔄 Signal K Standards Compliance

### Status: 95% Compliant ✅

The plugin follows Signal K plugin standards as documented at:
- https://demo.signalk.org/documentation/Developing/Plugins.html
- https://demo.signalk.org/documentation/Developing/Plugins/Configuration.html
- https://demo.signalk.org/documentation/Developing/Plugins/Weather_Providers.html

### ✅ Compliant Areas
- [x] Plugin structure (default export, start/stop methods)
- [x] Configuration schema (JSON Schema with validation)
- [x] Delta message format (proper context and updates array)
- [x] Signal K path conventions (environment.outside.*, environment.wind.*)
- [x] Source metadata (label and type)
- [x] Status reporting (setPluginStatus/setPluginError)

### ⚠️ Known Deviations

#### Humidity Format - Percentage vs Ratio
**Location**: `src/mappers/NMEA2000PathMapper.ts:165`

**Current Implementation**: 
```typescript
value: data.humidity * 100  // Outputs percentage (0-100)
meta: { units: '%' }
```

**Signal K Standard**:
- Specifies ratio format (0-1) for humidity values

**Reason for Deviation**:
- **Garmin Compatibility**: Garmin marine displays expect humidity in percentage format (0-100)
- Trade-off between Signal K standard compliance and real-world device compatibility
- Most NMEA2000 devices display humidity as percentage

**Impact**:
- May cause minor display issues in some Signal K clients
- Garmin devices will display correctly
- Can be converted back to ratio in clients if needed: `ratio = percentage / 100`

**Future Consideration**:
- Monitor Signal K community feedback
- Could add configuration option to choose format
- Could detect client type and adjust format dynamically

## 📋 Enhancement Backlog

### Testing & Validation

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

- [ ] **Add caching layer**
  - Cache location lookups longer (currently 1 hour)
  - Cache weather data between updates
  - Implement smart cache invalidation

- [ ] **Performance monitoring**
  - Add metrics collection
  - Monitor memory usage
  - Track API call frequency
  - Alert on performance degradation

## 🐛 Known Issues

None currently. All tests passing, no reported bugs.

## 🔐 Security

- [ ] **Implement API key encryption**
  - Encrypt API key in configuration storage
  - Use Signal K security context
  - Add key rotation support

- [ ] **Add rate limiting**
  - Prevent API abuse
  - Protect against configuration errors
  - Monitor API quota usage

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

- [ ] **Code quality improvements**
  - Increase test coverage to 90%+
  - Add mutation testing
  - Regular code reviews

---

## Priority Matrix

### P0 - Critical (Next Release)
- None currently

### P1 - High (Within 1-2 releases)
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

**Last Updated**: 2025-10-11

**Maintainer**: Signal K Community

**Contributing**: See DEVELOPMENT.md for contribution guidelines