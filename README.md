# Signal K Virtual Weather Sensors Plugin

[![npm version](https://img.shields.io/npm/v/signalk-virtual-weather-sensors.svg)](https://www.npmjs.com/package/signalk-virtual-weather-sensors)
[![npm downloads](https://img.shields.io/npm/dm/signalk-virtual-weather-sensors.svg)](https://www.npmjs.com/package/signalk-virtual-weather-sensors)
[![License](https://img.shields.io/github/license/NearlCrews/signalk-virtual-weather-sensors.svg)](https://github.com/NearlCrews/signalk-virtual-weather-sensors/blob/main/LICENSE)
[![CI](https://github.com/NearlCrews/signalk-virtual-weather-sensors/workflows/CI/badge.svg)](https://github.com/NearlCrews/signalk-virtual-weather-sensors/actions)

A Signal K plugin that fetches weather data from the AccuWeather API and emits it as Signal K deltas conforming to the [Signal K 1.8.2 specification](https://signalk.org/specification/1.8.2/doc/), with paths aligned for NMEA2000 emission via a companion plugin. Provides 24+ environmental data points including temperatures, wind, atmospheric conditions, and marine safety indices.

## Features

- **24+ weather data points** from AccuWeather: 8 temperature paths, wind (speed-over-ground, direction, gust, derived Beaufort), atmospheric conditions (pressure, relative humidity, UV, visibility, clouds), and precipitation
- **Spec-compliant Signal K paths** following the 1.8.2 vocabulary (`relativeHumidity`, `apparentWindChillTemperature`, etc.). Plugin-derived values that are not in the spec (Beaufort scale, gust factor, heat stress index) live under `environment.{outside,wind}.derived.*` so they don't squat on canonical-looking slots.
- **`$source: 'accuweather'`** on every delta, so users can configure source priorities to prefer real onboard sensors over the API feed when both are present.
- **One-shot meta delta** on plugin start describing units and labels for non-canonical paths, so the Signal K Admin UI and Instrument Panel render them correctly.
- **Apparent wind calculation** from true wind + vessel motion vectors
- **NMEA2000 alignment** with [`signalk-nmea2000-emitter-cannon`](https://github.com/NearlCrews/signalk-nmea2000-emitter-cannon) PGN conventions (130306, 130311, 130312, 130313)
- **Interval-based emission** (default 5s) for reliable NMEA2000 network recognition
- **Delta caching** -- only rebuilds the Signal K delta when weather data actually changes
- **Rate limit handling** with Retry-After header support and linear backoff fallback
- **Bounded responses** -- 1 MiB cap on AccuWeather response bodies + schema validation before use
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
| **AccuWeather API Key** | Required. Get one free at [developer.accuweather.com](https://developer.accuweather.com/) | -- | -- |
| **Update Frequency** | How often to fetch new weather data (minutes) | 5 | 1--60 |
| **Emission Interval** | How often to emit the current data to the NMEA2000 network (seconds) | 5 | 1--60 |

## Signal K Paths

Paths marked **canonical** are defined in the [Signal K 1.8.2 vocabulary](https://signalk.org/specification/1.8.2/doc/vesselsBranch.html). Paths marked **convention** are not in the vocabulary but are widely used by ecosystem plugins (KIP, Instrument Panel). Paths marked **derived** are plugin-computed categorical or ratio values that live under `.derived.` so they don't squat on canonical-looking slots; the plugin emits a Signal K `meta` block describing each one.

### Core Environmental (canonical)

| Path | Unit | Description |
|------|------|-------------|
| `environment.outside.temperature` | K | Air temperature |
| `environment.outside.pressure` | Pa | Atmospheric pressure |
| `environment.outside.relativeHumidity` | ratio (0--1) | Relative humidity |
| `environment.outside.dewPointTemperature` | K | Dew point |
| `environment.outside.apparentWindChillTemperature` | K | Wind chill referenced to observed wind |
| `environment.outside.heatIndexTemperature` | K | Heat index (RealFeel) |

### Enhanced Temperatures (convention)

| Path | Unit | Description |
|------|------|-------------|
| `environment.outside.realFeelShade` | K | RealFeel in shade |
| `environment.outside.wetBulbTemperature` | K | Wet bulb |
| `environment.outside.wetBulbGlobeTemperature` | K | Wet bulb globe (heat stress) |
| `environment.outside.apparentTemperature` | K | AccuWeather apparent temperature |

### Wind

| Path | Kind | Unit | Description |
|------|------|------|-------------|
| `environment.wind.speedOverGround` | canonical | m/s | Ground-referenced wind speed (AccuWeather is ground-referenced; this plugin does not emit `speedTrue`) |
| `environment.wind.directionTrue` | canonical | rad | True wind direction |
| `environment.wind.speedApparent` | canonical | m/s | Apparent wind speed (calculated from vessel motion) |
| `environment.wind.angleApparent` | canonical | rad | Apparent wind angle relative to bow (omitted when no heading is available) |
| `environment.wind.speedGust` | convention | m/s | Gust speed |
| `environment.wind.derived.gustFactor` | derived | ratio | Gust / sustained ratio |
| `environment.wind.derived.beaufortScale` | derived | 0..12 | Beaufort scale category |

### Atmospheric & Safety

| Path | Kind | Unit | Description |
|------|------|------|-------------|
| `environment.outside.uvIndex` | convention | (unitless) | UV radiation index (0..15+) |
| `environment.outside.visibility` | convention | m | Visibility distance |
| `environment.outside.cloudCover` | convention | ratio (0--1) | Cloud coverage |
| `environment.outside.cloudCeiling` | convention | m | Cloud base height |
| `environment.outside.absoluteHumidity` | convention | kg/m3 | Calculated absolute humidity |
| `environment.outside.airDensity` | convention | kg/m3 | Calculated air density |
| `environment.outside.derived.heatStressIndex` | derived | 0..4 | Heat stress category derived from WBGT |
| `environment.outside.temperatureDeparture24h` | convention | K | 24-hour temperature change |
| `environment.outside.precipitationLastHour` | convention | m | Precipitation depth in the last hour |
| `environment.outside.precipitationCurrent` | convention | m/s | Current precipitation rate |

## NMEA2000 Integration

This plugin outputs Signal K deltas only. To bridge them onto a physical NMEA2000 bus, pair with an emitter plugin such as [`signalk-nmea2000-emitter-cannon`](https://github.com/NearlCrews/signalk-nmea2000-emitter-cannon). Instance numbers and PGN priority are assigned by the emitter; this plugin does not embed them in the deltas it produces.

### PGN Coverage (when paired with `signalk-nmea2000-emitter-cannon`)

PGN 130312 has fixed enum slots for Outside Temperature, Dew Point, Apparent Wind Chill, and Heat Index. The other temperature paths this plugin emits (RealFeel shade, wet bulb, wet bulb globe, AccuWeather apparent) have no PGN 130312 enum slot, so they reach Signal K consumers but do not bridge to PGN 130312 on the bus.

| PGN | Description | Source paths emitted by this plugin |
|-----|-------------|-------------------------------------|
| 130306 | Wind Data | `environment.wind.speedOverGround`, `directionTrue`, `speedApparent`, `angleApparent`, `speedGust` |
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
- Vitest 4.1 for testing (231 tests)
- Husky + lint-staged for pre-commit hooks

## License

Apache-2.0 -- see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pre-commit hooks enforce formatting and tests automatically.

## Support

- [Report a bug](https://github.com/NearlCrews/signalk-virtual-weather-sensors/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/NearlCrews/signalk-virtual-weather-sensors/issues/new?template=feature_request.yml)
- [Security issues](SECURITY.md)
