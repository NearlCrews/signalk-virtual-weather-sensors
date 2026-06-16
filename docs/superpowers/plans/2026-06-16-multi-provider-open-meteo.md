# Multi-Provider Weather (Open-Meteo default) Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a keyless global weather provider (Open-Meteo) as the default for new installs, decoupled behind a provider abstraction, so the plugin works out of the box now that AccuWeather's permanent free tier is retired, while preserving existing AccuWeather configs untouched.

**Architecture:** Introduce a narrow `WeatherProvider` seam keyed on the internal SI `WeatherData` type. The notifier is first decoupled from the AccuWeather icon code by carrying a normalized `severeCondition` on `WeatherData`. `AccuWeatherService` and a new `OpenMeteoService` both implement the seam. `WeatherService` and the v2 adapter depend on the seam, not the concrete AccuWeather class. Config gains an optional key, a provider selector, and a configurable Open-Meteo base URL; quota machinery is gated to AccuWeather only.

**Tech Stack:** TypeScript (strict, ESM), Vitest, esbuild, Biome, React 19 federated panel.

This plan covers the FOUNDATION sub-unit (the new-user cliff fix). Marine sea-state, `getObservations`, region-aware `getWarnings`, destination-aware forecasting, and alarm `zones` each get their own plan after this lands green, per the review.

---

## File structure

- `src/types/index.ts` — add `SevereCondition`, add `severeCondition?` to `WeatherData`; add `WeatherProviderId` and provider config to `PluginConfiguration`; make `accuWeatherApiKey` optional.
- `src/providers/WeatherProvider.ts` (new) — the `CurrentWeatherProvider` interface the runtime depends on, plus `ForecastProvider` for the v2 path.
- `src/providers/accuweather-severity.ts` (new) — the AccuWeather `WeatherIcon` to `SevereCondition` map moved out of the notifier.
- `src/services/AccuWeatherService.ts` — implement the provider interface; populate `severeCondition`; expose `getForecasts(point|daily): SKWeatherData[]`.
- `src/services/OpenMeteoService.ts` (new) — keyless current-conditions and forecasts, WMO weather-code severity, recomputed heat index and a WBGT estimate for parity.
- `src/mappers/OpenMeteoMapper.ts` (new) — pure Open-Meteo response to `WeatherData` and to `SKWeatherData[]`.
- `src/notifications/WeatherNotifier.ts` — consume `data.severeCondition`; delete the icon map.
- `src/services/WeatherService.ts` — depend on the provider interface; gate quota to AccuWeather.
- `src/services/WeatherProviderAdapter.ts` — take a `ForecastProvider`, not `AccuWeatherService`.
- `src/index.ts` — provider selection from config; per-provider `$source`; quota UI gating.
- `src/constants/notifications-shared.ts` and `src/constants/index.ts` — provider ids, Open-Meteo defaults, source refs.
- `src/configpanel/*` — optional key, provider picker, configurable endpoint, quota visibility.
- Tests mirror each under `src/__tests__/`.

---

## Task 1: Decouple the notifier from the AccuWeather icon code

Pure refactor, no behavior change. This is the one hard coupling that blocks a second provider.

**Files:**
- Modify: `src/types/index.ts` (add `SevereCondition`, add `severeCondition?` to `WeatherData`)
- Create: `src/providers/accuweather-severity.ts`
- Modify: `src/services/AccuWeatherService.ts` (populate `severeCondition` in `transformWeatherData`)
- Modify: `src/notifications/WeatherNotifier.ts` (consume `severeCondition`, delete `WEATHER_ICON_SEVERITY`)
- Test: `src/__tests__/notifications/WeatherNotifier.test.ts`, `src/__tests__/services/AccuWeatherService.test.ts`

- [ ] **Step 1: Add the normalized type.** In `types/index.ts` add:

```typescript
/**
 * Provider-agnostic severe-condition classification. Each provider's transform
 * maps its own condition encoding (AccuWeather icon code, Open-Meteo WMO code)
 * to this shape, so the notifier never sees a provider-specific value.
 */
export interface SevereCondition {
  readonly state: NotificationState;
  readonly label: string;
}
```

and on `WeatherData`, alongside `weatherIcon`:

```typescript
  /**
   * Provider-agnostic severe-condition classification, set by each provider's
   * transform. The notifier consumes this instead of a raw provider code.
   */
  readonly severeCondition?: SevereCondition;
```

- [ ] **Step 2: Move the icon map** verbatim from `WeatherNotifier.ts` into `src/providers/accuweather-severity.ts`, exporting `accuWeatherSevereCondition(icon: number | undefined): SevereCondition | undefined`.
- [ ] **Step 3: Populate in the transform.** In `AccuWeatherService.transformWeatherData`, set `severeCondition` from `accuWeatherSevereCondition(weatherIcon)`.
- [ ] **Step 4: Consume in the notifier.** `evaluateSevereCondition` reads `data.severeCondition` instead of `data.weatherIcon`; delete `WEATHER_ICON_SEVERITY` and `IconSeverity`.
- [ ] **Step 5: Tests then commit.** Notifier tests construct `severeCondition` directly; an AccuWeather test asserts a thunderstorm icon yields the right `severeCondition`. Run `npm test`, then commit.

## Task 2: Provider interface

Define `CurrentWeatherProvider` (`fetchCurrentWeather(location): Promise<WeatherData>`, plus `name`, `sourceRef`, and optional quota accessors returning trivial values for keyless providers) and `ForecastProvider` (`getForecasts(position, type, options?): Promise<SKWeatherData[]>`). `AccuWeatherService` implements both; the v2 forecast mapping moves into the provider so the adapter is provider-agnostic.

## Task 3: OpenMeteoService + mapper

Keyless current-conditions from `api.open-meteo.com/v1/forecast` (current block: temperature_2m, relative_humidity_2m, pressure_msl, wind_speed_10m, wind_direction_10m, dew_point_2m, cloud_cover, visibility, uv_index, weather_code, wind_gusts_10m, precipitation). Map WMO weather codes to `SevereCondition`. Recompute heat index (reuse `WindCalculator.calculateHeatIndex`) and estimate WBGT for parity so the heat-stress band survives. Configurable base URL. Pure mapper, fully unit-tested.

## Task 4: Config and selection

Make `accuWeatherApiKey` optional; add `weatherProvider: 'open-meteo' | 'accuweather'` and `openMeteoBaseUrl`. Default new installs to `open-meteo`; if an AccuWeather key is already present in saved config, keep AccuWeather active (migration guard). `index.ts` constructs the selected provider, sets a per-provider `$source`, and gates the quota banner and `dailyApiQuota` UI to AccuWeather.

## Task 5: Config panel

Provider picker, key field shown only for AccuWeather, Open-Meteo base-URL field, quota controls hidden for keyless. Attribution line ("Weather data by Open-Meteo.com") and the non-commercial-free-tier disclosure.

## Task 6: Docs and parity disclosure

README What's New, CHANGELOG entry, attribution, and a precise note of which `environment.weather.*` leaves and which notification bands are AccuWeather-only versus recomputed under Open-Meteo.

---

## Self-review note

Spec coverage: cliff fix (Tasks 3 to 5), feature parity (Task 3 recompute), migration safety (Task 4 guard), licensing (Tasks 5 to 6 attribution and disclosure, configurable endpoint), decoupling (Tasks 1 to 2). Deferred to their own plans: marine, observations, warnings, destination forecasting, zones.
