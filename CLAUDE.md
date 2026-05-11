# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Signal K plugin that provides comprehensive weather data from AccuWeather API with NMEA2000-compatible environmental measurements. Outputs 24+ weather data points including temperatures, wind, atmospheric conditions, and marine safety indices.

## Commands

### Build
```bash
npm run build          # Full build: clean → types → bundle
npm run build:types    # TypeScript declarations only
npm run build:bundle   # esbuild bundle only
npm run dev            # Development with hot reload (tsx watch)
```

### Test
```bash
npm run test           # Watch mode (Vitest)
npm run test:run       # Run once
npm run test:coverage  # Coverage report (80% thresholds)
npm run test:ui        # Interactive UI
```

### Lint & Format
```bash
npm run lint           # Biome check
npm run lint:fix       # Auto-fix issues
npm run format         # Format code
npm run type-check     # TypeScript verification
npm run validate       # All checks (pre-commit uses this)
```

## Architecture

```
src/
├── index.ts                    # Plugin entry point & lifecycle (start/stop/getStatus)
├── services/
│   ├── WeatherService.ts       # Orchestration: coordinates API, navigation, calculations
│   ├── AccuWeatherService.ts   # API client: 24+ field extraction, location caching
│   └── SignalKService.ts       # Vessel navigation data retrieval
├── calculators/
│   └── WindCalculator.ts       # Vector math for apparent wind, Beaufort scale
├── mappers/
│   └── NMEA2000PathMapper.ts   # Weather data → Signal K delta messages
├── utils/
│   ├── validation.ts           # Config validation, NMEA2000 range sanitization
│   └── conversions.ts          # Unit conversions (temp, pressure, wind, Beaufort scale) + `asTimestamp` brand helper
├── constants/
│   └── index.ts                # PGN numbers, Signal K paths, validation limits
└── types/
    └── index.ts                # All interfaces (readonly), type guards
```

### Data Flow
```
AccuWeather API → AccuWeatherService → WeatherService
                                            ↓
Signal K Server ← NMEA2000PathMapper ← WindCalculator
```

### Hybrid Emission System
The plugin uses interval-based emission (default 5 seconds) for NMEA2000 network recognition reliability, combined with event-driven updates when new weather data arrives.

## Key Patterns

- **Official SignalK Types**: Uses `Plugin` and `ServerAPI` from `@signalk/server-api`
- **Dependency Injection**: Services accept logger as constructor parameter
- **Readonly Interfaces**: All public interfaces use `readonly` properties
- **Type Guards**: `isCompleteNavigationData()` for narrowing vessel-data branches
- **Centralized Constants**: Validation limits, PGN numbers, and paths in constants/index.ts
- **SI Units**: All calculations use m/s for speed, radians for angles, Kelvin for temperature

## Testing

Tests are in `src/__tests__/` mirroring the source structure. Run a single test file:
```bash
npx vitest run src/__tests__/calculators/WindCalculator.test.ts
```

Test configuration in `vitest.config.ts` includes path aliases (`@/`, `@/services/`, etc.).

## Signal K Spec Compliance (1.8.2)

- **Canonical paths only under canonical containers**: `environment.outside.{temperature,pressure,relativeHumidity,dewPointTemperature,apparentWindChillTemperature,heatIndexTemperature,airDensity}` and `environment.wind.{speedOverGround,directionTrue,speedApparent,angleApparent}` are the only leaves the plugin emits under `environment.outside.*` / `environment.wind.*`. The 1.8.2 vocabulary defines those containers as leaf-only; squatting an object node like `environment.outside.derived` violates that contract.
- **Producer-namespaced branch for everything else**: `environment.weather.*` holds AccuWeather extensions (UV, visibility, cloud cover, absolute humidity, precipitation, 24h departure, wet bulb temperatures, apparent temperature, RealFeel shade) and plugin-derived values (Beaufort scale, gust factor, heat stress index, wind gust speed). Source provenance is in `$source`, not in the path, so consumers can swap weather providers without re-subscribing.
- **AccuWeather wind is ground-referenced**, so the plugin emits `speedOverGround` only. It does NOT emit `speedTrue` (which is water-referenced and would clobber a real anemometer feed on a moving vessel). Wind direction is true-north per the WMO surface-wind convention; the rationale is pinned in `AccuWeatherService.transformWeatherData`.
- **`$source: 'accuweather'`** is set on every delta (constant lives in `PLUGIN.SOURCE_REF`) so users can configure source priorities to prefer real onboard sensors.
- **Meta delta**: `NMEA2000PathMapper.buildMetaDelta()` returns a one-shot meta delta describing units/labels/descriptions for every `environment.weather.*` path. `index.ts` ships it exactly once per plugin lifetime, after the first values delta (admin-UI rendering workaround, not a spec ordering requirement), via `app.handleMessage(..., SKVersion.v1)`.
- **Status banner**: `WeatherService.formatStatusBanner()` returns the live `Running, last update Nm ago (N updates, K API requests)` string used by `setPluginStatus` (or `Running, awaiting first update` before the first fetch). The `K API requests` suffix is appended only when `AccuWeatherService.getRequestCount()` is non-zero. When `dailyApiQuota > 0` the suffix gains a `, K/Q today` segment showing the rolling 24h count; at 90% the prefix flips to `Running [quota 90% used]`, and at 100% the plugin trips `setPluginError` via `WeatherService.isQuotaExhausted()` and skips fetches until usage drops. Format and counters live together on `WeatherService`; `index.ts` just routes the call. The banner is re-pushed on every successful `emitWeatherTick` so the age and counters stay current (and the start-time `awaiting first update` string flips as soon as the first fetch lands).
- **Daily API quota**: `dailyApiQuota` config option (default 50, range 0 to 1000; 0 disables). `AccuWeatherService` tracks usage via a rolling 24h window backed by 24 fixed hourly buckets that rotate on read/write (O(1) memory regardless of uptime). Accessor: `getRequestCountLast24h()`.
- **PGNs** (when paired with `signalk-nmea2000-emitter-cannon`): 130311 (pressure), 130312 (temperatures via fixed enum slots: temperature, dewPoint, apparentWindChill, heatIndex), 130313 (relativeHumidity), 130306 (wind: `speedOverGround`, `directionTrue`, `speedApparent`, `angleApparent`). Note: `environment.weather.speedGust` is emitted but the current cannon release does not subscribe to it. Instance numbers and bus priority are assigned by the companion plugin, not embedded in the deltas this plugin produces.

## Technology Stack

- TypeScript 6.0+ (strict mode, ES2023 target)
- Node.js 20.18+ (ESM only)
- `@signalk/server-api` 2.24+ as a `peerDependency` (the Signal K server provides it at runtime; not bundled). Used for `Plugin`, `ServerAPI`, `Delta`, `PathValue`, `Meta`, `MetaValue`, `SourceRef`, and `SKVersion` types.
- esbuild 0.28+ for bundling (current bundle ~68 KB)
- Biome 2.4+ for linting/formatting (with `noFloatingPromises` / `noMisusedPromises` enabled)
- Vitest 4.1+ for testing (234 tests across 10 files; mutation score 67% via Stryker.js, opt-in via `npm run mutation-test`)
- Husky + lint-staged for pre-commit hooks
