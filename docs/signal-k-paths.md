# Signal K Paths, PGNs, and Notifications

Full reference for every path, NMEA2000 PGN, and notification the plugin emits.
For an overview and installation, see the [README](../README.md).

## Path namespaces

Paths marked **canonical** are defined in the
[Signal K 1.8.2 vocabulary](https://signalk.org/specification/1.8.2/doc/vesselsBranch.html)
and live under `environment.outside.*`, `environment.wind.*`, the
`environment.water.temperature` leaf, and the `environment.current` node.
Everything else (provider extensions like UV, visibility, and cloud cover,
plugin-derived values like Beaufort scale and heat stress, and the wave and
swell leaves under `environment.water.*`) lives under a producer namespace, so
the canonical containers stay leaf-only as the spec requires. The plugin ships
a one-shot Signal K `meta` block describing units and labels for every
non-canonical path.

## Source provenance

Every delta carries a `$source` so consumers can set source priorities and
prefer a real onboard sensor. The atmospheric deltas use the active provider's
ref (`open-meteo` by default, `met-no` for Met.no, `accuweather` for
AccuWeather, or `vws-merged` in merge mode), and the optional sea-state deltas use a
distinct `open-meteo-marine`. Because the provider is recorded in `$source`
rather than in the path, swapping the weather source does not change any path
and consumers do not re-subscribe. Some
`environment.weather.*` leaves are AccuWeather-only (RealFeel, RealFeel shade,
AccuWeather apparent temperature, pressure tendency, precipitation type,
visibility obstruction, cloud ceiling, and the 24-hour temperature departure);
the keyless Open-Meteo and Met.no sources supply the rest, and the plugin
estimates the wet-bulb globe temperature so the heat-stress band still works.

> Note: the plugin re-emits its cached delta on a fixed interval for NMEA2000
> recognition. Each re-emission retains the provider's original observation
> timestamp so consumers can determine the true age of the measurement.

## Core environmental (canonical)

| Path | Unit | Description |
|------|------|-------------|
| `environment.outside.temperature` | K | Air temperature |
| `environment.outside.pressure` | Pa | Atmospheric pressure |
| `environment.outside.relativeHumidity` | ratio (0 to 1) | Relative humidity |
| `environment.outside.dewPointTemperature` | K | Dew point |
| `environment.outside.theoreticalWindChillTemperature` | K | Wind chill from the true (ground-referenced) wind |
| `environment.outside.apparentWindChillTemperature` | K | Wind chill from the apparent wind (true wind plus vessel motion); omitted when the required fresh vessel motion data is unavailable |
| `environment.outside.heatIndexTemperature` | K | Heat index, computed (NWS Rothfusz) from air temperature and humidity |
| `environment.outside.airDensity` | kg/m3 | Calculated air density |

## Wind (canonical)

| Path | Unit | Description |
|------|------|-------------|
| `environment.wind.speedOverGround` | m/s | Ground-referenced wind speed (both Open-Meteo and AccuWeather report a ground-referenced wind; this plugin does not emit `speedTrue`) |
| `environment.wind.directionTrue` | rad | True wind direction |

Calculated apparent wind is producer-namespaced (see `windSpeedApparent` /
`windAngleApparent` in the next section). It is synthetic, derived from the
provider's regional ground wind plus vessel motion, so it stays off the
canonical `environment.wind` leaves that a masthead anemometer owns.

## Weather extensions (`environment.weather.*`, producer namespace)

Everything in this section is outside the 1.8.2 vocabulary. The plugin ships
meta describing units and labels. Several leaves are AccuWeather-only and are
absent under Open-Meteo; see [Source provenance](#source-provenance) for the
list.

| Path | Unit | Description |
|------|------|-------------|
| `environment.weather.realFeel` | K | AccuWeather RealFeel (includes solar load) |
| `environment.weather.realFeelShade` | K | RealFeel in shade |
| `environment.weather.wetBulbTemperature` | K | Wet bulb |
| `environment.weather.wetBulbGlobeTemperature` | K | Wet bulb globe (heat stress) |
| `environment.weather.apparentTemperature` | K | AccuWeather apparent temperature |
| `environment.weather.absoluteHumidity` | kg/m3 | Calculated absolute humidity |
| `environment.weather.uvIndex` | (unitless) | WHO solar UV scale: 0..2 low, 3..5 moderate, 6..7 high, 8..10 very high, 11+ extreme |
| `environment.weather.visibility` | m | Visibility distance |
| `environment.weather.cloudCover` | ratio (0 to 1) | Cloud coverage |
| `environment.weather.cloudCeiling` | m | Cloud base height |
| `environment.weather.temperatureDeparture24h` | K | 24-hour temperature change (a delta, not an absolute temperature; the data browser renders it as a Kelvin delta) |
| `environment.weather.precipitationLastHour` | m | Liquid-equivalent precipitation depth over the past hour (the data browser renders it in mm) |
| `environment.weather.speedGust` | m/s | Wind gust speed |
| `environment.weather.gustFactor` | ratio | Gust / sustained ratio |
| `environment.weather.beaufortScale` | (unitless) | Beaufort scale category (0..12) |
| `environment.weather.heatStressIndex` | (unitless) | WBGT-derived heat-stress category on US military WBGT flag cutoffs: 0 (<26.7 C), 1 (26.7..27.8 C), 2 (27.8..29.4 C), 3 (29.4..32.2 C), 4 (>=32.2 C) |
| `environment.weather.windSpeedApparent` | m/s | Apparent wind speed, calculated from the provider's wind and vessel motion |
| `environment.weather.windAngleApparent` | rad | Apparent wind angle relative to bow (-pi..pi, negative to port); omitted when no heading is available |
| `environment.weather.description` | (string) | Plain-language summary of the current condition |
| `environment.weather.pressureTendency` | (unitless) | Pressure trend: -1 falling, 0 steady, +1 rising |
| `environment.weather.precipitationType` | (string) | Precipitation type: Rain, Snow, Ice, or Mixed |
| `environment.weather.visibilityObstruction` | (string) | Visibility obstruction: fog, haze, or smoke |

## Sea state (optional marine layer)

When the **Emit sea state** option is enabled, the plugin adds a keyless
Open-Meteo Marine fetch, independent of the atmospheric source and on the same
cadence and position. Sea surface temperature lands on the canonical
`environment.water.temperature` leaf and surface current on the canonical
`environment.current` object node; waves and swell are producer-namespaced under
`environment.water.waves.*` and `environment.water.swell.*` (the 1.8.2
vocabulary defines no canonical wave or swell leaves) and ship meta. All marine
deltas carry `$source: 'open-meteo-marine'`, distinct from the atmospheric
source, so the model sea temperature and current yield to a real sensor under
source priorities. The layer is off by default, and inland points (no marine
data) emit nothing.

| Path | Unit | Description |
|------|------|-------------|
| `environment.water.temperature` | K | Sea surface temperature (canonical leaf) |
| `environment.current` | object | Surface current as a single node `{ drift, setTrue }`: `drift` m/s, `setTrue` rad (canonical node, not dotted leaves) |
| `environment.water.waves.significantHeight` | m | Significant wave height (highest third, combined wind-wave and swell) |
| `environment.water.waves.period` | s | Mean wave period |
| `environment.water.waves.direction` | rad | Mean direction waves come from, true north |
| `environment.water.waves.windWaveHeight` | m | Height of locally wind-generated waves, excluding swell |
| `environment.water.swell.height` | m | Swell height (waves from distant weather) |
| `environment.water.swell.period` | s | Mean swell period |
| `environment.water.swell.direction` | rad | Direction swell comes from, true north |

No NMEA2000 PGN coverage is defined for the marine layer; these paths reach
Signal K consumers only.

## NMEA2000 PGN coverage

This plugin outputs Signal K deltas only. To bridge them onto a physical
NMEA2000 bus, pair with an emitter plugin such as
[`signalk-nmea2000-emitter-cannon`](https://github.com/NearlCrews/signalk-nmea2000-emitter-cannon).
Instance numbers and PGN priority are assigned by the emitter; this plugin does
not embed them in the deltas it produces.

PGN 130312 has fixed enum slots for Outside Temperature, Dew Point, Apparent
Wind Chill, and Heat Index. The other temperature paths this plugin emits
(RealFeel, RealFeel shade, wet bulb, wet bulb globe, AccuWeather apparent) have
no PGN 130312 enum slot, so they reach Signal K consumers but do not bridge to
PGN 130312 on the bus.

| PGN | Description | Source paths emitted by this plugin |
|-----|-------------|-------------------------------------|
| 130306 | Wind Data | `environment.wind.speedOverGround`, `directionTrue`. Synthetic apparent wind is producer-namespaced (`environment.weather.windSpeedApparent` / `windAngleApparent`); it bridges to 130306 only through the cannon's opt-in `WIND_WEATHER_APPARENT` conversion (off by default, so a real masthead anemometer is not displaced). Gust (`environment.weather.speedGust`) does not bridge: the cannon ships no conversion for it |
| 130314 | Actual Pressure | `environment.outside.pressure` (Source 0 = Atmospheric). This is the modern carrier for atmospheric pressure; the older PGN 130311 (Environmental Parameters) and PGN 130310 are marked OBSOLETE in the NMEA2000 / canboat PGN database |
| 130316 | Temperature Extended Range | Modern successor to PGN 130312, carrying the same temperature data with wider range and finer resolution. An emitter may route the four enum-routed temperature paths through 130316 instead of 130312 |
| 130312 | Temperature (enum-routed) | `environment.outside.temperature`, `dewPointTemperature`, `apparentWindChillTemperature`, `theoreticalWindChillTemperature`, `heatIndexTemperature` |
| 130313 | Humidity | `environment.outside.relativeHumidity` |
| 130323 | Meteorological Station Data | Carries wind speed, wind direction, wind gust, atmospheric pressure, and ambient temperature in one PGN. It is the natural structural fit for a virtual weather-station feed and an emitter may map this plugin's wind, pressure, and temperature paths onto it |

Notes:

- Wind gust (`environment.weather.speedGust`) has a dedicated slot in PGN
  130323, but this plugin emits Signal K deltas only and does not bridge it.
  Reaching any PGN is the job of a companion converter.
- `environment.outside.airDensity` sits on a canonical Signal K path, but no
  NMEA2000 PGN carries air density, so it stays Signal K only.

### Bridging producer-namespaced paths to NMEA2000

The canonical `environment.outside.*` leaves bridge to PGNs when the companion
[`signalk-nmea2000-emitter-cannon`](https://github.com/NearlCrews/signalk-nmea2000-emitter-cannon)
plugin's "environmental" preset is enabled. Ground wind
(`environment.wind.speedOverGround` / `directionTrue`) bridges through the
cannon's `WIND_TRUE_GROUND` conversion, which is not in that preset and must be
enabled separately.

The producer-namespaced `environment.weather.*` paths mostly do not bridge to
NMEA2000. The cannon has no generic path-to-PGN setting: each conversion is a
fixed, named module. The one exception is this plugin's synthetic apparent wind
(`environment.weather.windSpeedApparent` / `windAngleApparent`), which the
cannon's opt-in `WIND_WEATHER_APPARENT` conversion bridges to PGN 130306; that
conversion is off by default so it cannot compete with a real masthead
anemometer. Every other `environment.weather.*` value reaches Signal K
consumers only, because the NMEA2000 standard defines no PGN field for it.

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
| `notifications.environment.weather.severe` | `warn` or `alarm` | AccuWeather `WeatherIcon` 15-17 thunderstorms (warn), 19-21 flurries (warn), 22-23 / 29 / 43-44 snow (warn), 24 ice (alarm), 25-26 sleet / freezing rain (warn), 41-42 thunderstorms (warn) |

The severe-condition trigger above lists the AccuWeather `WeatherIcon` codes.
The band is provider-agnostic: under Open-Meteo the equivalent WMO weather codes
map to the same `warn` and `alarm` classification, so the notification behaves
the same regardless of source.

Each notification value follows the SK 1.8.2 shape
`{ state, method, message, timestamp }`. `state: 'normal'` is written on exit
so plotter UIs clear the alert. `method` is `['visual']` for `warn`,
`['visual', 'sound']` for `alarm` / `emergency`, and `[]` (empty) for the
`normal` clear so consumers drop the cue rather than keeping it lit.

On the first evaluation after a plugin start (including the automatic restart
after a configuration change), the plugin writes every owned path once.
Enabled bands publish their current state, and disabled bands publish `normal`,
so an alert raised by a previous run clears instead of staying lit. Disabling a
category and stopping the plugin also clear the paths it owns. After the first
pass, only genuine transitions are emitted.

The `message` field packs adjacent context so a chartplotter banner is
actionable on its own:

| Band | Sample message |
|------|----------------|
| Wind | `Gale-force wind: Bf9 from SW, 19 m/s, gusts 27 m/s, 998 hPa` |
| Visibility | `Reduced visibility: 0.8 km, ceiling 90 m, rain 2.5 mm/h` |
| Heat | `High heat stress: HSI 3, WBGT 32 C, RH 78%, RealFeel (shade) 35 C` |
| Cold | `Cold exposure caution: wind chill -2 C, air 1 C, wind 12 m/s` |
| Severe | `Thunderstorms: Severe thunderstorms approaching, 998 hPa` |

Optional fields drop out cleanly when the provider does not supply them: a wind
notification with no gust data just omits the `gusts ...` segment. Every message
is capped at 80 characters (with a `…` suffix on
overflow) so it renders cleanly across the chartplotter fleet that bridges
through `signalk-to-nmea2000` to NMEA 2000 Alert PGN 126985.

### Bridging to NMEA 2000 Alert PGNs

Signal K notifications round-trip to N2K Alert PGNs 126983 (Alert) and 126985
(Alert Text) only when the separate `signalk-to-nmea2000` plugin is installed
on the server. This plugin produces SK-native deltas only: it does not bridge
to N2K itself. Notifications still render in the Signal K Data Browser and any
SK webapp regardless.

## Weather API provider

When the active source is forecast-capable (Open-Meteo, Met.no, or AccuWeather,
which is every current provider), the plugin also registers as a Signal K v2
Weather API provider, so consumers can query weather directly through the
server's REST API instead of subscribing to the delta stream. A default keyless
install advertises the API; in merge mode the designated forecast child backs
the endpoints. These endpoints are served:

- `GET /signalk/v2/api/weather/forecasts/point` returns hourly point forecasts
  from the active source.
- `GET /signalk/v2/api/weather/forecasts/daily` returns daily forecasts from
  the active source.
- `GET /signalk/v2/api/weather/observations` returns current conditions for the
  requested position (including the atmospheric pressure and pressure tendency
  the forecasts omit).
- `GET /signalk/v2/api/weather/warnings` returns region-aware severe-weather
  alerts: keyless NWS CAP active alerts for US waters, keyless Met.no MetAlerts
  for Norwegian waters, and a Signal K `Not supported!` error elsewhere.

Forecast and observation requests honor the Signal K `startDate` and
`maxCount` options. Nonempty custom requests are rejected because this provider
does not define custom response fields.

Forecasts are mapped to the same SI units used everywhere else in this plugin
(Kelvin for temperatures, m/s for wind speed, radians for wind direction,
ratio 0 to 1 for humidity and cloud cover, and metres for distance and
precipitation depth). Registering the provider is also what makes the server
list `weather` under `GET /signalk/v2/features`, which is how dashboards such as
signalk-binnacle detect that forecast support is available.

### Point forecast fields

Each point forecast entry populates these fields when the active source provides
them. Absent upstream values are omitted rather than emitted as zero. The
RealFeel `feelsLikeTemperature` is AccuWeather-only; Open-Meteo and Met.no omit
it.

| Field | Unit | Description |
|-------|------|-------------|
| `outside.temperature` | K | Air temperature |
| `outside.dewPointTemperature` | K | Dew point |
| `outside.feelsLikeTemperature` | K | AccuWeather RealFeel |
| `outside.relativeHumidity` | ratio (0 to 1) | Relative humidity |
| `outside.absoluteHumidity` | kg/m3 | Calculated absolute humidity |
| `outside.horizontalVisibility` | m | Visibility distance |
| `outside.uvIndex` | (unitless) | WHO solar UV scale |
| `outside.cloudCover` | ratio (0 to 1) | Cloud coverage |
| `outside.precipitationVolume` | m | Liquid-equivalent precipitation depth |
| `outside.precipitationType` | (string) | Precipitation kind (rain, snow, freezing rain, or mixed/ice) |
| `wind.speedTrue` | m/s | Forecast wind speed (ground-referenced) |
| `wind.directionTrue` | rad | Forecast wind direction (true north) |
| `wind.gust` | m/s | Forecast wind gust speed |

### Daily forecast fields

Each daily forecast entry summarizes the daytime half of the day and populates
these fields when the active source provides them.

| Field | Unit | Description |
|-------|------|-------------|
| `outside.minTemperature` | K | Daily minimum air temperature |
| `outside.maxTemperature` | K | Daily maximum air temperature |
| `outside.uvIndex` | (unitless) | WHO solar UV scale |
| `outside.cloudCover` | ratio (0 to 1) | Cloud coverage |
| `outside.precipitationVolume` | m | Liquid-equivalent precipitation depth |
| `outside.precipitationType` | (string) | Precipitation kind (rain, snow, freezing rain, or mixed/ice) |
| `wind.speedTrue` | m/s | Forecast wind speed (ground-referenced) |
| `wind.directionTrue` | rad | Forecast wind direction (true north) |
| `wind.gust` | m/s | Forecast wind gust speed |
| `sun.sunrise` | (timestamp) | Sunrise time |
| `sun.sunset` | (timestamp) | Sunset time |

### Gaps

- Forecasts carry no `outside.pressure`: the forecast endpoints do not return
  atmospheric pressure, so the field is omitted on both point and daily
  forecasts. The observations endpoint does include pressure (and, under
  AccuWeather, pressure tendency).
- The v2 provider is registered for any forecast-capable source (Open-Meteo,
  Met.no, or AccuWeather), so a default keyless install advertises the forecast,
  observation, and warning endpoints. In merge mode the designated forecast
  child backs them.
- Warnings cover US waters (NWS CAP) and Norwegian waters (Met.no MetAlerts);
  other regions return an empty list.
