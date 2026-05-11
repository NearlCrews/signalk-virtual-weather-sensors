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

- [x] **Encrypt the API key in configuration storage** *(spike, closed not-applicable this session)*
  - Investigated 2026-05-10. Signal K has no plugin-facing secrets API,
    peer plugins (`signalk-aisstream`, `signalk-windy-plugin`,
    `signalk-weatherflow`) all store keys in plaintext, and this plugin
    already does the meaningful hardening: `'ui:widget': 'password'`,
    log redaction via `SENSITIVE_LOG_KEY_PATTERN`, and schema
    `minLength: 20`. On a single-user appliance, encryption-at-rest
    without an external key store is theatre. Spike write-up:
    [`docs/api-key-storage.md`](docs/api-key-storage.md). Re-open only if
    one of the trigger conditions in that doc fires.

- [x] **API quota usage dashboard** *(this session)*
  - New `dailyApiQuota` config option (default 50, range 0 to 1000; 0 disables).
    Rolling 24h request counter via `AccuWeatherService.getRequestCountLast24h()`.
    Status banner gains `, K/Q today` suffix. At 90% the prefix switches to
    `Running [quota 90% used]`; at 100% the plugin trips `setPluginError` and
    skips fetches via `WeatherService.isQuotaExhausted()` until usage drops.

## P3 - Low (nice to have)

- [x] **Signal K App Store submission** *(verified live 2026-05-10)*
  - No submission step exists: the App Store auto-discovers any npm package
    with the `signalk-node-server-plugin` keyword. Verified on 2026-05-10 that
    `signalk-virtual-weather-sensors@1.3.2` is returned by the same npm search
    the server uses, listed under the "Weather" category. The next release
    (1.4.0) adds `signalk-category-nmea-2000` for a second listing. See
    `docs/app-store-status.md` for the verification details and a
    reproducible curl check.

- [x] **Mutation testing** *(this session)*
  - Stryker.js 9.6 added as a dev-only dependency (NOT in CI). One-shot pass
    raised the mutation score on `WindCalculator` from 57.96% to 74.34% and
    on `conversions` from 86.39% to 94.67%; 8 new tests killed 56 mutants.
    Future runs: `npm run mutation-test`. Config: `stryker.conf.json`.

## Known Issues

None tracked. Branch coverage held above the 80% threshold through v1.4.0.

## Security (compliant baseline, see CHANGELOG)

- [x] Rate-limit handling with `Retry-After` parsing and linear backoff *(v1.1.0, refined v1.2.2)*
- [x] API key sanitization in logs and schema-level `minLength: 20` enforcement *(v1.2.2)*
- [x] AccuWeather response trust boundary: schema validation, 1 MiB body cap, location-key regex *(v1.2.2)*
- [x] `noFloatingPromises` and `noMisusedPromises` enabled in Biome *(v1.3.3)*
- [x] API-key encryption-at-rest spike, closed not-applicable: see [`docs/api-key-storage.md`](docs/api-key-storage.md) *(this session)*

## Continuous Improvement

- [x] **Dependabot configured** for npm + GitHub Actions, weekly cadence *(this session, see `.github/dependabot.yml`)*
- [x] **Code quality baseline** *(v1.1.0 onwards)*
  - 234 tests across 10 files (v1.4.0 + Unreleased; baseline 206/8)
  - Mutation score 67.44% across the pure-function modules (calculators + utils);
    `WindCalculator` 74%, `conversions` 95%, `validation` 57%
  - debug/info routed through `app.debug`; warn/error through `app.error`
    so they appear in production logs without enabling DEBUG *(v1.3.3)*
  - `toErrorMessage(error)` helper consolidates 19 sites *(v1.3.2)*

---

**Last Updated**: 2026-05-10

**Maintainer**: Signal K Community

**Contributing**: see [CONTRIBUTING.md](CONTRIBUTING.md)
