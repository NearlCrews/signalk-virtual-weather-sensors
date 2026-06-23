# Development Documentation

This document covers the tools, technologies, and workflows used to develop the
signalk-virtual-weather-sensors Signal K plugin. For contribution guidelines and
the pull request process, see [CONTRIBUTING.md](../.github/CONTRIBUTING.md). For
the release process, see [maintainers/RELEASE.md](maintainers/RELEASE.md).

## Development Stack

### Core Technologies

#### TypeScript 6.0+
- **Purpose**: Primary development language with strict type safety
- **Configuration**: [`tsconfig.json`](../tsconfig.json)
- **Features Used**:
  - Strict mode with comprehensive type checking
  - ES2023 target for modern JavaScript features
  - NodeNext module resolution for ESM compatibility
  - Declaration maps for enhanced IDE support
  - Verbatim module syntax for explicit imports/exports

**Key Configuration Highlights:**
```json
{
  "target": "ES2023",
  "module": "NodeNext",
  "strict": true,
  "noImplicitAny": true,
  "exactOptionalPropertyTypes": true,
  "noUncheckedIndexedAccess": true,
  "verbatimModuleSyntax": true,
  "types": ["node"]
}
```

#### Node.js 20.18+
- **Purpose**: Runtime environment for the Signal K server plugin
- **Version**: 20.18+ (specified in [`.node-version`](../.node-version) and `package.json#engines`)
- **Module System**: Pure ESM (no CommonJS)
- **Features Used**:
  - Native ESM support with `import`/`export`
  - Built-in `fetch`, `AbortController`, and `URL` from the Node 20 LTS line

#### @signalk/server-api 2.24+
- **Purpose**: Official Signal K type definitions for plugins
- **Declared as `peerDependency`**: the Signal K server provides it at runtime, so esbuild externalizes it instead of bundling. (Bundling it pulls the whole package in, since `SKVersion` is an enum value, not a type.)
- **Features Used**:
  - `Plugin` interface for plugin structure compliance
  - `ServerAPI` interface for type-safe server interaction
  - Branded `Delta`, `Path`, `Context`, `Timestamp`, `SourceRef` types: the path mapper returns `Delta` directly to avoid double-cast workarounds in `index.ts`
  - `Meta`, `MetaValue` for the one-shot meta delta describing non-canonical paths
  - `SKVersion` (enum) passed to `app.handleMessage(...)` so v1/v2 routing is explicit
  - Proper typing for `handleMessage()`, `getSelfPath()`, `setPluginStatus()`, `setPluginError()`

**Plugin Implementation Pattern:**
```typescript
import { type Plugin, type ServerAPI, SKVersion } from '@signalk/server-api';

export default function createPlugin(app: ServerAPI): Plugin {
  const plugin: Plugin = {
    id: 'my-plugin',
    name: 'My Plugin',
    start: async (config, restart) => { /* ... */ },
    stop: async () => { /* ... */ },
    schema: () => ({ /* ... */ }),
  };
  return plugin;
}
```

### Build and Bundling

#### esbuild 0.28+
- **Purpose**: Fast, modern JavaScript bundler for the plugin runtime
- **Configuration**: [`esbuild.config.js`](../esbuild.config.js)
- **Performance**: ~150 KB bundle in tens of milliseconds (the build script logs the live size after every run)
- **Features**:
  - ES2023 target compilation
  - Source map generation
  - Tree shaking for optimal bundle size
  - External dependency handling: declared `dependencies` and `peerDependencies` (including `@signalk/server-api`) are excluded from the bundle
  - Banner injection for plugin metadata

**Build Outputs:**
- `dist/index.js`: main plugin bundle (~150 KB)
- `dist/index.js.map`: source map
- `dist/index.d.ts` and per-source `*.d.ts`: TypeScript declarations
- `public/remoteEntry.js` plus federated chunks (.mjs): the React config panel, bundled by webpack via `ModuleFederationPlugin` (see [`webpack.config.cjs`](../webpack.config.cjs)). Independent of the esbuild bundle above; both are produced by `npm run build`.

### Code Quality

#### Biome 2.4+
- **Purpose**: Modern, fast linting and formatting (replaces ESLint + Prettier)
- **Configuration**: [`biome.json`](../biome.json)
- **Features**:
  - TypeScript-native linting
  - Automatic code formatting
  - Performance-optimized (Rust-based)
  - Git integration for changed files

