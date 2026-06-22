# Design: modular multi-provider weather with synthesis merge

Status: approved, ready for implementation planning
Date: 2026-06-22
Scope: `signalk-virtual-weather-sensors`

## Summary

Two related capabilities:

1. **Open-Meteo full Signal K v2 Weather API parity.** Open-Meteo already backs the
   live current-conditions emission path. This work also makes it serve the v2
   Weather API (observations, forecasts, and warnings), so a default keyless
   install registers a weather provider and the panel "Weather API" card shows On.
2. **Multi-provider synthesis merge.** A new merge mode runs every available
   provider concurrently and blends overlapping fields into synthetic values,
   selectable by the operator as an alternative to a single provider.

The overriding constraint is modularity: adding a third provider later, or running
several at once, must be a small, isolated change.

## Goals

- Open-Meteo serves v2 observations, forecasts, and warnings.
- Forecast horizon is a capability each provider declares about itself, not a
  global config knob, so the window auto-adjusts per provider.
- A merge mode produces synthetic blended values where providers overlap, with
  hazard-bearing fields escalating to the most conservative value across providers.
- The operator picks a single provider or merge.
- The provider seam, registry, and config model make a future provider cheap to add.

## Non-goals

- Blending forecast time series across providers. Forecasts and warnings come from
  a single designated provider so a forecast stays internally coherent (one model).
- Merging the marine layer. The marine fetch (`open-meteo-marine`) stays a single
  source and writes its canonical leaves on its own deprioritizable `$source`.
- Per-domain provider selection or automatic primary/fallback failover. The seam
  allows these later, but they are out of scope here.

## Background: current architecture

- `CurrentWeatherProvider` (`src/providers/WeatherProvider.ts`) is the seam for the
  live emission path: `name`, `sourceRef`, `fetchCurrentWeather`, and quota/cache
  accessors. `OpenMeteoService` and `AccuWeatherService` both implement it.
- The v2 Weather API is served by `WeatherProviderAdapter`
  (`src/services/WeatherProviderAdapter.ts`), which today is typed against the
  concrete `AccuWeatherService` and calls AccuWeather-only methods
  (`getDailyForecast`, `getHourlyForecast`, `getCurrentConditionsForLocation`).
- `index.ts` registers the v2 provider only under an `instanceof AccuWeatherService`
  guard (lines around 449), so a default Open-Meteo install never registers one.
- `WeatherProviderId`, `WEATHER_PROVIDER_IDS`, `WEATHER_PROVIDER_LABELS`, and
  `resolveWeatherProvider` live in `src/constants/notifications-shared.ts` and are
  shared by the runtime, the rjsf schema, and the federated panel.
- `createCurrentWeatherProvider` (`src/providers/`) maps config onto a concrete
  provider. `WeatherService` accepts a provider and recomputes vessel-motion-derived
  fields (apparent wind, apparent wind chill) in `enhanceWeatherData`.

A key correction to the original framing: the server advertises `weather` in
`/signalk/v2/features` unconditionally, regardless of any registration. The
consumer-meaningful signal is a non-empty `GET /signalk/v2/api/weather/_providers`;
the data endpoints throw `Provider not found!` when no provider is registered.
Consumers such as signalk-binnacle gate on `_providers`, not on `features`. So the
real win of this work is registering a provider on a default Open-Meteo install.

## Design

### 1. Provider seam: three tiers

Split the single seam into composable capability interfaces so a provider opts into
exactly what it can serve:

- `CurrentWeatherProvider` (unchanged): identity plus `fetchCurrentWeather` and
  quota/cache accessors.
- `ObservationCapableProvider extends CurrentWeatherProvider`: adds
  `getObservation(location): Promise<SKWeatherData>`.
- `ForecastCapableProvider extends ObservationCapableProvider`: adds
  `getHourlyForecast(location)`, `getDailyForecast(location)`, and a self-declared
  `forecastCapabilities = { hourlyHours: number, dailyDays: number }`.

Type guards `supportsObservations(p)` and `supportsForecasts(p)` narrow. AccuWeather
declares `{ hourlyHours: 12, dailyDays: 5 }` (its endpoint caps). Open-Meteo declares
`{ hourlyHours: 48, dailyDays: 7 }` and implements the full forecast tier in this
work. The v2 adapter reads `provider.forecastCapabilities` and never hardcodes a
window; the SK consumer's `maxCount` still caps further.

### 2. Provider registry and config model

**Config model.** `merged` is a mode, not a weather source, so it does not belong in
the provider id union. Use two orthogonal fields:

