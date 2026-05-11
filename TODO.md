# TODO - signalk-virtual-weather-sensors

Remaining tasks, known issues, and future enhancements. Items already shipped
are tracked in [CHANGELOG.md](CHANGELOG.md), not here.

## Signal K Standards Compliance

Status: Aligned with Signal K 1.8.2 (v1.4.0). Reference docs:

- https://signalk.org/specification/1.8.2/doc/
- https://demo.signalk.org/documentation/Developing/Plugins.html
- https://demo.signalk.org/documentation/Developing/Plugins/Weather_Providers.html

Known deviations: none tracked.

## P1 - High (next 1-2 releases)

- [x] **Delta message format validation tests** *(in progress this session)*
  - Unit tests assert proper Signal K delta structure, all path mappings,
    and metadata format. See `src/__tests__/mappers/`.
- [x] **Manual server smoke test guide** *(in progress this session)*
  - Step-by-step verification on a real Signal K server: data browser paths,
    NMEA2000 bridging, Garmin display checks. See `docs/`.
- [x] **End-to-end integration smoke test** *(in progress this session)*
  - Mocked AccuWeather + real plugin lifecycle, asserts deltas reach
    `app.handleMessage`. See `src/__tests__/`.
- [x] **WeatherProvider API spike** *(in progress this session)*
  - Evaluate migrating to `@signalk/server-api`'s `WeatherProvider` API
    as the canonical home for AccuWeather data (future major version,
    see CHANGELOG 1.4.0 "Future direction"). See `docs/`.

## P2 - Medium (future releases)

- [ ] **Additional weather data sources**
  - OpenWeather, NOAA, Weather Underground; fallback chain across providers.
  - Likely lands behind the `WeatherProvider` migration above.

- [ ] **Weather alerting system**
  - Configurable thresholds, integration with Signal K notifications,
    optional email/push fan-out.

- [ ] **Encrypt the API key in configuration storage**
  - Use Signal K's security context. Today the key sits in plaintext in
    `~/.signalk/plugin-config-data/`.
  - Add key rotation support.

- [ ] **API quota usage dashboard**
  - Surface `getRequestCount()` and per-day call estimate in the status
    banner so free-tier operators don't silently exceed their quota.

## P3 - Low (nice to have)

- [ ] **Signal K App Store submission**
  - Prepare appstore metadata, screenshots, description; submit for review.

- [ ] **Mutation testing**
  - Stryker against the calculator + validator modules to confirm the
    217 unit tests actually catch logic regressions.

## Known Issues

None tracked. Branch coverage held above the 80% threshold through v1.4.0.

## Security (compliant baseline, see CHANGELOG)

- [x] Rate-limit handling with `Retry-After` parsing and linear backoff *(v1.1.0, refined v1.2.2)*
- [x] API key sanitization in logs and schema-level `minLength: 20` enforcement *(v1.2.2)*
- [x] AccuWeather response trust boundary: schema validation, 1 MiB body cap, location-key regex *(v1.2.2)*
- [x] `noFloatingPromises` and `noMisusedPromises` enabled in Biome *(v1.3.3)*

The remaining security item (encryption at rest) is tracked under P2 above.

## Continuous Improvement

- [x] **Dependabot configured** for npm + GitHub Actions, weekly cadence *(this session, see `.github/dependabot.yml`)*
- [x] **Code quality baseline** *(v1.1.0 onwards)*
  - 217 tests across 10 files (v1.4.0 + Unreleased; baseline 206/8)
  - debug/info routed through `app.debug`; warn/error through `app.error`
    so they appear in production logs without enabling DEBUG *(v1.3.3)*
  - `toErrorMessage(error)` helper consolidates 19 sites *(v1.3.2)*

---

**Last Updated**: 2026-05-10

**Maintainer**: Signal K Community

**Contributing**: see [CONTRIBUTING.md](CONTRIBUTING.md)
