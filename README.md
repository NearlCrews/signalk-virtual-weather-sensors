# Signal K Virtual Weather Sensors Plugin

[![npm version](https://img.shields.io/npm/v/signalk-virtual-weather-sensors.svg)](https://www.npmjs.com/package/signalk-virtual-weather-sensors)
[![npm downloads](https://img.shields.io/npm/dm/signalk-virtual-weather-sensors.svg)](https://www.npmjs.com/package/signalk-virtual-weather-sensors)
[![License](https://img.shields.io/github/license/NearlCrews/signalk-virtual-weather-sensors.svg)](https://github.com/NearlCrews/signalk-virtual-weather-sensors/blob/main/LICENSE)
[![CI](https://github.com/NearlCrews/signalk-virtual-weather-sensors/workflows/CI/badge.svg)](https://github.com/NearlCrews/signalk-virtual-weather-sensors/actions)

A Signal K plugin that fetches weather data from the AccuWeather API and emits it as NMEA2000-compatible Signal K deltas. Provides 24+ environmental data points including temperatures, wind, atmospheric conditions, and marine safety indices.

## Features

- **24+ weather data points** from AccuWeather: temperatures (7 types), wind (speed, gusts, direction, Beaufort), atmospheric conditions (pressure, humidity, UV, visibility, clouds), and precipitation
- **Apparent wind calculation** from true wind + vessel motion vectors
- **NMEA2000 alignment** with [emitter-cannon](https://github.com/NearlCrews/signalk-nmea2000-emitter-cannon) PGN conventions (130306, 130311, 130312, 130313)
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

### Core Environmental

| Path | Unit | Description |
|------|------|-------------|
| `environment.outside.temperature` | K | Air temperature |
| `environment.outside.pressure` | Pa | Atmospheric pressure |
| `environment.outside.humidity` | ratio (0--1) | Relative humidity (per Signal K spec) |
| `environment.outside.dewPointTemperature` | K | Dew point |
| `environment.outside.windChillTemperature` | K | Wind chill |
| `environment.outside.heatIndexTemperature` | K | Heat index (RealFeel) |

### Enhanced Temperatures

| Path | Unit | Description |
|------|------|-------------|
| `environment.outside.realFeelShade` | K | RealFeel in shade |
| `environment.outside.wetBulbTemperature` | K | Wet bulb |
| `environment.outside.wetBulbGlobeTemperature` | K | Wet bulb globe (heat stress) |
| `environment.outside.apparentTemperature` | K | AccuWeather apparent temperature |

### Wind

| Path | Unit | Description |
|------|------|-------------|
| `environment.wind.speedTrue` | m/s | True wind speed |
| `environment.wind.directionTrue` | rad | True wind direction |
| `environment.wind.speedOverGround` | m/s | Wind speed over ground (mirrors speedTrue) |
| `environment.wind.speedApparent` | m/s | Apparent wind speed (calculated) |
| `environment.wind.angleApparent` | rad | Apparent wind angle relative to bow |
| `environment.wind.directionApparent` | rad | Apparent wind direction (absolute) |
| `environment.wind.directionMagnetic` | rad | Wind direction (magnetic) |
| `environment.wind.speedGust` | m/s | Gust speed |
| `environment.wind.gustFactor` | ratio | Gust / sustained ratio |
| `environment.wind.beaufortScale` | 0--12 | Beaufort scale |

### Atmospheric & Safety

| Path | Unit | Description |
|------|------|-------------|
| `environment.outside.uvIndex` | index | UV radiation (0--15+) |
| `environment.outside.visibility` | m | Visibility distance |
| `environment.outside.cloudCover` | ratio (0--1) | Cloud coverage |
| `environment.outside.cloudCeiling` | m | Cloud base height |
| `environment.outside.absoluteHumidity` | kg/m3 | Calculated absolute humidity |
| `environment.outside.airDensity` | kg/m3 | Calculated air density |
| `environment.outside.heatStressIndex` | 0--4 | Heat stress level |
| `environment.outside.temperatureDeparture24h` | K | 24-hour temperature change |
| `environment.outside.precipitationLastHour` | m | Precipitation in last hour |
| `environment.outside.precipitationCurrent` | m/s | Current precipitation rate |

## NMEA2000 Integration

This plugin outputs Signal K deltas. To bridge them onto a physical NMEA2000 bus, pair with an emitter plugin such as [emitter-cannon](https://github.com/NearlCrews/signalk-nmea2000-emitter-cannon).

### PGN Support

| PGN | Description | Data |
|-----|-------------|------|
| 130306 | Wind Data | Speed, direction, gusts |
| 130311 | Environmental Parameters | Atmospheric pressure |
| 130312 | Temperature | 8 instances (101--111) |
| 130313 | Humidity | Outside (100) |

### Temperature Instance Assignments

| Instance | Measurement |
|----------|------------|
| 101 | Outside air temperature |
| 102 | Dew point |
| 103 | Wind chill |
| 104 | Heat index |
| 108 | RealFeel shade |
| 109 | Apparent temperature |
| 110 | Wet bulb |
| 111 | Wet bulb globe |

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

- TypeScript 5.9+ (strict, ES2023, ESM)
- Node.js 20+
- @signalk/server-api 2.10+
- esbuild for bundling
- Biome for linting/formatting
- Vitest for testing (241 tests)
- Husky + lint-staged for pre-commit hooks

## License

Apache-2.0 -- see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pre-commit hooks enforce formatting and tests automatically.

## Support

- [Report a bug](https://github.com/NearlCrews/signalk-virtual-weather-sensors/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/NearlCrews/signalk-virtual-weather-sensors/issues/new?template=feature_request.yml)
- [Security issues](SECURITY.md)
