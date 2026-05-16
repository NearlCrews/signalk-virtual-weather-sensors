# Signal K Paths, PGNs, and Notifications

Full reference for every path, NMEA2000 PGN, and notification the plugin emits.
For an overview and installation, see the [README](../README.md).

## Path namespaces

Paths marked **canonical** are defined in the
[Signal K 1.8.2 vocabulary](https://signalk.org/specification/1.8.2/doc/vesselsBranch.html)
and live under `environment.outside.*` or `environment.wind.*`. Everything else
(AccuWeather extensions like UV, visibility, and cloud cover, plus
plugin-derived values like Beaufort scale and heat stress) lives under a
producer-namespaced `environment.weather.*` branch, so the canonical containers
stay leaf-only as the spec requires. The plugin ships a one-shot Signal K
`meta` block describing units and labels for every non-canonical path.

## Core environmental (canonical)

| Path | Unit | Description |
|------|------|-------------|
| `environment.outside.temperature` | K | Air temperature |
| `environment.outside.pressure` | Pa | Atmospheric pressure |
| `environment.outside.relativeHumidity` | ratio (0 to 1) | Relative humidity |
| `environment.outside.dewPointTemperature` | K | Dew point |
| `environment.outside.apparentWindChillTemperature` | K | Wind chill referenced to observed wind |
| `environment.outside.heatIndexTemperature` | K | Heat index (RealFeel) |
| `environment.outside.airDensity` | kg/m3 | Calculated air density |

## Wind (canonical)

| Path | Unit | Description |
|------|------|-------------|
| `environment.wind.speedOverGround` | m/s | Ground-referenced wind speed (AccuWeather is ground-referenced; this plugin does not emit `speedTrue`) |
| `environment.wind.directionTrue` | rad | True wind direction |
| `environment.wind.speedApparent` | m/s | Apparent wind speed (calculated from vessel motion) |
| `environment.wind.angleApparent` | rad | Apparent wind angle relative to bow (omitted when no heading is available) |

## Weather extensions (`environment.weather.*`, producer namespace)

Everything in this section is outside the 1.8.2 vocabulary. The plugin ships
meta describing units and labels.

| Path | Unit | Description |
|------|------|-------------|
| `environment.weather.realFeelShade` | K | RealFeel in shade |
| `environment.weather.wetBulbTemperature` | K | Wet bulb |
| `environment.weather.wetBulbGlobeTemperature` | K | Wet bulb globe (heat stress) |
| `environment.weather.apparentTemperature` | K | AccuWeather apparent temperature |
| `environment.weather.absoluteHumidity` | kg/m3 | Calculated absolute humidity |
| `environment.weather.uvIndex` | (unitless) | WHO solar UV scale: 0..2 low, 3..5 moderate, 6..7 high, 8..10 very high, 11+ extreme |
| `environment.weather.visibility` | m | Visibility distance |
| `environment.weather.cloudCover` | ratio (0 to 1) | Cloud coverage |
| `environment.weather.cloudCeiling` | m | Cloud base height |
| `environment.weather.temperatureDeparture24h` | K | 24-hour temperature change |
| `environment.weather.precipitationLastHour` | m | Precipitation depth in the last hour |
| `environment.weather.precipitationCurrent` | m/s | Current precipitation rate |
| `environment.weather.speedGust` | m/s | Wind gust speed |
| `environment.weather.gustFactor` | ratio | Gust / sustained ratio |
| `environment.weather.beaufortScale` | (unitless) | Beaufort scale category (0..12) |
| `environment.weather.heatStressIndex` | (unitless) | WBGT-derived heat-stress category: 0 low (<27 C), 1 moderate (27..29 C), 2 high (29..31 C), 3 very high (31..33 C), 4 extreme (>=33 C) |

## NMEA2000 PGN coverage

This plugin outputs Signal K deltas only. To bridge them onto a physical
NMEA2000 bus, pair with an emitter plugin such as
[`signalk-nmea2000-emitter-cannon`](https://github.com/NearlCrews/signalk-nmea2000-emitter-cannon).
Instance numbers and PGN priority are assigned by the emitter; this plugin does
not embed them in the deltas it produces.

PGN 130312 has fixed enum slots for Outside Temperature, Dew Point, Apparent
Wind Chill, and Heat Index. The other temperature paths this plugin emits
(RealFeel shade, wet bulb, wet bulb globe, AccuWeather apparent) have no PGN
130312 enum slot, so they reach Signal K consumers but do not bridge to PGN
130312 on the bus.

| PGN | Description | Source paths emitted by this plugin |
|-----|-------------|-------------------------------------|
| 130306 | Wind Data | `environment.wind.speedOverGround`, `directionTrue`, `speedApparent`, `angleApparent` (`environment.weather.speedGust` is emitted but the current cannon release does not subscribe to it) |
| 130311 | Environmental Parameters | `environment.outside.pressure` |
| 130312 | Temperature (enum-routed) | `environment.outside.temperature`, `dewPointTemperature`, `apparentWindChillTemperature`, `heatIndexTemperature` |
| 130313 | Humidity | `environment.outside.relativeHumidity` |

## Notifications

Severe-weather notifications under `notifications.environment.*` are opt-in
(master toggle off by default). When enabled, the plugin emits one Signal K
notification delta per hazard band transition (entry into / exit from the
band). Bands are tracked independently so a single weather event can light up
multiple paths concurrently.

| Path | State | Trigger |
|------|-------|---------|
| `notifications.environment.wind.gale` | `warn` | Beaufort >= 8 |
| `notifications.environment.wind.storm` | `alarm` | Beaufort >= 10 |
| `notifications.environment.wind.hurricane` | `emergency` | Beaufort >= 12 |
| `notifications.environment.visibility.low` | `warn` | Visibility under 1 nm (1852 m) |
| `notifications.environment.visibility.veryLow` | `alarm` | Visibility under 0.5 nm (926 m) |
| `notifications.environment.heat.caution` | `warn` | Heat-stress index >= 2 |
| `notifications.environment.heat.high` | `alarm` | Heat-stress index >= 3 |
| `notifications.environment.heat.extreme` | `emergency` | Heat-stress index >= 4 |
| `notifications.environment.cold.caution` | `warn` | Wind chill below 0 C |
| `notifications.environment.cold.extreme` | `alarm` | Wind chill below -20 C |
| `notifications.environment.weather.severe` | `warn` or `alarm` | AccuWeather `WeatherIcon` 15-17 thunderstorms (warn), 24 ice (alarm), 25-26 sleet / freezing rain (warn), 22-23 / 29 / 41-44 snow / thunderstorms (warn) |

Each notification value follows the SK 1.8.2 shape
`{ state, method, message, timestamp }`. `state: 'normal'` is written on exit
so plotter UIs clear the alert. `method` is `['visual']` for `warn` and
`['visual', 'sound']` for `alarm` / `emergency`.

The `message` field packs adjacent context so a chartplotter banner is
actionable on its own:

| Band | Sample message |
|------|----------------|
| Wind | `Gale-force wind: Bf9 from SW, 19 m/s, gusts 27 m/s, 998 hPa` |
| Visibility | `Reduced visibility: 0.8 km, ceiling 90 m, rain 2.5 mm/h` |
| Heat | `High heat stress: HSI 3, WBGT 32 C, RH 78%, RealFeel 35 C` |
| Cold | `Cold exposure caution: wind chill -2 C, air 1 C, wind 12 m/s` |
| Severe | `Thunderstorms: Severe thunderstorms approaching, 998 hPa` |

Optional fields drop out cleanly when AccuWeather does not provide them: a wind
notification on a free-tier key with no gust block just omits the `gusts ...`
segment. Every message is capped at 80 characters (with a `…` suffix on
overflow) so it renders cleanly across the chartplotter fleet that bridges
through `signalk-to-nmea2000` to NMEA 2000 Alert PGN 126985.

### Bridging to NMEA 2000 Alert PGNs

Signal K notifications round-trip to N2K Alert PGNs 126983 (Alert) and 126985
(Alert Text) only when the separate `signalk-to-nmea2000` plugin is installed
on the server. This plugin produces SK-native deltas only: it does not bridge
to N2K itself. Notifications still render in the Signal K Data Browser and any
SK webapp regardless.