- `weatherProvider: 'open-meteo' | 'accuweather'` (which upstream source).
- `weatherMode: 'single' | 'merged'` (how to combine).

`weatherProvider` keeps its exact current type and `resolveWeatherProvider` is
unchanged. A new `resolveWeatherMode(explicit, config)` resolves the mode. In
`merged` mode the plugin constructs every available provider (Open-Meteo always;
AccuWeather only when a key is present) and merges them; if only one is available the
merge degrades to that single source silently (no synthesis, no error).

In `merged` mode `weatherProvider` doubles as the **primary** provider. The primary
defines priority order for the merge: it is the categorical first-present and
tie-break winner, and it is the single designated source for forecasts and warnings
(falling back to the highest-priority forecast-capable child when the primary itself
is not forecast-capable). Every other available provider joins as a secondary
contributor to the blended fields. This reuses the operator's existing single
selection rather than adding a separate priority knob.

**Registry.** A single `PROVIDER_CATALOG` maps `id -> { label, keyless,
construct(config, logger) }`. `WEATHER_PROVIDER_IDS`, `WEATHER_PROVIDER_LABELS`, the
rjsf schema in `index.ts`, and `createCurrentWeatherProvider` all derive from it.

The catalog only delivers "add a provider in one place" if these existing couplings
are also removed as part of this work:

- The `instanceof AccuWeatherService` guard in `index.ts` becomes
  `supportsForecasts(provider)`.
- The hardcoded `AccuWeatherService` fallback in the `WeatherService` constructor
  (around line 153) is replaced by required provider injection.
- `PLUGIN.SOURCE_REF` and `PLUGIN.PROVIDER_NAME` (`src/constants/index.ts`) are
  dropped; the adapter reads `provider.name` and `provider.sourceRef`.

Add a `PLUGIN` constant for the merged v2 display name (for example
`Virtual Weather Sensors (merged)`) so a merged feed is never mislabeled
`AccuWeather` in `_providers`.

### 3. Merge engine and field policy

`mergeWeatherData` and its `FIELD_MERGE_KINDS` table live in their own module
(`src/providers/mergeWeatherData.ts`) so the policy is testable without constructing
a provider. `MergingWeatherProvider implements CurrentWeatherProvider`:

- Fetches all children concurrently (`allSettled`), logs and drops failures.
- One survivor returns its data unchanged (no synthesis). Zero survivors throws,
  the same failure contract as a single provider today.
- `sourceRef = 'merged'`.
- Rejects a `MergingWeatherProvider` child at construction (no nesting).
- Quota accessors sum children; keyless children report zero, so the sum is the
  AccuWeather rolling window.
- Forecasts and the v2 designated path delegate to the highest-priority
  forecast-capable child, never blended.

The merge only ever sees atmospheric `WeatherData`. The marine layer is never merged.

#### Field merge policy

| Field(s) | Rule | Rationale |
|---|---|---|
| temperature, pressure, humidity, dewPoint, windSpeed, apparentTemperature, uvIndex, realFeel, realFeelShade, wetBulbTemperature, temperatureDeparture24h, cloudCover, cloudCeiling | scalar arithmetic mean of present values | central tendency is valid for these |
| windDirection | speed-weighted circular (vector) mean, renormalized to [0, 2π); fall back to the priority provider's direction when the resultant magnitude is below epsilon | arithmetic mean breaks across the 0/2π wrap; near-opposite winds are a genuine disagreement, not a midpoint |
| severeCondition | hazard-max: highest `NotificationState` on the ordered ladder (normal < alert < warn < alarm < emergency), tie-break by priority | never mute a hazard a secondary provider caught; also reconciles per-provider severity encodings |
| precipitationLastHour | hazard-max | convective precipitation is intermittent; the mean of a hit and a miss is true in neither model and halves the visibility-band rain suffix |
| windGustSpeed | hazard-max | a gust is a peak, not a central tendency; a mean pulls the merged peak below either model |
| visibility | hazard-min (lowest present) | feeds the fog hazard band; a mean clears a band one provider is firmly inside |
| pressureTendency | conservative: prefer the more hazardous tendency (falling), else priority first-present | ordinal danger signal; a numeric mean of rising and falling fabricates a "steady" barometer |
| wetBulbGlobeTemperature | prefer-measured (AccuWeather measured value over an Open-Meteo shade estimate) | measured WBGT includes the globe/solar term; the two are different quantities, do not average or downgrade |
| description, weatherIcon, precipitationType, visibilityObstruction | categorical, first present in priority order | non-numeric, cannot be blended |
| heatIndex, theoretical windChill, apparentWindChill, beaufortScale (sustained wind, never gust), windGustFactor (>= 1 guard), absoluteHumidity, airDensityEnhanced, heatStressIndex, apparentWindSpeed, apparentWindAngle | derived: recompute from the merged base (apparent wind also uses the single vessel nav), never average or pass through | a derived value must agree with its merged inputs; heat index of the mean is not the mean of heat indices |

