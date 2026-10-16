# Development Guide

This guide covers local development, verification, architecture boundaries,
and Signal K compatibility. See [the release checklist](maintainers/RELEASE.md)
for publication steps.

## Supported environments

- Plugin runtime: Node.js 20.18 or newer
- Development: Node.js `^22.22.2 || ^24.15.0 || ^26.0.0` and npm 12.0.2
- Language: TypeScript 7, strict mode, ES2023 target
- Signal K: server 2.x with `@signalk/server-api` 2.24 or newer for Weather API
  registration
- Panel host: Signal K admin UI 2.27 or newer with React 19.2
- Panel browser: Chromium or Edge 118+, Firefox 146+, or Safari 17.4+

The custom panel requires native CSS `@scope`. Unsupported browsers receive a
compatibility message. Admin builds without custom panel support use the
JSON-schema form. Admin 2.24 and earlier support custom panels but cannot
import an ESM remote (that arrived in 2.25), so they show "Error loading
component" with no form; verified on Signal K 2.24.0.

## Setup

```bash
git clone https://github.com/NearlCrews/signalk-virtual-weather-sensors.git
cd signalk-virtual-weather-sensors
npm ci
npm run hooks
```

`npm run hooks` opts into repository-owned hooks. Pre-commit runs
`verify:commit`, and pre-push runs `verify`.

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

The panel uses `signalk-nearlcrews-ui` for the panel shell, themes, layout,
fields, the number field, feedback, metrics, collapsible sections, and the save
bar. Keep provider, quota, status, and save-confirmation behavior local to this
plugin. Project CSS must stay in focused CSS modules and use public `--snui-*`
tokens; the panel never re-implements a primitive the shared UI provides.

The shared UI is pinned exactly at 0.14.0. Fresh profiles use Match Admin
without writing an implicit preference. Match Admin follows an explicit host
theme and otherwise stays Light; Match device is the explicit operating-system
preference.
Retired plugin-specific theme keys are ignored, and only
`signalk-nearlcrews-ui.theme.v1` is authoritative.

React and React DOM are host-provided Module Federation singletons. The
`shared` map comes from `signalk-nearlcrews-ui/federation`, the map the shared
UI was verified with: the range `^19.2.0`, `import: false`, and deliberately no
`strictVersion`, because the Signal K Admin registers its React share below the
version it actually ships (2.24.0 registers 19.0.0 while bundling 19.2.4), so a
strict check refuses to mount on a fully compatible host. A version mismatch
warns and continues. The shared UI library is bundled into the remote.
`npm run check:panel` runs the repository's own checks (non-strict shares, the
shared container name surviving webpack, and CSS file endings) and then
`snui-check-consumer` from the shared UI with `--stats`, `--styles`, and
`--runtime`. That proves the host loading contract and ESM container export, the
exact pin and where it is declared, the version stamp, the CSS token and
container names, the production JSX runtime and single copies of the library
and React Aria from the build stats, no single-class CSS module override of a
package component under `src/configpanel`, a render of the built panel with
`configuration` undefined and `{}`, the published share map, and a gzip size
within `scripts/panel-size-baseline.json`.

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

`test:integration` checks an installed copy of the plugin inside a running
Signal K server: the server loads and enables it, serves its status API and
panel remote, and the Admin mounts the production panel in headless Chromium.
`SIGNALK_URL` must name the server under test; there is deliberately no default,
so the check never touches a live boat server by accident. Point it at a
throwaway server with the packed tarball installed, the way the `signalk-admin`
CI job does. Set `SIGNALK_AUTHORIZATION` to the complete Authorization header
when that server has security enabled, and `SIGNALK_BROWSER_CHANNEL` to use an
installed browser channel such as `chrome` instead of Playwright's Chromium.

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
  boundaries, and dead code (the pre-commit hook)
- `verify:fast`: commit checks plus all TypeScript programs
- `verify`: fast checks, coverage, build, size, package contents, and runtime
  audit (the pre-push hook and the CI gate); no browser suite and no
  development-tree audit
- `verify:browser`: verify plus Chromium against the built remote
- `verify:release`: verify plus all supported browser projects and the full
  dependency audit

`npm run ci:workflows` and `npm run package:check` also pin the shape of this
pipeline: the workflow set is fixed, every workflow pins actions by SHA and
declares concurrency, the development-tree audit never runs on push or pull
request, plugin CI runs weekly after every other schedule, every workflow that
runs a Playwright suite installs each engine `playwright.config.ts` uses, the
hooks run the gates above, `README.md` carries no relative link targets (the
Signal K App Store renders them dead), and `biome.json` reads its schema from
the installed Biome. `npm run check:panel` rejects any `strictVersion`
federation share.

## Browser and screenshot work

Install browsers once:

```bash
npx playwright install --with-deps chromium firefox webkit
```

Run `npm run screenshots:panel` after a visible panel change. It builds the
production remote and updates the four images in `assets/screenshots/` through
the same fixture used by Playwright. Inspect the admin hero, status,
notification, and night-red images before committing them. The hero
(`00-admin-hero.png`) is the image the Signal K App Store shows first, so it is
the one most worth a second look.

