# Modularization and maintainability roadmap

Status: guidance, sequenced against the multi-provider work (Plans 1 to 3)
Date: 2026-06-22
Scope: `signalk-virtual-weather-sensors`

## Why this exists

The foundation refactor (Plan 1) made the provider seam clean: the three-tier
`CurrentWeatherProvider` / `ObservationCapableProvider` / `ForecastCapableProvider`
interface, the `PROVIDER_CATALOG`, and the provider-agnostic v2 adapter and
orchestration. This document captures the remaining structural work that keeps
the codebase easy to maintain and cheap to extend, sequenced so the highest-value
items land before the dependent feature plans (Plan 2: Open-Meteo v2 parity;
Plan 3: synthesis merge engine).

Two facts frame everything below:

- The merge engine has a clean home already: `MergingWeatherProvider` implements
  `CurrentWeatherProvider`, so `WeatherService` and `index.ts` do not change. The
  factory returns it when `weatherMode === 'merged'`. Confirmed: `WeatherService`
  talks to the provider only through the interface (`WeatherService.ts:599`), never
  a concrete.
- Every calculator the merge needs is reachable as a pure function or stateless
  method, with one exception (`windGustFactor`, which is inline-duplicated and not
  yet a named function).

## Acid test 1: add a third provider (for example `met-no`)

Touch points today: roughly 14, of which 6 are irreducible and 8 are accidental
coupling that a better seam removes.

- Irreducible: the `WeatherProviderId` union and the `WEATHER_PROVIDER_IDS` and
  `WEATHER_PROVIDER_LABELS` registries (`notifications-shared.ts:87,90,99`), the
  `PROVIDER_CATALOG` entry (`providerCatalog.ts:21`), the service, and the mapper.
- Accidental: `resolveWeatherProvider` validates against a literal id pair, not the
  id list (`notifications-shared.ts:115`), so a third id silently falls back to the
  key-based default. `validateApiKey` hardcodes `provider !== 'accuweather'`
  (`validation.ts:104`). The panel forks on `=== 'accuweather'` for which config
  fields to show (`PluginConfigurationPanel.tsx:94,114,188-218`) and the save gate
  does the same (`usePanelConfig.ts:198`). `WeatherService` hardcodes "AccuWeather"
  in operator-facing banner strings (`WeatherService.ts:466,694`). The instance
  seeds `sourceRef` with the `'accuweather'` literal (`index.ts:116`).

## Acid test 2: add a notification band (for example `seaState`)

Touch points today: about 9 for a weather-driven band, of which 3 are accidental.

- The band logic itself is well-factored: a `BandSet` table plus one evaluator
  (`WeatherNotifier.ts:273,389`), the shared `NOTIFICATION_LABELS` registry that
  auto-flows to the panel toggles (`notifications-shared.ts:26`).
- Accidental: `sanitizeNotifications` enumerates band keys by literal
  (`validation.ts:267`), and the rjsf schema and `uiSchema` hand-list the bands
  (`index.ts:266,333`) rather than generating them from the shared registry.
- Structural gap: the notifier reads `WeatherData` only (`WeatherNotifier.ts:384`),
  so a marine-driven (sea-state) band needs the input contract widened first, which
  is a seam change, not a table edit.

## Prioritized roadmap

Severity is maintainability impact. Each item names the concrete payoff and when it
should land relative to the feature plans.

### Land before Plan 2 (Open-Meteo v2 parity)

These remove coupling that Plan 2's new provider and mappers would otherwise
multiply.

1. **[High] Extract the AccuWeather current transform to a pure mapper.**
   `AccuWeatherService.transformWeatherData` (`AccuWeatherService.ts:627`) is a
   private class method; Open-Meteo's equivalent is a pure exported function
   (`OpenMeteoMapper.ts`). Move it to `src/mappers/AccuWeatherMapper.ts`. Payoff:
   the two providers become symmetric, and Plan 3's merge engine can obtain an
   AccuWeather `WeatherData` without going through the service. This is the single
   prerequisite that currently blocks the merge engine.

2. **[High] Extract `ForecastCache` from `AccuWeatherService`.** The TTL cache with
   stale-on-quota-exhaustion fallback (`AccuWeatherService.ts:512`) has no
   AccuWeather coupling (the quota verdict is passed in). Move to
   `src/services/cache/ForecastCache.ts`. Payoff: Plan 2's Open-Meteo forecast path
   reuses it so a polling v2 consumer does not hammer Open-Meteo, instead of copying
   the machinery.

3. **[High] Drive provider-conditional logic from `PROVIDER_CATALOG`, not
   `=== 'accuweather'` literals.** Extend `ProviderCatalogEntry`
   (`providerCatalog.ts:14`) with the panel-facing facts (keyless, label, which
   extra config fields a provider needs). Replace the hardcoded forks in
   `validation.ts:104`, `PluginConfigurationPanel.tsx:94,114,188-218`, and
   `usePanelConfig.ts:198`. Payoff: a keyed third provider renders the right panel
   fields and validates correctly with zero panel edits.

4. **[Medium] Fix `resolveWeatherProvider` to validate against
   `WEATHER_PROVIDER_IDS`.** Replace the literal id-pair check
   (`notifications-shared.ts:115`) with a membership test. Payoff: a correctness
   fix so a third id is honored rather than silently defaulted. One line.

