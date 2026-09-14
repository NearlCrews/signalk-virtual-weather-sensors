# Example Configurations

Sample plugin configurations for `signalk-virtual-weather-sensors`. Drop the
contents of any file into the plugin's settings JSON in the Signal K Admin UI
(or write it to your server's `~/.signalk/plugin-config-data/signalk-virtual-weather-sensors.json`).

**Every file sets `weatherProvider` or `weatherMode` explicitly.** The plugin
infers the provider only when the setting is absent, and it infers AccuWeather
whenever a key is present, so an example that named a key but not a provider
would silently switch a keyless install to AccuWeather. That changes the
`$source` on every emitted path and breaks any downstream source lock pinned to
the old one. The three AccuWeather profiles below therefore say so, and you must
replace their placeholder key with your own from
[developer.accuweather.com](https://developer.accuweather.com/).

The plugin always reads its location from `navigation.position` on the self
vessel: there is no fixed-coordinates option. A working GPS feed (or a manually
published `navigation.position`) is required.

## Files

### Keyless

- **`keyless.json`**: The default provider, no account and no key. Open-Meteo's
  free tier is non-commercial and has no per-key daily cap, so a 15-minute
  refresh costs nothing and needs no quota setting.

- **`merged.json`**: Blends the two keyless providers into a synthetic
  `vws-merged` source and adds the optional sea-state layer. Measurements are
  averaged, and every value a notification band reads is taken conservatively
  from the contributors, so one provider reporting gale force is not cancelled
  by a milder sibling. No key, so AccuWeather sits out of the blend until one is
  added.

### AccuWeather

- **`sailboat.json`**: 30-minute weather refresh, 5-second emission to the
  NMEA2000 bus. At a fixed position it costs at most 48 conditions calls plus 1
  location lookup per day, inside the default 50/day quota, and the 5-second
  emission keeps plotters seeing a steady heartbeat between fetches. Underway, a
  fetch that lands in a new 1 km cell also spends a lookup, so budget up to 96
  calls/day or raise the quota.

- **`powerboat.json`**: 2-minute weather refresh for faster-changing conditions
  while underway at higher speeds. Burns 720 conditions calls/day plus a lookup
  for each fetch in a new 1 km cell, so this profile requires a paid AccuWeather
  plan and a `dailyApiQuota` raised to match.

- **`slow-update.json`**: 60-minute weather refresh, 10-second emission. Use
  when you also have other AccuWeather consumers on the same key, when you are
  underway on the default quota (at most 48 calls/day even with a lookup on
  every fetch), or when atmospheric conditions in your cruising area change
  slowly. At most 25 calls/day at a fixed position.

## Settings reference

| Setting | Default | Range | Notes |
|---------|---------|-------|-------|
| `weatherProvider` | `open-meteo` | `open-meteo`, `met-no`, `accuweather` | Single-source provider. Inferred as `accuweather` when omitted and a key is present, so set it explicitly. |
| `weatherMode` | `single` | `single`, `merged` | `merged` blends `mergeProviders` into one synthetic `vws-merged` source. |
| `mergeProviders` | all three | any non-empty subset | Priority order for merged mode. The first entry is primary: it supplies categorical fields, tie-breaks, and the forecast source. |
| `accuWeatherApiKey` | none | min 20 chars | Key from developer.accuweather.com. Required only when AccuWeather is the single provider; in merged mode it enables AccuWeather in the blend. |
| `openMeteoBaseUrl` | none | URL | Self-hosted or paid Open-Meteo endpoint. Leave blank for the free public service, which is non-commercial. |
| `marineData` | `false` | boolean | Adds the keyless Open-Meteo Marine sea-state layer on `environment.water.*` and `environment.current`. Coastal and offshore only. |
| `updateFrequency` | 30 | 1 to 60 minutes | How often to fetch. With AccuWeather, the default costs at most 49 calls/day at a fixed position and up to 96 underway, which exceeds the default quota. |
| `emissionInterval` | 5 | 1 to 60 seconds | How often to re-emit cached data to NMEA2000. |
| `dailyApiQuota` | 50 | 0 to 1000 calls | Rolling 24h cap on AccuWeather calls; 0 disables. Banner shows `K/Q today` and warns from 90%; at 100% the plugin pauses fetches. |
| `notifications` | master off, categories on | object | Master toggle plus per-category toggles for wind, visibility, heat, cold, and severe conditions. |