The recompute-from-merged-base rule is exhaustive: every value that is a pure
function of base fields is recomputed, never averaged and never passed through.
`heatStressIndex` is recomputed from whichever WBGT the prefer-measured rule
selected. `dewPoint` is a scalar mean (no dew-point calculator exists, and both
providers supply it directly). `apparentWindSpeed`, `apparentWindAngle`, and
`apparentWindChill` are produced downstream in `WeatherService.enhanceWeatherData`
from the merged base, so the merge engine excludes them from its output.

#### Averaging preconditions

The mean is only valid because both current providers are SI, mean-sea-level
pressure, and ground-referenced true-north wind, with sustained wind and gust kept
distinct. Document this precondition and guard a future provider that reports a
different reference (for example station pressure) out of the averaging path rather
than silently blending incompatible quantities. The plugin continues to emit
`speedOverGround` only, never `speedTrue`.

### 4. v2 Weather API wiring

- Retarget `WeatherProviderAdapter` from the concrete `AccuWeatherService` to the
  `ForecastCapableProvider` interface.
- Make the adapter total: every method returns data or an empty array, never throws.
  `getWarnings` is served by the keyless, region-aware `WarningsService` on both
  provider paths, so a default Open-Meteo install never returns a 500.
- Register the v2 provider when the designated primary is at least
  observation-capable and no method throws. Open-Meteo (full forecast tier plus a
  wired `WarningsService`) registers, so `_providers` is non-empty and the panel card
  shows On.
- Honor the ordering contract: observations descending by date, forecasts ascending.
  The merged observation is a single-element array, which satisfies descending order
  trivially. Blend its pressure where two or more children supply it, pass through
  where one does, omit where none do.
- The Open-Meteo forecast and observation mappers (a new `OpenMeteoForecastMapper`)
  reuse the existing SI conversion helpers. The forecast endpoint defaults to km/h,
  so wind units must be set or converted explicitly. Map Open-Meteo
  `apparent_temperature` to the v2 `outside.feelsLikeTemperature` field.
- Populate the v2 `water` block from `MarineData` single-source at adapter time when
  available; it is a separate surface from the `environment.water.*` emission path
  and is never merged.
- `WeatherReqParams`: honor `maxCount` only for both providers in this work,
  documented. Open-Meteo can honor `startDate` (its API takes start and end dates);
  that is a noted future enhancement, not approximated silently now.

### 5. Documentation and migration

- Add a note to the provider-migration decision doc and the CHANGELOG: switching to
  `merged` changes `$source` on the canonical leaves (for example
  `environment.outside.temperature`) from a provider ref to `merged`, which silently
  breaks any source-priority rule the operator previously set against `open-meteo`
  or `accuweather`. This is the same class of change already recorded for a provider
  swap.
- Document that `merged` is a synthetic model source that yields to a real sensor
  under source priorities, exactly as `open-meteo` and `accuweather` do.
- Do not assume this plugin is the default v2 weather provider; rely on
  pluginId-scoped routing if the plugin ever reads its own data back.

### 6. Testing

- Pure `mergeWeatherData`: scalar mean, circular wrap (350 and 10 to 0) plus the
  low-magnitude fallback, hazard-max on the severeCondition ladder and precipitation
  and gust, hazard-min visibility, prefer-measured WBGT, categorical and
  pressureTendency not averaged, derived recompute, derived-skip for the apparent
  wind fields, single-survivor passthrough, all-fail throw, and reject-merger-child
  at construction.
- `OpenMeteoForecastMapper`: SI conversions applied, horizon honored,
  `feelsLikeTemperature` populated, ascending order.
- Adapter: total behavior (all three methods return or empty on a default Open-Meteo
  install, never throw), observations descending versus forecasts ascending, and
  construction against the interface rather than the concrete service.
- Registration: a default Open-Meteo install yields a non-empty `_providers`, and
  merge mode uses the distinct merged provider name.
- Catalog: every id constructs.

## Compatibility

The change is additive. Single-provider behavior and the existing `open-meteo`,
`accuweather`, and `open-meteo-marine` `$source` values are unchanged. Merge mode,
the Open-Meteo forecast and observation paths, and the v2 registration on a default
install are new. Legacy config without `weatherMode` resolves to `single`.