5. **[Medium] Hoist the shared mapper and conversion helpers before a third copy.**
   Export `optionalCelsiusToKelvin` and `optionalPercentageToRatio` from
   `conversions.ts` (today duplicated in `WeatherProviderMapper.ts:65` and the
   closure at `AccuWeatherService.ts:137`), export `buildWind` (and an m/s variant)
   from a shared mapper helper (`WeatherProviderMapper.ts:98`), and name
   `calculateGustFactor(windGustSpeed, windSpeed)` in `conversions.ts` (inline in
   both `AccuWeatherService.ts:168` and `OpenMeteoMapper.ts:99`). Payoff: Plan 2's
   `OpenMeteoForecastMapper` imports these instead of adding the third and fourth
   copies, and Plan 3's gust-factor recompute has a tested home.

6. **[Medium] Split `types/index.ts` (634 lines) behind a barrel.** Domain files
   `types/weather.ts`, `types/navigation.ts`, `types/config.ts`, `types/plugin.ts`,
   `types/accuweather-api.ts`, `types/open-meteo-api.ts`, with `types/index.ts`
   re-exporting so no call site changes. Payoff: Plan 2's Open-Meteo forecast
   response types land in their own file instead of a 700-line monolith.

### Land with or just before Plan 3 (merge engine)

7. **[Medium] Panel: guard `formsEqual` and add a section registry.** `formsEqual`
   (`usePanelConfig.ts:70`) lists every field by hand, so a new field is a silent
   dirty-tracking bug; add a `satisfies Array<keyof PanelFormState>` key list or a
   generic key-walk. Derive `SectionKey` from a `SECTION_KEYS` const rather than the
   inline union (`PluginConfigurationPanel.tsx:44,67`). Payoff: the Plan 3
   `weatherMode` picker plus merge-settings section becomes a localized change (one
   registry entry, one component) instead of three edits in the root plus a
   silent-bug trap.

8. **[Medium] Extract `StatusBannerFormatter` and `ApparentWindEnhancer` from
   `WeatherService`, and read the active provider name in banners.** The banner and
   quota string assembly (`WeatherService.ts:379-463`) and the apparent-wind vector
   logic (`WeatherService.ts:717-847`) are cohesive units that do not belong in the
   orchestrator. Replace the hardcoded "AccuWeather" banner literals
   (`WeatherService.ts:466,694`) with `provider.name`. Payoff: smaller orchestrator,
   independently testable units, and the banner stops lying once the merge surfaces
   a second metered source.

### High-leverage god-file split (do opportunistically, ideally before Plan 3 adds more)

9. **[High] Split `index.ts` (1096 lines) by responsibility.** Extract
   `src/plugin/schema.ts` (the rjsf schema and uiSchema, `index.ts:193-335`, and
   generate the notifications block from `notifications-shared.ts` instead of
   hand-listing it), `src/plugin/panelRoutes.ts` (the two REST routes, the rate
   limiter, and the test-key probe, `index.ts:978-1096`), `src/plugin/emission.ts`
   (the emission and marine tick state machine plus delta restamping,
   `index.ts:566-765`), and `src/plugin/logging.ts` (log sanitization,
   `index.ts:880-967`). Seed `instance.sourceRef` from a neutral default
   (`index.ts:116`). Payoff: `index.ts` drops to a ~300-line entry point, and adding
   a config field or a notification band stops editing a 1100-line file.

### Follow-on (when triggered)

10. **[Medium] Extract `RollingRequestWindow`, `LocationKeyCache`, and the HTTP
    client from `AccuWeatherService`.** The 24-bucket quota window
    (`AccuWeatherService.ts:264,1192`), the location-key cache
    (`AccuWeatherService.ts:245,743`), and the retry/backoff/Retry-After client
    (`AccuWeatherService.ts:852-1144`) are reusable infrastructure welded into one
    1237-line class. Fold the private `readBoundedJson` (`AccuWeatherService.ts:931`)
    into the existing `utils/http.ts:51` by parameterizing the error prefix. Payoff:
    a future keyed provider reuses this machinery instead of forking the service;
    `AccuWeatherService` shrinks to a ~300-line orchestrator.

11. **[Medium] Make `sanitizeNotifications` iterate `NOTIFICATION_BAND_KEYS`**
    (`validation.ts:267`), and **widen the notifier input contract**
    (`WeatherNotifier.ts:384`) before any marine or sea-state band. Payoff: a new
    band cannot drift from the shared registry, and a marine-driven band becomes a
    table edit rather than a seam change.

12. **[Low] Split `validation.ts` (563 lines)** into `validation/config.ts`,
    `validation/accuweather.ts`, and `validation/nmea2000.ts` behind a barrel when
    Plan 2 adds Open-Meteo response validation. **[Low] Panel polish:**
    `StatusDashboard` takes a `stats` array prop for Plan 2's new cards, the
    `NotificationToggles` inline `fontWeight: 600` (`NotificationToggles.tsx:37`)
    moves to a named token, and `styles.ts` reorders its private base objects above
    `S` (split into token and component-style files only past ~700 lines).

## One adjudicated disagreement

The duplicated `readBoundedJson` (`utils/http.ts:51` vs `AccuWeatherService.ts:931`)
was rated fix-first by one lens and acceptable-divergence by another (the AccuWeather
copy adds a provider-specific error prefix). Resolution: it is not urgent on its own,
but fold it into item 10's HTTP-client extraction by parameterizing the error prefix,
so the bounded-read logic lives once.

## Sequencing summary

- Before Plan 2: items 1, 2, 3, 4, 5, and 6.
- With or just before Plan 3: items 7 and 8 (and the merge engine itself).
- Opportunistic, high leverage: item 9 (the `index.ts` split), ideally before Plan 3
  adds more schema.
- Follow-on: items 10, 11, and 12, with item 11's notifier-contract change required
  before any sea-state notification.
