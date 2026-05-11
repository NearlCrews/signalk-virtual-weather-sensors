# Signal K Virtual Weather Sensors Plugin

[![npm version](https://img.shields.io/npm/v/signalk-virtual-weather-sensors.svg)](https://www.npmjs.com/package/signalk-virtual-weather-sensors)
[![npm downloads](https://img.shields.io/npm/dm/signalk-virtual-weather-sensors.svg)](https://www.npmjs.com/package/signalk-virtual-weather-sensors)
[![License](https://img.shields.io/github/license/NearlCrews/signalk-virtual-weather-sensors.svg)](https://github.com/NearlCrews/signalk-virtual-weather-sensors/blob/master/LICENSE)
[![CI](https://github.com/NearlCrews/signalk-virtual-weather-sensors/actions/workflows/ci.yml/badge.svg)](https://github.com/NearlCrews/signalk-virtual-weather-sensors/actions/workflows/ci.yml)

A Signal K plugin that fetches weather data from the AccuWeather API and emits it as Signal K deltas conforming to the [Signal K 1.8.2 specification](https://signalk.org/specification/1.8.2/doc/), with paths aligned for NMEA2000 emission via a companion plugin. Provides 24+ environmental data points including temperatures, wind, atmospheric conditions, and marine safety indices.

## Features

- **24+ weather data points** from AccuWeather: 8 temperature paths, wind (speed-over-ground, direction, gust, derived Beaufort), atmospheric conditions (pressure, relative humidity, UV, visibility, clouds), and precipitation
- **Spec-compliant Signal K paths** following the 1.8.2 vocabulary (`relativeHumidity`, `apparentWindChillTemperature`, etc.). Anything not in the 1.8.2 vocabulary (Beaufort scale, gust factor, heat stress index, AccuWeather extensions like UV, visibility, cloud cover) lives under a producer-namespaced `environment.weather.*` branch, so the canonical `environment.outside` and `environment.wind` containers hold only spec leaves and consumers walking them never trip over a non-leaf object.
- **`$source: 'accuweather'`** on every delta, so users can configure source priorities to prefer real onboard sensors over the API feed when both are present.
- **One-shot meta delta** on plugin start describing units and labels for non-canonical paths, so the Signal K Admin UI and Instrument Panel render them correctly.
- **Apparent wind calculation** from true wind + vessel motion vectors
- **NMEA2000 alignment** with [`signalk-nmea2000-emitter-cannon`](https://github.com/NearlCrews/signalk-nmea2000-emitter-cannon) PGN conventions (130306, 130311, 130312, 130313)
- **Interval-based emission** (default 5s) for reliable NMEA2000 network recognition
- **Delta caching**: only rebuilds the Signal K delta when weather data actually changes
- **Rate limit handling** with Retry-After header support and linear backoff fallback
- **Bounded responses**: 1 MiB cap on AccuWeather response bodies plus schema validation before use
- **API key sanitization** in log output

## Installation

### From npm

```bash
npm install signalk-virtual-weather-sensors
```

### From source

```bash
git clone https://github.com/NearlCrews/signalk-virtual-weather-sensors.git
cd signalk-virtual-weather-sensors
npm install
npm run build
```

Then symlink or copy into your Signal K server's plugin directory:

```bash
ln -s "$(pwd)" ~/.signalk/node_modules/signalk-virtual-weather-sensors
```

## Configuration

| Setting | Description | Default | Range |
|---------|-------------|---------|-------|
| **AccuWeather API Key** | Required. Get one free at [developer.accuweather.com](https://developer.accuweather.com/) | n/a | n/a |
| **Update Frequency** | How often to fetch new weather data (minutes) | 5 | 1 to 60 |
| **Emission Interval** | How often to emit the current data to the NMEA2000 network (seconds) | 5 | 1 to 60 |
| **Daily API Call Quota** | Cap on AccuWeather calls per rolling 24-hour window. The status banner shows `K/Q today` and switches to a warning prefix at 90% usage; at 100% the plugin pauses fetches and surfaces a setPluginError until usage drops below the cap. Set to 0 to disable the cap entirely. | 50 | 0 to 1000 |

## Signal K Paths

Paths marked **canonical** are defined in the [Signal K 1.8.2 vocabulary](https://signalk.org/specification/1.8.2/doc/vesselsBranch.html) and live under `environment.outside.*` or `environment.wind.*`. Everything else (AccuWeather extensions like UV, visibility, cloud cover, plus plugin-derived values like Beaufort scale and heat stress) lives under a producer-namespaced `environment.weather.*` branch, so the canonical containers stay leaf-only as the spec requires. The plugin ships a one-shot Signal K `meta` block describing units and labels for every non-canonical path.

### Core Environmental (canonical)

| Path | Unit | Description |
|------|------|-------------|
| `environment.outside.temperature` | K | Air temperature |
| `environment.outside.pressure` | Pa | Atmospheric pressure |
| `environment.outside.relativeHumidity` | ratio (0 to 1) | Relative humidity |
| `environment.outside.dewPointTemperature` | K | Dew point |
| `environment.outside.apparentWindChillTemperature` | K | Wind chill referenced to observed wind |
| `environment.outside.heatIndexTemperature` | K | Heat index (RealFeel) |
| `environment.outside.airDensity` | kg/m3 | Calculated air density |

### Wind (canonical)

| Path | Unit | Description |
|------|------|-------------|
| `environment.wind.speedOverGround` | m/s | Ground-referenced wind speed (AccuWeather is ground-referenced; this plugin does not emit `speedTrue`) |
| `environment.wind.directionTrue` | rad | True wind direction |
| `environment.wind.speedApparent` | m/s | Apparent wind speed (calculated from vessel motion) |
| `environment.wind.angleApparent` | rad | Apparent wind angle relative to bow (omitted when no heading is available) |

### Weather extensions (`environment.weather.*`, producer namespace)

Everything in this section is outside the 1.8.2 vocabulary. The plugin ships meta describing units and labels.

| Path | Unit | Description |
|------|------|-------------|
| `environment.weather.realFeelShade` | K | RealFeel in shade |
| `environment.weather.wetBulbTemperature` | K | Wet bulb |
| `environment.weather.wetBulbGlobeTemperature` | K | Wet bulb globe (heat stress) |
| `environment.weather.apparentTemperature` | K | AccuWeather apparent temperature |
| `environment.weather.absoluteHumidity` | kg/m3 | Calculated absolute humidity |
| `environment.weather.uvIndex` | (unitless) | UV radiation index (0..15+) |
| `environment.weather.visibility` | m | Visibility distance |
| `environment.weather.cloudCover` | ratio (0 to 1) | Cloud coverage |
| `environment.weather.cloudCeiling` | m | Cloud base height |
| `environment.weather.temperatureDeparture24h` | K | 24-hour temperature change |
| `environment.weather.precipitationLastHour` | m | Precipitation depth in the last hour |
| `environment.weather.precipitationCurrent` | m/s | Current precipitation rate |
| `environment.weather.speedGust` | m/s | Wind gust speed |
| `environment.weather.gustFactor` | ratio | Gust / sustained ratio |
| `environment.weather.beaufortScale` | (unitless) | Beaufort scale category (0..12) |
| `environment.weather.heatStressIndex` | (unitless) | Heat stress category derived from WBGT (0..4) |

## NMEA2000 Integration

This plugin outputs Signal K deltas only. To bridge them onto a physical NMEA2000 bus, pair with an emitter plugin such as [`signalk-nmea2000-emitter-cannon`](https://github.com/NearlCrews/signalk-nmea2000-emitter-cannon). Instance numbers and PGN priority are assigned by the emitter; this plugin does not embed them in the deltas it produces.

### PGN Coverage (when paired with `signalk-nmea2000-emitter-cannon`)

PGN 130312 has fixed enum slots for Outside Temperature, Dew Point, Apparent Wind Chill, and Heat Index. The other temperature paths this plugin emits (RealFeel shade, wet bulb, wet bulb globe, AccuWeather apparent) have no PGN 130312 enum slot, so they reach Signal K consumers but do not bridge to PGN 130312 on the bus.

| PGN | Description | Source paths emitted by this plugin |
|-----|-------------|-------------------------------------|
| 130306 | Wind Data | `environment.wind.speedOverGround`, `directionTrue`, `speedApparent`, `angleApparent` (`environment.weather.speedGust` is emitted but the current cannon release does not subscribe to it) |
| 130311 | Environmental Parameters | `environment.outside.pressure` |
| 130312 | Temperature (enum-routed) | `environment.outside.temperature`, `dewPointTemperature`, `apparentWindChillTemperature`, `heatIndexTemperature` |
| 130313 | Humidity | `environment.outside.relativeHumidity` |

## Data Flow

```
AccuWeather API --> AccuWeatherService (extract + convert to SI units)
                         |
                    WeatherService (add apparent wind from vessel motion)
                         |
                    NMEA2000PathMapper (validate, sanitize, map to SK paths)
                         |
                    index.ts emission timer (emit cached delta every N seconds)
                         |
                    Signal K server --> NMEA2000 emitter --> marine electronics
```

## Troubleshooting

### `API_UNAUTHORIZED: Invalid API key` (HTTP 401)
The AccuWeather server rejected the key. The plugin status banner will show this string and no weather deltas will be emitted.
**What to check**: log into [developer.accuweather.com](https://developer.accuweather.com/), open *My Apps*, confirm the key is active and copy it again (no leading or trailing whitespace). Keys are at least 20 characters.

### `API_FORBIDDEN: API access forbidden` (HTTP 403)
The key is valid but not authorized for the *Current Conditions* endpoint, or the request came from a blocked IP.
**What to check**: confirm the key's plan includes *Current Conditions* in the AccuWeather portal. Trial keys expire 30 days after creation. If you proxy outbound traffic, confirm the egress IP is not on AccuWeather's block list.

### `API_RATE_LIMIT: Rate limit exceeded` (HTTP 429)
The free tier allows 50 calls per day. Each `updateFrequency` tick costs 1 call (location lookups are cached for 2 hours, so they rarely cost extra).
**What to check**: at the default `updateFrequency: 5` minutes, the plugin uses 288 calls/day. Raise it to 30 minutes (48 calls/day) for free-tier keys, or see `examples/slow-update.json` for a 15-minute profile (96 calls/day) suitable for keys shared with other consumers.

### `RESPONSE_TOO_LARGE: AccuWeather response is N bytes`
The plugin caps response bodies at 1 MiB to defend against runaway upstream payloads. AccuWeather Current Conditions responses are normally a few kilobytes, so this almost always indicates a misrouted response (proxy error page, captive portal).
**What to check**: confirm the Signal K server can reach `dataservice.accuweather.com` directly without an HTML interstitial.

### `Running [quota 90% used]` (warning prefix in the status banner)
The rolling 24-hour API request count has crossed 90% of `dailyApiQuota`. The plugin still fetches normally; this is a soft warning so operators can raise the quota or `updateFrequency` before fetches actually pause.
**What to check**: the suffix `K/Q today` shows the live count. Either raise `dailyApiQuota` (paid-tier keys typically allow 25k+/day) or increase `updateFrequency` to spend the remaining headroom more slowly.

### `AccuWeather daily quota reached (K/Q in last 24h)`
The rolling 24-hour count has hit `dailyApiQuota`. The plugin sets a `setPluginError`, skips new fetches, and serves the last good weather payload until the rolling window drops below the cap.
**What to check**: the cap is per rolling 24h, NOT calendar day, so the plugin resumes fetches gradually as the oldest hourly buckets age out. To resume immediately, either raise `dailyApiQuota` and restart the plugin, or set `dailyApiQuota: 0` to disable the cap entirely.

### `Weather data stale: last update N minutes ago`
The plugin emits this banner when the last successful fetch is older than `2 × updateFrequency`. The most common causes are upstream API errors, network outages, and missing GPS position.
**What to check**: the Signal K server logs will show the underlying error code from the previous list. The banner clears automatically once the next fetch succeeds.

### `No position available for weather data`
The plugin throws this when `navigation.position` on the self vessel is null, undefined, or comes from an excluded source (currently any source label containing `node-red`). There is no fixed-coordinates fallback.
**What to check**: confirm a GPS source is publishing `navigation.position` in the Signal K data browser. Note that any source whose label contains `node-red` is deliberately ignored to avoid feedback loops, so a Node-RED-published position will not be picked up; use a different source label or a real GPS/AIS feed.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for full details.

```bash
npm run build          # Clean build (types + bundle)
npm run dev            # Watch mode with hot reload
npm run test           # Tests in watch mode
npm run test:run       # Tests once
npm run test:coverage  # Coverage report (80% thresholds)
npm run lint           # Biome check
npm run lint:fix       # Auto-fix
npm run validate       # Type-check + lint + tests (runs on pre-commit)
```

### Tech Stack

- TypeScript 6.0 (strict, ES2023, ESM)
- Node.js 20.18+
- `@signalk/server-api` 2.24+ (declared as a `peerDependency`; the Signal K server provides it at runtime)
- esbuild 0.28 for bundling
- Biome 2.4 for linting/formatting
- Vitest 4.1 for testing (235 tests across 10 files; Stryker.js for opt-in mutation testing)
- Husky + lint-staged for pre-commit hooks

## License

Apache-2.0: see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pre-commit hooks enforce formatting and tests automatically.

## Support

- [Report a bug](https://github.com/NearlCrews/signalk-virtual-weather-sensors/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/NearlCrews/signalk-virtual-weather-sensors/issues/new?template=feature_request.yml)
- [Security issues](SECURITY.md)