**Key Rules Enforced:**
- No non-null assertions
- Const over let when possible
- No unused variables/imports
- Exhaustive switch cases
- Triple-equals only (no `==`)
- `noFloatingPromises` / `noMisusedPromises`

**Formatting Standards:**
- 2-space indentation
- 100 character line width
- Single quotes for strings
- Semicolons always
- Trailing commas (ES5)
- LF line endings

### Testing

#### Vitest 4.x
- **Purpose**: Modern, fast unit testing framework
- **Configuration**: [`vitest.config.ts`](../vitest.config.ts)
- **Features**:
  - TypeScript-first testing
  - Built-in coverage with v8
  - Watch mode for development
  - UI mode for interactive testing
  - Parallel test execution

**Test Coverage Requirements:** 80% for branches, functions, lines, and statements.

**Test Structure:**
```
src/__tests__/
├── setup.ts                          # Global test configuration + mock factories
├── index.test.ts                     # Plugin entry / lifecycle / meta-once invariant / v2 registration
├── plugin/
│   ├── panelRoutes.test.ts           # Panel REST routes (status, test-key)
│   └── schema.test.ts                # rjsf schema and uiSchema generation
├── calculators/
│   ├── WindCalculator.test.ts        # Vector wind / wind chill / heat index
│   └── deriveWeatherFields.test.ts   # Base-to-derived recompute helper
├── constants/
│   └── notifications-shared.test.ts  # Provider/mode resolution and shared defaults
├── mappers/
│   ├── NMEA2000PathMapper.test.ts    # Delta build + meta delta
│   ├── OpenMeteoMapper.test.ts       # Open-Meteo current block -> internal SI WeatherData
│   ├── OpenMeteoForecastMapper.test.ts  # Open-Meteo forecast / observation -> SK v2 envelope
│   ├── MetNoMapper.test.ts           # Met.no current block -> internal SI WeatherData
│   ├── MetNoForecastMapper.test.ts   # Met.no timeseries -> SK v2 observations / forecasts
│   ├── AccuWeatherMapper.test.ts     # AccuWeather current block -> internal SI WeatherData
│   ├── MarinePathMapper.test.ts      # MarineData -> environment.water.* / environment.current + meta
│   ├── OpenMeteoMarineMapper.test.ts # Open-Meteo Marine current block -> MarineData
│   ├── WarningsMapper.test.ts        # NWS CAP and Met.no MetAlerts -> SK v2 WeatherWarning
│   ├── WeatherProviderMapper.test.ts # AccuWeather forecast / current -> SK Weather API envelope
│   ├── skV2Envelope.test.ts          # Shared SK v2 outside / wind / sun block builders
│   └── delta-schema.test.ts          # Ajv conformance against the SK 1.8.2 JSON schema
├── notifications/
│   └── WeatherNotifier.test.ts       # Transition state machine across hazard bands
├── providers/
│   ├── createCurrentWeatherProvider.test.ts  # Single-provider selection from the catalog
│   ├── createWeatherProvider.test.ts # Single vs merged top-level selection
│   ├── providerCatalog.test.ts       # PROVIDER_CATALOG construction
│   ├── WeatherProvider.test.ts       # supportsForecasts seam guard
│   ├── MergingWeatherProvider.test.ts  # Merge orchestration and forecast delegation
│   ├── mergeWeatherData.test.ts      # Field merge policy, circular-mean wind, derived recompute
│   ├── accuweather-severity.test.ts  # AccuWeather icon code -> severe-condition classification
│   ├── open-meteo-severity.test.ts   # WMO weather code -> severe-condition classification
│   └── met-no-severity.test.ts       # Met.no symbol code -> severe-condition classification
├── services/
│   ├── WeatherService.test.ts        # Orchestration / lifecycle / single-flight / tick banner / marine
│   ├── SignalKService.test.ts        # Navigation data + caching
│   ├── OpenMeteoService.test.ts      # Keyless Open-Meteo current and forecast client
│   ├── MetNoService.test.ts          # Keyless Met.no current and forecast client
│   ├── AccuWeatherService.test.ts    # API integration + retry/error/timeout paths
│   ├── OpenMeteoMarineService.test.ts # Keyless Open-Meteo Marine client (best-effort)
│   ├── WarningsService.test.ts       # Region-aware getWarnings (NWS and Met.no MetAlerts)
│   ├── WeatherProviderAdapter.test.ts # SK v2 Weather API provider surface
│   ├── cache/                        # CoalescingTtlCache, ForecastCache
│   ├── http/                         # RetryingHttpClient
│   └── quota/                        # RollingRequestWindow
├── integration/
│   └── weather-flow.integration.test.ts  # End-to-end smoke against stubbed global.fetch
└── utils/
    ├── conversions.test.ts           # Unit conversions
    └── validation.test.ts            # Sanitization + validators
```