For layout changes, check both a 320-pixel viewport and a 320-pixel panel
embedded inside a wide host. Keep controls usable with coarse pointers, and run
the Axe coverage in the browser suite.

## Dependency policy

Use current compatible releases. Do not force a major upgrade past a runtime,
peer, or tool compatibility boundary. Useful checks are:

```bash
npm outdated --json
npm update --dry-run --json
npm audit --omit=dev
npm audit
```

TypeScript 7 intentionally takes precedence over tools that still require the
TypeScript 6 compiler API. A tool that reports success without inspecting
TypeScript modules is not an acceptable gate.

Node 20.18 remains the plugin runtime floor, so the blocking Node 20.18
build and smoke-load lane must stay green, and runtime code must not rely on
APIs introduced after that floor. Two dependency rules follow from it.

`@types/node` stays on the major that matches `engines.node`, taking the latest
release within that major, so type-checking sees the API surface the published
package actually promises rather than a newer one.
`npm run package:check` fails when the two majors disagree.

The test toolchain does not have to meet the runtime floor. Vitest 5 declares
`engines.node` of `^22.12.0 || ^24.0.0 || >=26.0.0`, which excludes Node 20, but
a Signal K plugin runs inside the server process and `signalk-server` declares
`node: >=22`, so no supported installation ever executes this plugin on Node 20.
The Node 20.18 lane therefore proves the plugin runtime: it installs, builds,
and smoke-loads the built plugin with `npm run check:runtime`. Type-checking and
module boundaries do not vary by Node, so they run once, in the verify lane.
`@types/node` pinned to the floor major keeps that type-check honest. `npm test` there prints a notice naming the Vitest
floor and exits 0, guarded by `scripts/unit-test-toolchain.mjs`, whose floors are
written out rather than parsed and are pinned at their boundaries by
`scripts/test-unit-test-toolchain.mjs` from `npm run package:check`. Bump those
floors when Vitest bumps its own, and extend the boundary test.

Vitest's `@types/node` peer range of `^22.0.0 || >=24.0.0` would otherwise block
resolution against a root pinned to major 20. An `overrides` block points that
peer at the root `@types/node`, so one copy of the Node types is installed and it
is the copy that matches the runtime floor.

`signalk-nearlcrews-ui` is pinned exactly while it is in the 0.x series. Review
its migration notes before changing that version.

## Continuous integration

- `ci.yml` runs `verify` and the cross-browser matrix once, on Node 24.19.0.
  The lane stops short of `verify:release`, whose last step audits the whole
  development tree: that advisory database changes without a commit, so one
  new development advisory would turn every open pull request red for
  something none of them introduced. The runtime audit the registry scores
  still runs inside `verify`.
- `ci.yml` also runs a blocking runtime-floor lane on Node 20.18 that installs,
  builds, and smoke-loads the built plugin. It proves the plugin runtime, not
  the test toolchain: Vitest 5 requires Node 22.12 or newer, so `npm test`
  there prints a notice and skips. The lane uses npm 11.19 because npm 12
  starts at Node 22.22.2.
- The `signalk-admin` job in `ci.yml` installs the packed tarball into a real
  Signal K server, 2.27.0 (the documented panel floor) and the latest release,
  starts it, and runs `npm run test:integration`, which mounts the production
  panel through the Admin in a real browser. The panel is an ESM remote, and
  the Admin first imports ESM remotes in 2.25.0, so on 2.24 the plugin runs
  but its panel cannot mount.
- `plugin-ci.yml` pins the official Signal K reusable workflow and tests Node
  22 and 24 on Linux x64, Linux arm64, macOS, and Windows, plus packaging and
  installation. Its format, coverage, and integration jobs stay off because
  `ci.yml` covers them. It has no tag trigger: the registry credits the run on
  the release commit's push to `main`. It also runs weekly, after every other
  Monday schedule, because the registry reads only the newest 20 Actions runs
  on the published commit and scheduled and Dependabot runs can otherwise push
  the plugin-ci run out of that window.
- `codeql.yml` runs the extended JavaScript and TypeScript query suite.
- `workflow-security.yml` runs actionlint and zizmor against workflow and
  Dependabot changes and on a weekly schedule. Its `dependency-audit` job runs
  the full development-tree audit only on that schedule and on demand, never
  on push or pull request; a scheduled failure emails the owner. It shares this
  workflow instead of adding one, since every extra run on `main` competes for
  the registry's 20-run window.
- `publish.yml` verifies a release, runs `verify:release` (including the full
  audit) as its release gate, packs once, uploads the exact tarball, and
  publishes that artifact in a separate job. npm skips `prepublishOnly` when it
  publishes a packed tarball, so that explicit step is the gate.

The reusable workflow no longer has an armv7 or Node 20 job, so the blocking
runtime-floor lane in `ci.yml` is the only CI coverage of Node 20, and no CI
lane runs on 32-bit ARM hardware such as the Cerbo GX.

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
