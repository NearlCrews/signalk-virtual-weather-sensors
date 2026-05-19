# Signal K Virtual Weather Sensors Plugin

[![npm version](https://img.shields.io/npm/v/signalk-virtual-weather-sensors.svg)](https://www.npmjs.com/package/signalk-virtual-weather-sensors)
[![npm downloads](https://img.shields.io/npm/dm/signalk-virtual-weather-sensors.svg)](https://www.npmjs.com/package/signalk-virtual-weather-sensors)
[![License](https://img.shields.io/github/license/NearlCrews/signalk-virtual-weather-sensors.svg)](https://github.com/NearlCrews/signalk-virtual-weather-sensors/blob/main/LICENSE)
[![CI](https://github.com/NearlCrews/signalk-virtual-weather-sensors/actions/workflows/ci.yml/badge.svg)](https://github.com/NearlCrews/signalk-virtual-weather-sensors/actions/workflows/ci.yml)

Fetches weather data for your vessel's current position from the AccuWeather
API and emits it as Signal K deltas: 24+ environmental data points including
temperatures, wind, atmospheric conditions, and marine safety indices. Paths
follow the [Signal K 1.8.2 specification](https://signalk.org/specification/1.8.2/doc/)
and align with NMEA2000 emission via a companion plugin. A free AccuWeather API
key is required.

## What's New in v1.6.1

A bug-fix release. A 12-issue review pass corrected silent failures and
incorrect logic across the AccuWeather client, the orchestration layer, the
notification formatter, and the Admin UI config panel: partial API responses
now fail validation with a tagged error instead of crashing, a missing cloud
cover reading is omitted rather than reported as a real "clear sky" 0, and a
transient 403 no longer disables the plugin permanently. The config panel save
flow reports honestly when a restart cannot be confirmed. There is no change
to the delta envelope or the notification value shape, and all 259 tests pass.

See the [Changelog](CHANGELOG.md#161---2026-05-19) for the full Fixed /
Changed detail, or the
[GitHub release](https://github.com/NearlCrews/signalk-virtual-weather-sensors/releases/tag/v1.6.1).

## Features

- 24+ weather data points: temperatures, wind, pressure, humidity, UV,
  visibility, cloud cover, and precipitation
- Spec-compliant Signal K paths, with AccuWeather extensions and derived values
  on a producer-namespaced `environment.weather.*` branch
- Apparent wind calculated from true wind and vessel motion
- Severe-weather notifications (opt-in, off by default) for wind, visibility,
  heat, cold, and severe conditions
- React config panel in the Admin UI with a live status card and inline API
  key test, with a JSON-schema form fallback for older Admin UIs
- NMEA2000 path alignment for bridging via a companion emitter plugin
- `$source: 'accuweather'` on every delta, so real onboard sensors can win on
  source priority

## Requirements

- Signal K server 2.0.0 or newer
- A free AccuWeather API key from [developer.accuweather.com](https://developer.accuweather.com/)
- A GPS position published on `navigation.position` (the plugin queries
  AccuWeather for the vessel's current location)

## Installation

Install from the Signal K Admin UI under **Appstore -> Available**, or from npm:

```bash
npm install signalk-virtual-weather-sensors
```

From source:

```bash
git clone https://github.com/NearlCrews/signalk-virtual-weather-sensors.git
cd signalk-virtual-weather-sensors
npm install
npm run build
ln -s "$(pwd)" ~/.signalk/node_modules/signalk-virtual-weather-sensors
```

## Configuration

Configure in the Signal K Admin UI under **Server -> Plugin Config**.

| Setting | Description | Default | Range |
|---------|-------------|---------|-------|
| AccuWeather API Key | Required. Free key from AccuWeather. | n/a | n/a |
| Update Frequency | Minutes between weather fetches. The default 30 uses 48 calls/day, inside the free-tier 50/day cap. | 30 | 1 to 60 |
| Emission Interval | Seconds between delta emissions to the NMEA2000 network. | 5 | 1 to 60 |
| Daily API Call Quota | Cap on AccuWeather calls per rolling 24h window. 0 disables the cap. | 50 | 0 to 1000 |
| Severe-weather notifications | Master toggle plus per-category sub-toggles (wind, visibility, heat, cold, severe). | master off, sub-toggles on | boolean |

## What it emits

The plugin emits 24+ data points under three namespaces: canonical
`environment.outside.*` and `environment.wind.*` paths from the Signal K 1.8.2
vocabulary, plus a producer-namespaced `environment.weather.*` branch for
AccuWeather extensions and plugin-derived values (Beaufort scale, heat stress,
and more). A one-shot meta delta on start describes units and labels for the
non-canonical paths.

See [docs/signal-k-paths.md](docs/signal-k-paths.md) for the full path, PGN,
and notification reference.

## NMEA2000 integration

This plugin outputs Signal K deltas only. To bridge them onto a physical
NMEA2000 bus, pair it with an emitter plugin such as
[`signalk-nmea2000-emitter-cannon`](https://github.com/NearlCrews/signalk-nmea2000-emitter-cannon),
which covers PGNs 130306, 130311, 130312, and 130313. See
[docs/signal-k-paths.md](docs/signal-k-paths.md#nmea2000-pgn-coverage) for
per-PGN path mapping.

## Notifications

Severe-weather notifications under `notifications.environment.*` are opt-in and
off by default. When enabled, the plugin emits one Signal K notification per
hazard band transition (entry and exit) across wind, visibility, heat, cold,
and severe-condition categories. Each message packs actionable context (for
example `Gale-force wind: Bf9 from SW, 19 m/s, gusts 27 m/s, 998 hPa`).
Bridging to NMEA 2000 Alert PGNs requires the separate `signalk-to-nmea2000`
plugin. See [docs/signal-k-paths.md](docs/signal-k-paths.md#notifications) for
the full band, trigger, and message reference.

## Troubleshooting

Common issues, shown as a status banner in the Admin UI:

- **Invalid API key (HTTP 401)**: re-copy the key from AccuWeather with no
  surrounding whitespace.
- **Rate limit / quota reached**: raise `updateFrequency` or `dailyApiQuota`;
  the free tier allows 50 calls/day.
- **No position available**: confirm a GPS source publishes
  `navigation.position` in the Data Browser.

See [docs/troubleshooting.md](docs/troubleshooting.md) for the full guide.

## Documentation

- [Signal K paths, PGNs, and notifications](docs/signal-k-paths.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Changelog](CHANGELOG.md)

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for
development setup, coding standards, and the pull request process. By taking
part you agree to the [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## License

Apache-2.0: see [LICENSE](LICENSE).

## Support

- [Report a bug](https://github.com/NearlCrews/signalk-virtual-weather-sensors/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/NearlCrews/signalk-virtual-weather-sensors/issues/new?template=feature_request.yml)
- [Security issues](.github/SECURITY.md)
