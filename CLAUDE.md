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
│   └── conversions.ts          # Unit conversions (temp, pressure, wind, Beaufort scale)
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
- **Type Guards**: `isCompleteWeatherData()`, `isCompleteNavigationData()` for narrowing
- **Centralized Constants**: Validation limits, PGN numbers, and paths in constants/index.ts
- **SI Units**: All calculations use m/s for speed, radians for angles, Kelvin for temperature

## Testing

Tests are in `src/__tests__/` mirroring the source structure. Run a single test file:
```bash
npx vitest run src/__tests__/calculators/WindCalculator.test.ts
```

Test configuration in `vitest.config.ts` includes path aliases (`@/`, `@/services/`, etc.).

## NMEA2000 Compliance

- **PGNs**: 130311 (pressure), 130312 (temperatures), 130313 (humidity), 130306 (wind)
- **Instance assignments**: Temperatures 101-111, Humidity 100-101
- **Humidity**: Output as ratio (0-1) per Signal K spec

## Technology Stack

- TypeScript 5.9+ (strict mode, ES2023 target)
- Node.js 20+ (ESM only)
- @signalk/server-api 2.10+ for official Plugin/ServerAPI types
- esbuild 0.27+ for bundling
- Biome 2.3+ for linting/formatting
- Vitest 4.x for testing
- Husky + lint-staged for pre-commit hooks