### Version Control

#### Husky 9.x
- **Purpose**: Git hooks for code quality enforcement
- **Configuration**: [`.husky/pre-commit`](../.husky/pre-commit)
- **Pre-commit Hook**: Runs `npm run validate` (type check, Biome lint, Biome format check, test suite)
- **Opt-in**: enable the hook once with `npm run hooks`. There is intentionally
  no `prepare` script: a `prepare` lifecycle banner leaks into the SignalK App
  Store install simulation's `npm pack` stdout capture on Node 22's npm 10 and
  fails plugin-ci, so hook setup is manual rather than automatic on `npm install`.

#### Lint-staged
- **Purpose**: Run linters only on staged files
- **Configuration**: [`package.json`](../package.json)
- **Actions**: Biome check and format for TypeScript files; Biome format for JSON and Markdown

### CI/CD

#### GitHub Actions
- **Purpose**: Automated testing and building
- **Configuration**: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
- **Test Job**: matrix on Node.js 20.x and 22.x; lint, type check, test coverage, Codecov upload, `npm audit`
- **Build Job**: production build verification, bundle size analysis, output validation

## Project Structure

```
signalk-virtual-weather-sensors/
├── src/
│   ├── index.ts                       # Plugin entry: lifecycle, v2 registration, emission timer, REST routes
│   ├── plugin/
│   │   ├── instance.ts                # Shared instance state + banner dedupe
│   │   ├── emission.ts                # Keep-alive emission tick
│   │   ├── logging.ts                 # Logger factory
│   │   ├── panelRoutes.ts             # Panel REST routes (status, test-key)
│   │   └── schema.ts                  # rjsf schema() and uiSchema()
│   ├── calculators/
│   │   ├── WindCalculator.ts          # Vector wind, wind chill, heat index
│   │   └── deriveWeatherFields.ts     # Base-to-derived recompute helper
│   ├── configpanel/                   # Federated React config panel (TypeScript)
│   │   ├── index.tsx                  # Module Federation entry
│   │   ├── PluginConfigurationPanel.tsx  # Composition root (provider and mode pickers)
│   │   ├── styles.ts                  # --svws-* design tokens, light/dark/night themes
│   │   ├── api-base.ts                # API_BASE + panel-shared helpers
│   │   ├── components/                # Section, NumberInput, StatusDashboard, ApiKeyField, ...
│   │   └── hooks/                     # useStatus, usePanelConfig
│   ├── constants/
│   │   ├── index.ts                   # TS constants (PGNs, paths, validation limits, error codes)
│   │   └── notifications-shared.ts    # Shared module: labels, defaults, bounds, provider/mode resolution, key validation
│   ├── providers/
│   │   ├── WeatherProvider.ts         # CurrentWeatherProvider / ForecastCapableProvider seams
│   │   ├── providerCatalog.ts         # PROVIDER_CATALOG: id -> service construction
│   │   ├── createCurrentWeatherProvider.ts  # Constructs the single resolved provider
│   │   ├── createWeatherProvider.ts   # Single source or a MergingWeatherProvider when merged
│   │   ├── MergingWeatherProvider.ts  # Blends available providers; delegates forecasts to a child
│   │   ├── mergeWeatherData.ts        # Pure merge engine + FIELD_MERGE_KINDS policy
│   │   ├── open-meteo-severity.ts     # WMO weather code -> severe-condition classification
│   │   ├── met-no-severity.ts         # Met.no symbol code -> severe-condition classification
│   │   └── accuweather-severity.ts    # AccuWeather icon code -> severe-condition classification
│   ├── mappers/
│   │   ├── NMEA2000PathMapper.ts      # WeatherData -> SK delta + one-shot meta delta
│   │   ├── OpenMeteoMapper.ts         # Open-Meteo current block -> internal SI WeatherData
│   │   ├── OpenMeteoForecastMapper.ts # Open-Meteo forecast / observation -> SK v2 envelope
│   │   ├── MetNoMapper.ts             # Met.no current block -> internal SI WeatherData
│   │   ├── MetNoForecastMapper.ts     # Met.no timeseries -> SK v2 observations / forecasts
│   │   ├── AccuWeatherMapper.ts       # AccuWeather current block -> internal SI WeatherData
│   │   ├── MarinePathMapper.ts        # MarineData -> environment.water.* / environment.current + meta
│   │   ├── OpenMeteoMarineMapper.ts   # Open-Meteo Marine current block -> MarineData
│   │   ├── WarningsMapper.ts          # NWS CAP and Met.no MetAlerts -> SK v2 WeatherWarning
│   │   ├── WeatherProviderMapper.ts   # AccuWeather forecast / current responses -> SK v2 WeatherData envelope
│   │   ├── skV2Envelope.ts            # Shared SK v2 outside / wind / sun block builders
│   │   └── mapperUtils.ts             # requireNumber (shared mapper coercion)
│   ├── notifications/
│   │   └── WeatherNotifier.ts         # Severe-weather transition state machine
│   ├── services/
│   │   ├── WeatherService.ts          # Orchestration: fetch -> enhance -> emit (+ optional marine)
│   │   ├── OpenMeteoService.ts        # Keyless Open-Meteo current and forecast provider (default)
│   │   ├── MetNoService.ts            # Keyless Met.no current and forecast provider
│   │   ├── AccuWeatherService.ts      # AccuWeather API client + rolling 24h quota
│   │   ├── OpenMeteoMarineService.ts  # Keyless Open-Meteo Marine sea-state fetch (optional)
│   │   ├── WarningsService.ts         # Region-aware getWarnings (NWS and Met.no MetAlerts)
│   │   ├── WeatherProviderAdapter.ts  # SK v2 Weather API provider: forecasts, observations, warnings
│   │   ├── SignalKService.ts          # Vessel navigation data accessors
│   │   ├── cache/                     # CoalescingTtlCache, ForecastCache, cacheUtils
│   │   ├── http/                      # RetryingHttpClient
│   │   └── quota/                     # RollingRequestWindow
│   ├── types/                         # Public interfaces, config, weather, navigation, and per-provider API types
│   ├── utils/
│   │   ├── conversions.ts             # Unit conversions + math helpers
│   │   ├── validation.ts              # Validators, assertValidCoordinates, NMEA2000 sanitisation
│   │   ├── http.ts                    # Shared fetch helpers (fetchJson, normalizeBaseUrl, timeout)
│   │   └── skDelta.ts                 # Shared SK delta primitives (pv, me, buildValuesDelta)
│   └── __tests__/                     # Test suite mirroring source layout
├── dist/                              # esbuild output (plugin runtime)
├── public/                            # webpack output (federated config panel)
├── examples/                          # Sample plugin configurations (JSON)
├── docs/
│   ├── signal-k-paths.md              # Path, PGN, and notification reference (user-facing)
│   ├── troubleshooting.md             # Status banner troubleshooting (user-facing)
│   ├── DEVELOPMENT.md                 # This file (contributor-facing)
│   ├── decisions/                     # Design-decision and spike memos
│   └── maintainers/                   # Release checklist and manual QA checklist
├── .github/
│   ├── CONTRIBUTING.md                # Contribution guidelines
│   ├── CODE_OF_CONDUCT.md             # Code of conduct
│   ├── SECURITY.md                    # Security policy
│   ├── ISSUE_TEMPLATE/                # Bug report and feature request forms
│   ├── pull_request_template.md       # PR template
│   └── workflows/                     # CI, CodeQL, publish
├── .husky/pre-commit                  # Pre-commit hook (runs npm run validate)
├── biome.json                         # Biome configuration
├── tsconfig.json                      # TypeScript configuration
├── vitest.config.ts                   # Vitest configuration
├── esbuild.config.js                  # esbuild configuration (plugin runtime)
├── webpack.config.cjs                 # webpack configuration (config panel; .cjs because package is "type": "module")
├── package.json                       # Dependencies and scripts
├── README.md                          # User documentation
├── CHANGELOG.md                       # Version history
└── LICENSE                            # Apache 2.0 license
```

