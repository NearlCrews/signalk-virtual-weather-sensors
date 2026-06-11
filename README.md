# Signal K Virtual Weather Sensors Plugin

[![npm version](https://img.shields.io/npm/v/signalk-virtual-weather-sensors.svg)](https://www.npmjs.com/package/signalk-virtual-weather-sensors)
[![npm downloads](https://img.shields.io/npm/dm/signalk-virtual-weather-sensors.svg)](https://www.npmjs.com/package/signalk-virtual-weather-sensors)
[![License](https://img.shields.io/github/license/NearlCrews/signalk-virtual-weather-sensors.svg)](https://github.com/NearlCrews/signalk-virtual-weather-sensors/blob/main/LICENSE)
[![CI](https://github.com/NearlCrews/signalk-virtual-weather-sensors/actions/workflows/ci.yml/badge.svg)](https://github.com/NearlCrews/signalk-virtual-weather-sensors/actions/workflows/ci.yml)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://www.buymeacoffee.com/nearlcrews)

Fetches weather data for your vessel's current position from the AccuWeather
API and emits it as Signal K deltas: 30+ environmental data points including
temperatures, wind, atmospheric conditions, and marine safety indices. Paths
follow the [Signal K 1.8.2 specification](https://signalk.org/specification/1.8.2/doc/)
and align with NMEA2000 emission via a companion plugin. A free AccuWeather API
key is required.

## What's New in v1.8.0

A whole-codebase cleanup audit followed by a full config-panel rebuild. The
panel is now TypeScript end to end with light, dark, and night-red helm themes,
WCAG AA contrast, marine-sized touch targets, unsaved-changes tracking with
Save and Discard, and a first-run callout. Under the hood, the request timeout
now bounds the entire response instead of just the headers, overlapping weather
updates coalesce into a single fetch so quota is never double-spent, and a
daily-quota pause no longer interrupts the NMEA2000 keep-alive while cached
data is still fresh. No emitted measurement path, delta shape, or notification
band changed, and all 334 tests pass.

See the [Changelog](CHANGELOG.md#180---2026-06-11) for the full detail, or the
[GitHub release](https://github.com/NearlCrews/signalk-virtual-weather-sensors/releases/tag/v1.8.0).

## Features

- 30+ weather data points: temperatures, wind, pressure, humidity, UV,
  visibility, cloud cover, pressure tendency, precipitation type, visibility
  obstruction, and a plain-language condition summary
- Spec-compliant Signal K paths, with AccuWeather extensions and derived values
  on a producer-namespaced `environment.weather.*` branch
- Signal K v2 Weather API provider: serves AccuWeather forecasts at
  `/signalk/v2/api/weather/forecasts/point` and `.../forecasts/daily`, so
  dashboards like signalk-open-binnacle can show forecast data
- Apparent wind calculated from true wind and vessel motion
- Severe-weather notifications (opt-in, off by default) for wind, visibility,
  heat, cold, and severe conditions
- React config panel in the Admin UI with a live status dashboard, inline API
  key test, unsaved-changes tracking, and light, dark, and night-red themes,
  with a JSON-schema form fallback for older Admin UIs
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
| Broadcast Interval | Seconds between delta emissions to the NMEA2000 network. | 5 | 1 to 60 |
| Daily API Call Quota | Cap on AccuWeather calls per rolling 24h window. 0 disables the cap. | 50 | 0 to 1000 |
| Severe-weather notifications | Master toggle plus per-category sub-toggles (wind, visibility, heat, cold, severe). | master off, sub-toggles on | boolean |

## Screenshots

The React config panel in the Signal K Admin UI, with a live status card
showing update count, rolling 24h API usage, active alerts, and minutes since
the last fetch:

![Config panel: status card and fetch cadence settings](assets/screenshots/config-panel-status.png)

The severe-weather notification toggles (opt-in, off by default):

![Config panel: severe-weather notification toggles](assets/screenshots/config-panel-notifications.png)

The night-red helm theme, designed to preserve night vision at the chart table:

![Config panel: night-red theme](assets/screenshots/config-panel-night.png)

## What it emits

The plugin emits 30+ data points under three namespaces: canonical
`environment.outside.*` and `environment.wind.*` paths from the Signal K 1.8.2
vocabulary, plus a producer-namespaced `environment.weather.*` branch for
AccuWeather extensions and plugin-derived values (Beaufort scale, heat stress,
pressure tendency, precipitation type, visibility obstruction, a plain-language
condition summary, and more). A one-shot meta delta on start describes units
and labels for the non-canonical paths.

See [docs/signal-k-paths.md](docs/signal-k-paths.md) for the full path, PGN,
and notification reference.

## NMEA2000 integration

This plugin outputs Signal K deltas only. To bridge them onto a physical
NMEA2000 bus, pair it with an emitter plugin such as
[`signalk-nmea2000-emitter-cannon`](https://github.com/NearlCrews/signalk-nmea2000-emitter-cannon),
which covers PGNs 130306, 130311, 130312, and 130313. See
[docs/signal-k-paths.md](docs/signal-k-paths.md#nmea2000-pgn-coverage) for
per-PGN path mapping.

## Weather API provider

The plugin registers as a Signal K v2 Weather API provider, so consumers can
pull forecasts over REST instead of subscribing to the delta stream:

- `GET /signalk/v2/api/weather/forecasts/point` returns hourly point forecasts
  (from the AccuWeather 12-hour hourly source).
- `GET /signalk/v2/api/weather/forecasts/daily` returns daily forecasts (from
  the AccuWeather 5-day source).

Registering the provider is what makes the server list `weather` under
`/signalk/v2/features`, which is how dashboards such as
[signalk-open-binnacle](https://github.com/SignalK/signalk-open-binnacle)
detect that forecast support is available. Forecasts are mapped to SI units,
cached on demand, and share the plugin's rolling-24h API quota so a polling
client cannot exhaust a free key. Observations and warnings are not served yet.
See [docs/signal-k-paths.md](docs/signal-k-paths.md#weather-api-provider) for
the populated field reference.

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

Find this plugin useful? You can support its continued development by
[buying me a coffee](https://www.buymeacoffee.com/nearlcrews).

- [Report a bug](https://github.com/NearlCrews/signalk-virtual-weather-sensors/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/NearlCrews/signalk-virtual-weather-sensors/issues/new?template=feature_request.yml)
- [Security issues](.github/SECURITY.md)
