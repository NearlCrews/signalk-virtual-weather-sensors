# Development Guide

This guide covers local development, verification, architecture boundaries,
and Signal K compatibility. See [the release checklist](maintainers/RELEASE.md)
for publication steps.

## Supported environments

- Plugin runtime: Node.js 20.18 or newer
- Development: Node.js 24.18 and npm 11.18
- Language: TypeScript 7, strict mode, ES2023 target
- Signal K: server 2.x with `@signalk/server-api` 2.24 or newer for Weather API
  registration
- Panel host: Signal K admin UI 2.27 or newer with React 19.2
- Panel browser: Chromium or Edge 118+, Firefox 146+, or Safari 17.4+

The custom panel requires native CSS `@scope`. Unsupported browsers receive a
compatibility message. Older Signal K admin UIs use the JSON-schema fallback.

## Setup

```bash
git clone https://github.com/NearlCrews/signalk-virtual-weather-sensors.git
cd signalk-virtual-weather-sensors
npm install
npm run hooks
```

`npm run hooks` opts into repository-owned hooks. Pre-commit runs
`verify:commit`, and pre-push runs `verify:fast`.

## Architecture

The repository ships one npm package and one Signal K plugin.

- `src/index.ts` and the runtime modules build to `dist/index.js` with esbuild.
- `src/configpanel/PluginConfigurationPanel.tsx` is the panel composition root.
- `src/configpanel/components/` contains domain-specific panel components.
- `src/configpanel/hooks/` owns form state and live status polling.
- `src/constants/notifications-shared.ts` contains browser-safe defaults,
  labels, bounds, provider registries, and validation shared with the runtime.
- `src/types/` contains shared TypeScript contracts.
- `webpack.config.cjs` emits the ESM Module Federation remote to `public/`.
- `fixtures/browser/` hosts the built remote with a React share scope that
  matches the Signal K admin host.
- `tests/browser/` verifies production federation behavior with Playwright.

The panel uses `signalk-nearlcrews-ui` for themes, layout, fields, feedback,
metrics, collapsible sections, and actions. Keep provider, quota, status, and
save-confirmation behavior local to this plugin. Project CSS must stay in
focused CSS modules and use public `--snui-*` tokens.

React is a host-provided Module Federation singleton with the range
`>=19.2.0 <20.0.0` and `import: false`. The shared UI library is bundled into
the remote. `npm run check:panel` proves that React is not bundled, the shared
UI library is present, CSS identifiers and container names survive webpack,
and the size budget is respected.

`npm run boundaries` rejects circular imports, server-to-panel imports, and
panel imports of Node-only runtime modules. The panel may import pure constants
and types.

## Commands

### Build

```bash
npm run build
npm run build:types
npm run build:bundle
npm run build:panel
npm run check:panel
npm run package:check
npm run size
```

The full build cleans generated output, emits declarations, builds the Node
bundle, builds the panel, and checks the panel artifacts.

### Tests

```bash
npm test
npm run test:watch
npm run test:coverage
npm run test:browser
npm run test:browser:cross
npm run test:integration
npm run mutation-test
```

`test:browser` builds first and tests the production remote in Chromium.
`test:browser:cross` runs Chromium, Firefox, WebKit, and mobile Chromium. Use
`test:browser:built` and `test:browser:cross:built` only after a current build.

`test:integration` expects a running Signal K server at `SIGNALK_URL`, which
defaults to `http://127.0.0.1:3000`. Set `SIGNALK_AUTHORIZATION` to the complete
Authorization header when the server protects plugin discovery.

### Quality and verification

```bash
npm run lint
npm run format:check
npm run type-check
npm run boundaries
npm run deadcode
npm run audit:runtime
npm run audit:full
npm run verify:commit
npm run verify:fast
npm run verify
npm run verify:browser
npm run verify:release
```

The layers are intentional:

- `verify:commit`: formatting, linting, Markdown, spelling, workflow policy,
  boundaries, and dead code
- `verify:fast`: commit checks plus all TypeScript programs
- `verify`: fast checks, coverage, build, size, package contents, and runtime
  audit
- `verify:browser`: verify plus Chromium against the built remote
- `verify:release`: verify plus all supported browser projects and the full
  dependency audit

## Browser and screenshot work

Install browsers once:

```bash
npx playwright install --with-deps chromium firefox webkit
```

Run `npm run screenshots:panel` after a visible panel change. It builds the
production remote and updates the three images in `assets/screenshots/` through
the same fixture used by Playwright. Inspect the status, notification, and
night-red images before committing them.

For layout changes, check both a 320-pixel viewport and a 320-pixel panel
embedded inside a wide host. Keep controls usable with coarse pointers, and run
the Axe coverage in the browser suite.

## Dependency policy

Use current compatible releases. Do not force a major upgrade past a runtime,
peer, or tool compatibility boundary. Useful checks are:

```bash
npm update --dry-run --json
npm audit --omit=dev
npm audit
```

TypeScript 7 intentionally takes precedence over tools that still require the
TypeScript 6 compiler API. A tool that reports success without inspecting
TypeScript modules is not an acceptable gate.

`signalk-nearlcrews-ui` is pinned exactly while it is in the 0.x series. Review
its migration notes before changing that version.

## Continuous integration

- `ci.yml` runs the full release verification on Node 24.18 and a separate,
  blocking type-check and production-build lane on the Node 20.18 runtime
  floor. Current Vitest and Rolldown require Node 20.19 or newer, so tests run
  on the supported development runtimes instead.
- `plugin-ci.yml` pins the official Signal K reusable workflow and tests Node
  22 and 24, Signal K 2.24 and current, armv7, packaging, and installation.
- `codeql.yml` runs the extended JavaScript and TypeScript query suite.
- `publish.yml` verifies a release, packs once, uploads the exact tarball, and
  publishes that artifact in a separate job.

The upstream armv7 job is advisory in the reusable workflow, but a red armv7
result is release-blocking for this project.

## Signal K standards compliance

- Store configuration and emitted values in SI units. Convert only at display
  boundaries, following the server's unit preference.
- Use official Signal K paths and APIs. Do not use QuestDB as proof that a
  composite path exists.
- Keep optional Weather API registration feature-detected and nonfatal on older
  supported servers.
- Preserve provider `$source` values so onboard sensors can win through source
  priority.
- Treat weather data and notifications as advisory. Do not weaken the existing
  API-key redaction, request limits, validation, or timeout behavior.
- Update `docs/signal-k-paths.md`, schema tests, mapping tests, and metadata when
  emitted paths change.

## Pull requests

Use a focused branch, add tests with behavior changes, update documentation,
and run verification appropriate to the risk. Do not edit `dist/` or `public/`
directly. They are generated by the build.