## Data Flow

```
Open-Meteo / Met.no / AccuWeather API --> CurrentWeatherProvider (extract + convert to SI units)
            (or MergingWeatherProvider)  |
                    WeatherService (add apparent wind from vessel motion)
                         |
                    NMEA2000PathMapper (validate, sanitize, map to SK paths)
                         |
                    index.ts emission timer (emit cached delta every N seconds)
                         |
                    Signal K server --> NMEA2000 emitter --> marine electronics
```

The plugin uses interval-based emission (default 5s) for reliable NMEA2000
network recognition, combined with event-driven updates when new weather data
arrives. The Signal K delta is rebuilt only when weather data actually changes.

## Development Workflow

### Initial Setup

```bash
git clone https://github.com/NearlCrews/signalk-virtual-weather-sensors.git
cd signalk-virtual-weather-sensors
npm install          # install dependencies
npm run hooks        # optional: enable the Biome pre-commit hook
node --version       # verify Node.js 20.18+
```

### Development Commands

#### Building
```bash
npm run build              # Full production build (clean, types, bundle, panel)
npm run build:types        # Generate TypeScript declarations
npm run build:bundle       # Bundle the plugin runtime with esbuild
npm run build:panel        # Bundle the federated config panel with webpack
npm run dev                # Development mode with hot reload
npm run clean              # Remove build artifacts
```

