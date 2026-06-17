# Contributing

Thanks for your interest in contributing to Virtual Weather Sensors
(`signalk-virtual-weather-sensors`).

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.

## Reporting bugs

Check existing issues first to avoid duplicates, then open a bug report with:

- A clear title and description
- Steps to reproduce
- Expected vs actual behavior
- Environment details (plugin version, Signal K server version, Node.js
  version, OS)
- Relevant log output and the plugin configuration, with the AccuWeather
  API key redacted

## Suggesting enhancements

Open a feature request issue describing the proposed feature, the use case it
serves, and any implementation ideas you have.

## Pull requests

1. Fork the repository and create a feature branch from `main`.
2. Follow the [development guide](../docs/DEVELOPMENT.md) for setup, build,
   and test commands. Optional: enable the Biome pre-commit hook with
   `npm run hooks` (it is not auto-installed).
3. Make focused commits with clear messages (see below).
4. Add tests for any new functionality and keep the existing suite green.
5. Run `npm run validate` (type-check, lint, and tests) and `npm run build`
   before pushing.
6. Update documentation (`README.md`, `CHANGELOG.md`, `docs/`) as needed.
7. Open a pull request with a clear description of the change. For changes
   that touch emitted Signal K paths or NMEA2000 alignment, see the
   compliance checklist in
   [DEVELOPMENT.md](../docs/DEVELOPMENT.md#signal-k-standards-compliance).

## Code style

- All source is TypeScript under `src/`. The plugin runtime is bundled to
  `dist/` by esbuild; the React config panel under `src/configpanel/` is
  bundled to `public/` by webpack.
- Keep modules focused and small. Shared cross-boundary constants belong in
  `src/constants/notifications-shared.ts`; shared types in
  `src/types/index.ts`.
- Lint and format with Biome (`npm run lint`, or `npm run lint:fix` to
  auto-fix).
- Do not edit `dist/` or `public/`; they are generated build output.
- Tests live in `src/__tests__/`, mirroring the source structure, and run
  on Vitest (`npm test` for a single run, `npm run test:watch` for the
  watcher).
- Default to no comments. Add one only when the WHY is non-obvious (a hidden
  constraint, a subtle invariant, or a workaround).

## Architecture rule

This repository ships exactly ONE npm package and ONE Signal K plugin. Keep
the code modular by splitting it into focused files under `src/`. Never split
the project into multiple npm packages or a monorepo. New functionality is a
new module under `src/`, not a new package.

See [CLAUDE.md](../CLAUDE.md) for the full set of project conventions and
[docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md) for the module layout and the
build, test, and release commands.

## Commit messages

Use conventional-commit prefixes that match the actual diff scope:

```
feat: add pressure-tendency path to the weather branch
fix: clamp the rolling quota window after a backward clock jump
docs: update the configuration table for the new default cadence
test: cover the quota-exhausted emission tick
chore: update dependencies
```

## License and attribution

By contributing, you agree your contributions are licensed under the
Apache-2.0 License that covers this project. The plugin fetches data from
the AccuWeather API under AccuWeather's terms of use; do not commit API
keys, and keep the existing log redaction in place for any new code path
that could log configuration values.
