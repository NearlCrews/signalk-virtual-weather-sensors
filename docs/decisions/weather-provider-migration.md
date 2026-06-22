# WeatherProvider Migration Spike

> Historical design snapshot from the pre-1.7.0 spike; not maintained against shipped behavior.

## Why this exists

`@signalk/server-api` 2.24 ships a typed `WeatherProvider` interface (`registerWeatherProvider` plus `WeatherDataModel`). This spike evaluates migrating off delta-push onto WeatherProvider.

## Current state

26 paths pushed per tick (full list: [Signal K paths reference](../signal-k-paths.md)): 7 canonical `environment.outside.*`, 4 canonical `environment.wind.*`, 16 producer-namespaced `environment.weather.*`. `$source: 'accuweather'` is stamped on every delta; a one-shot meta delta describes units for the producer-namespace leaves.

## WeatherDataModel coverage

Mapped against `WeatherDataModelSchema` (`packages/server-api/src/typebox/weather-schemas.ts`). Legend: direct, semantic (name/meaning shift), none.

| Current path | WeatherDataModel slot | |
|---|---|---|
| `environment.outside.temperature` | `outside.temperature` | direct |
| `environment.outside.pressure` | `outside.pressure` | direct |
| `environment.outside.relativeHumidity` | `outside.relativeHumidity` | direct |
| `environment.outside.dewPointTemperature` | `outside.dewPointTemperature` | direct |
| `environment.outside.heatIndexTemperature` | `outside.feelsLikeTemperature` | semantic |
| `environment.outside.apparentWindChillTemperature` | (no slot) | none |
| `environment.outside.airDensity` | (no slot) | none |
| `environment.wind.speedOverGround` | `wind.speedTrue` | semantic (water vs ground ref) |
| `environment.wind.directionTrue` | `wind.directionTrue` | direct |
| `environment.wind.speedApparent` / `angleApparent` | (observation-only, no slot) | none |
| `environment.weather.uvIndex` | `outside.uvIndex` | direct |
| `environment.weather.visibility` | `outside.horizontalVisibility` | direct |
| `environment.weather.cloudCover` | `outside.cloudCover` | direct |
| `environment.weather.absoluteHumidity` | `outside.absoluteHumidity` | direct |
| `environment.weather.precipitationLastHour` | `outside.precipitationVolume` | direct |
| `environment.weather.cloudCeiling` | (no slot) | none |
| `environment.weather.temperatureDeparture24h` | (no slot) | none |
| `environment.weather.realFeelShade` | (no slot) | none |
| `environment.weather.wetBulbTemperature` | (no slot) | none |
| `environment.weather.wetBulbGlobeTemperature` | (no slot) | none |
| `environment.weather.apparentTemperature` | (no slot) | none |
| `environment.weather.speedGust` | `wind.gust` | direct |
| `environment.weather.gustFactor` | (no slot) | none |
| `environment.weather.beaufortScale` | (no slot; `water.seaState` is wind-unrelated) | none |
| `environment.weather.heatStressIndex` | (no slot) | none |

11 of 26 leaves have a direct slot, two need semantic reconciliation, 13 have no slot.

## Migration trade-offs

Breaks:

- WeatherProvider is **pull-based** (REST `/signalk/v2/api/weather/...`). Today's delta subscribers see nothing unless the plugin keeps emitting.
- `signalk-nmea2000-emitter-cannon` reads delta paths for PGNs 130311 / 130312 / 130313 / 130306. A pure WeatherProvider plugin breaks the NMEA2000 bridge.
- Half of what we expose has no slot and would be silently dropped.

Wins:

- Standard REST endpoints (observations, forecasts, warnings) for any v2 client.
- Forecast and warning surfaces we do not expose today: paid AccuWeather endpoints slot into `getForecasts` / `getWarnings`.
- TypeBox-validated payloads at the boundary.

## Recommended next steps

1. Ship a `WeatherProvider` adapter alongside the existing delta path. `start()` keeps building today's `WeatherData` and exposes it via `getObservations`. Push path untouched.
2. Release as 2.0.0 with the delta path explicitly **deprecated** in CHANGELOG, README banner, and status banner suffix. No removals.
3. Audit downstream: confirm `signalk-nmea2000-emitter-cannon` and instrument-panel users have either migrated to REST or pinned ~2.x.
4. In 3.0.0 remove the delta-push path. Producer-namespace leaves with no slot stay dropped unless step 5 lands first.
5. Optional: upstream a spec PR adding slots for RealFeel shade, wet-bulb, WBGT, and `gustFactor`.

## Merge mode and the `merged` $source (added v2.0.0)

Setting `weatherMode: 'merged'` builds a `MergingWeatherProvider` over the
available atmospheric providers. Current conditions are blended per the
`FIELD_MERGE_KINDS` policy and stamped `$source: 'merged'` on every delta.

The same `$source`-change caveat from the single-provider migration applies here:
switching to merge mode re-stamps every weather delta from the prior
provider-specific source ref to `merged`. Any consumer (a source-priority rule,
a subscription filter, a `signalk-nmea2000-emitter-cannon` source lock) pinned to
the old ref silently stops receiving data until it is updated to `merged`.

Forecasts and observations delegate to one designated forecast-capable child; the
marine layer and warnings are never merged (both run on their own independent
paths and are unaffected by `weatherMode`).

## Open questions

- `WeatherDataModelSchema` vs `WeatherData` interface in `weatherapi.ts` disagree (schema has `wind.averageSpeed`, `wind.gustDirectionTrue`; interface has only `gustDirection`). Which is authoritative?
- `apparentWindChillTemperature` has no slot. Folding into `feelsLikeTemperature` alongside heat index loses the distinction.
- `wind.speedTrue` in `WeatherDataModel`: AccuWeather wind is ground-referenced, Signal K spec defines `speedTrue` as water-referenced. Does the model inherit that semantic?
- Any delta-tree consumer have a path to the v2 Weather REST endpoint? If not, 3.0.0 orphans the NMEA2000 bridge.
- Keep emitting `speedApparent` / `angleApparent` as deltas post-migration? They are derived from live vessel motion, not a forecast model.