#### Testing
```bash
npm run test               # Run all tests once (registry/CI safe)
npm run test:watch         # Run tests in watch mode
npm run test:run           # Run all tests once (alias of test, used by validate)
npm run test:coverage      # Generate coverage report
npm run test:ui            # Interactive test UI
npm run mutation-test      # Stryker.js mutation-test pass (slow, opt-in; not in CI)
```

#### Code Quality
```bash
npm run lint               # Check code quality
npm run lint:fix           # Fix auto-fixable issues
npm run format             # Format all code
npm run type-check         # Verify TypeScript types
npm run validate           # Run all quality checks
npm run security-audit     # Check for vulnerabilities
```

#### Deployment
```bash
npm run build              # Production build (also runs via prepublishOnly before publish)
npm run prepublishOnly     # Validate + build before publishing
npm run release            # Tag, push, and create the GitHub release (auto-triggers npm publish workflow)
```

### Development Cycle

1. Create a feature branch from `main`: `git checkout -b feature/my-feature`
2. Develop with hot reload: `npm run dev`
3. Write tests alongside the change: `npm run test`
4. Verify code quality: `npm run validate`
5. Commit (the pre-commit hook runs `npm run validate` if you enabled it with `npm run hooks`)
6. Push and open a PR against `main`

See [CONTRIBUTING.md](../.github/CONTRIBUTING.md) for the full pull request
process, coding standards, and commit conventions.

## Testing Strategy

The suite covers unit behavior, service integration, calculation accuracy,
edge and boundary conditions, and error handling. **Total: 547 tests** across
43 test files. (`npm test` prints the current totals; the `vitest.config.ts`
coverage gate holds at 80% for branches, functions, lines, and statements.)

Coverage spans these areas:

- **Plugin lifecycle and REST**: plugin entry, the meta-delta one-shot invariant,
  banner dedupe, stale-data and quota-exhausted emission-tick branches, v2
  provider registration across every forecast-capable source, and the panel
  status and test-key routes.
- **Providers and selection**: single-provider construction from the catalog, the
  single-versus-merged top-level selection, the `supportsForecasts` seam, the
  merge orchestration with forecast delegation, the pure merge engine (field
  policy, circular-mean wind, derived recompute), and each provider's severity
  classifier (AccuWeather icon, Open-Meteo WMO, Met.no symbol code).
- **Services**: orchestration and lifecycle (single-flight coalescing, quota-aware
  banner, best-effort marine fetch), navigation data, the keyless Open-Meteo and
  Met.no clients, the AccuWeather client (retry, timeout, rolling 24h window), the
  Open-Meteo Marine client, the region-aware `WarningsService` (NWS and Met.no
  MetAlerts), the SK v2 adapter surface, and the cache, HTTP, and quota helpers.
- **Mappers**: NMEA2000 path mapping with the one-shot meta delta, each provider's
  current-block and forecast mappers, the marine mappers, the warnings mappers,
  the shared SK v2 envelope builders, and Ajv conformance against the
  `@signalk/signalk-schema@1.8.2` JSON Schema (values and meta) with a vocabulary
  assertion loaded from the live `groups/environment.json`.
- **Calculators and utils**: vector wind, wind chill, heat index, the
  base-to-derived recompute helper, unit conversions, and config and coordinate
  validation, including mutation-test-driven boundary cases.
- **Notifications**: the transition state machine across wind, visibility, heat,
  cold, and severe-condition bands, master and per-category toggles, the enriched
  per-band message format, and the `MAX_MESSAGE_LENGTH` ceiling.
- **Integration**: an end-to-end smoke against a stubbed `global.fetch`
  (happy-path delta shape, 429 retry, 401 unauthorized).

### Running Specific Tests

```bash
npx vitest run src/__tests__/calculators/WindCalculator.test.ts   # one file
npx vitest run -t "wind calculations"                              # by pattern
npm run test:ui                                                    # UI mode
```

## Performance Considerations

- **Bundle**: tree shaking, externalized node modules, minified production builds, source maps for debugging.
- **Runtime**: vessel data caching with staleness checks, centralized NMEA2000 range validation, proper resource cleanup on `stop()`.

## Security

```bash
npm run security-audit     # dependency audit
npm update                 # update dependencies
npm outdated               # check for outdated packages
```

API keys are stored in the Signal K server's plugin configuration, never
hardcoded. See [SECURITY.md](../.github/SECURITY.md) for the security policy
and [decisions/api-key-storage.md](decisions/api-key-storage.md) for the
rationale on plaintext configuration storage.

## Signal K Standards Compliance

This plugin adheres to the [Signal K 1.8.2 specification](https://signalk.org/specification/1.8.2/doc/) and the official plugin developer guide.

### Standards References

- **Specification**: [Signal K 1.8.2 vocabulary](https://signalk.org/specification/1.8.2/doc/vesselsBranch.html) and [data model](https://signalk.org/specification/1.8.2/doc/data_model.html)
- **Plugin Development**: [Signal K Plugin Guidelines](https://demo.signalk.org/documentation/Developing/Plugins.html)
- **Configuration**: [Configuration Schema Standards](https://demo.signalk.org/documentation/Developing/Plugins/Configuration.html)
- **Weather Providers**: [Weather Provider Patterns](https://demo.signalk.org/documentation/Developing/Plugins/Weather_Providers.html)

### Compliance Checklist

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Plugin Structure | Yes | Default export, async `start`/`stop` methods, schema/uiSchema |
| Configuration Schema | Yes | JSON Schema with validation in `plugin/schema.ts` `pluginSchema()`. Fields: `weatherProvider` (`open-meteo` default, `met-no`, or `accuweather`), `weatherMode` (`single` default, or `merged`), `accuWeatherApiKey` (required only for AccuWeather, validated to at least 20 chars), `openMeteoBaseUrl` (optional self-host or paid endpoint), `marineData` (sea-state toggle, off by default), `updateFrequency` (1..60 min), `emissionInterval` (1..60 s), `dailyApiQuota` (0..1000 calls per rolling 24h, 0 disables), `notifications` (object: master `enabled` plus per-category `wind`/`visibility`/`heat`/`cold`/`weather` booleans, all opt-in, master off by default) |
| Delta Message Format | Yes | `Delta` type from `@signalk/server-api`; `Update` is XOR `values \| meta`, so meta rides in a separate update entry |
| Signal K Paths (canonical) | Yes | 1.8.2 vocabulary under `environment.outside.*` (`temperature`, `pressure`, `relativeHumidity`, `dewPointTemperature`, `apparentWindChillTemperature`, `theoreticalWindChillTemperature`, `heatIndexTemperature`, `airDensity`) and `environment.wind.*` (`speedOverGround`, `directionTrue`). With the optional sea-state layer on, also `environment.water.temperature` and the `environment.current` node. |
| Signal K Paths (non-canonical) | Yes | Producer-namespaced under `environment.weather.*` (22 leaves: provider extensions like UV, visibility, cloud cover, plus AccuWeather-only pressure tendency, precipitation type, and visibility obstruction, plus plugin-derived Beaufort scale, gust factor, heat stress index). The optional sea-state layer adds wave and swell leaves under `environment.water.*`. Keeps canonical containers leaf-only as the spec requires. |
| Source Metadata | Yes | Per-provider `$source` (`SourceRef` brand) on every update: each provider declares its own `sourceRef` (`open-meteo` by default, `met-no`, `accuweather`, or `vws-merged` in merge mode), with `open-meteo-marine` on the sea-state deltas |
| Meta | Yes | One-shot meta delta on plugin start (`NMEA2000PathMapper.buildMetaDelta()`) describing units and labels for non-canonical paths |
| Status Reporting | Yes | `app.setPluginStatus` / `app.setPluginError`. Live banner string from `WeatherService.formatStatusBanner()`: `Running, last update Nm ago (N updates, K API requests, K/Q today)`, with a `Running [quota 90% used]` warning prefix and a `setPluginError` quota-exhausted state. `emitWeatherTick` re-pushes the banner on every fresh tick so the age and quota counters stay current. A `setBanner()` dedupe layer coalesces consecutive identical `(kind, message)` pushes to a single SK call. |
| Notifications | Yes | Opt-in `notifications.environment.*` deltas per SK 1.8.2 notifications.html. 11 distinct hazard paths (`wind.gale|storm|hurricane`, `visibility.low|veryLow`, `heat.caution|high|extreme`, `cold.caution|extreme`, `weather.severe`). Value shape `{ state, method, message, timestamp }`. Transition state machine in `WeatherNotifier`: a band is emitted only on entry / exit, so unchanged snapshots never write to the bus. N2K Alert PGN 126983 / 126985 bridging requires the separate `signalk-to-nmea2000` plugin. |
| `handleMessage` versioning | Yes | `app.handleMessage(id, delta, SKVersion.v1)` |
| Logging channel separation | Yes | `debug` and `info` go through `app.debug` (gated by the server's `DEBUG=signalk-virtual-weather-sensors` setting); `warn` and `error` go through `app.error` so they surface in production logs without enabling DEBUG (see `createLogger` in `src/plugin/logging.ts`). `app.setPluginError` is reserved for the Admin UI status banner, separate from log output. |

### Wind Semantics

Provider wind data is **ground-referenced** (both Open-Meteo and AccuWeather report a regional ground wind). The plugin emits two canonical wind leaves: `environment.wind.speedOverGround` and `directionTrue`. It does NOT emit `speedTrue` (which is water-referenced per the 1.8.2 vocabulary), because doing so would diverge from a real anemometer feed on any moving vessel. Calculated apparent wind is producer-namespaced (`environment.weather.windSpeedApparent` / `windAngleApparent`, the latter omitted when no heading is available) so it does not squat the canonical `environment.wind.speedApparent` / `angleApparent` leaves a masthead anemometer owns. Consumers that need water-referenced wind should derive it from `speedOverGround` and the vessel's water-track speed.

Wind direction is referenced to true north per the WMO surface-wind convention (Guide to Meteorological Instruments WMO-No. 8). AccuWeather documents the field as "azimuth degrees from north" without a qualifier; that is the universal meteorological default. The rationale is pinned in `AccuWeatherService.transformWeatherData` next to the `degreesToRadians` call.

### Humidity Format

The plugin emits `environment.outside.relativeHumidity` (the canonical 1.8.2 path) as a ratio in `[0, 1]`. AccuWeather returns relative humidity as a percentage; the value is converted to a ratio in `AccuWeatherService.transformWeatherData` via `percentageToRatio()` before reaching the mapper (see [`src/mappers/NMEA2000PathMapper.ts`](../src/mappers/NMEA2000PathMapper.ts)). The companion `signalk-nmea2000-emitter-cannon` plugin handles the conversion to the percentage format expected on the NMEA2000 wire (PGN 130313).

For the full path, PGN, and notification reference, see [signal-k-paths.md](signal-k-paths.md).

## Additional Resources

### Project Documentation
- [README.md](../README.md) - User documentation and installation
- [CHANGELOG.md](../CHANGELOG.md) - Version history
- [signal-k-paths.md](signal-k-paths.md) - Full path, PGN, and notification reference
- [troubleshooting.md](troubleshooting.md) - Status banner troubleshooting guide
- [CONTRIBUTING.md](../.github/CONTRIBUTING.md) - Contribution guidelines
- [maintainers/RELEASE.md](maintainers/RELEASE.md) - Release process
- [LICENSE](../LICENSE) - Apache 2.0 license

### External Links
- [Signal K Documentation](https://signalk.org/)
- [Signal K Plugin Development](https://demo.signalk.org/documentation/Developing/Plugins.html)
- [NMEA2000 Standards](https://www.nmea.org/)
- [Open-Meteo API](https://open-meteo.com/)
- [AccuWeather API](https://developer.accuweather.com/)
- [TypeScript Documentation](https://www.typescriptlang.org/)
- [Biome Documentation](https://biomejs.dev/)
- [Vitest Documentation](https://vitest.dev/)
