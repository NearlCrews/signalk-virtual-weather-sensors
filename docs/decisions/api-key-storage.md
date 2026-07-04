# API Key Storage

> Historical design snapshot; not maintained against shipped behavior. File references reflect the code at writing time (for example, the log-redaction pattern has since moved from `src/index.ts` to `src/plugin/logging.ts`).

**TL;DR**: Close the "encrypt the API key in configuration storage" TODO. Signal K has no plugin-facing secrets API to wrap, peer plugins all store keys in plaintext, and the live plugin already does the only meaningful hardening (`'ui:widget': 'password'`, log redaction, schema-level `minLength`). A custom symmetric-encryption layer would not raise the security floor in any realistic threat model on a single-user marine box.

## Current state

The AccuWeather key is persisted via `app.savePluginOptions(...)`, landing in `<configPath>/plugin-config-data/signalk-virtual-weather-sensors.json` (default `~/.signalk/...`). On the live install audited (DietPi, signalk-server master), the file was mode `644`, owner `dietpi`, plaintext UTF-8 JSON. The plugin declares `'ui:widget': 'password'` so the admin UI obscures the input, and `SENSITIVE_LOG_KEY_PATTERN` in `src/index.ts` redacts the key from log metadata.

## Threat model

Encryption-at-rest only helps if the unwrap key lives somewhere the attacker cannot reach. On a single-user appliance a process that can read `~/.signalk/plugin-config-data/*.json` can read everything else in `~/.signalk/`, including any key file the plugin would have to ship. Backup tarballs and shoulder-surfing the admin UI are real exposures: the password widget addresses the second, and an "encrypted" backup that bundles the unwrap key alongside the ciphertext is theatre. The mitigations that actually matter (revocable per-plugin keys at AccuWeather, log redaction, host filesystem hygiene) are either out of scope for the plugin or already in place.

## Signal K mechanisms surveyed

- `app.savePluginOptions(config, cb)` and `getPluginOptions(id)`: defined in `signalk-server/src/interfaces/plugins.ts:262-294`, which calls `atomicWriteFileSync` from `src/atomicWrite.ts`. That helper is `fs.writeFileSync(tmp, data); fs.renameSync(tmp, file)` with no `mode` argument, so files inherit the user umask (644 in practice).
- `@signalk/server-api/src/serverapi.ts` and `plugin.ts` (v2.24): zero references to `secret`, `encrypt`, `password`, `writeOnly`, `getSecret`, or `setSecret`. There is no plugin-facing key-vault API.
- The only encryption primitive in the server is `secretKey` in `src/tokensecurity.ts`, an HMAC signing key for JWTs persisted in `security.json` (mode 600). It is one-way HMAC use, not exposed to plugins, and not a symmetric vault.
- The admin UI renders schemas with `@rjsf/core` (`packages/server-admin-ui/src/views/ServerConfig/PluginConfigurationForm.tsx`), which honours `'ui:widget': 'password'` to obscure the input. Storage is still plaintext JSON.
- The official Plugin Developer Guide (`https://demo.signalk.org/documentation/Developing/Plugins.html`) does not mention secret handling. The `develop/security.html` page is 404 as of 2026-05.

## Ecosystem comparison

Three peer plugins that hold third-party API keys were spot-checked against their published source on 2026-05-10:

- `signalk-aisstream` (installed locally, dist/index.js): `apiKey: { type: 'string', default: 'YOUR_API_KEY' }`, no widget hint, plaintext on disk.
- `Saillogger/signalk-windy-plugin` (master/index.js): `apiKey: { title: '...', type: 'string' }`, no widget hint.
- `motamman/signalk-weatherflow` (main/src/index.ts): `apiToken: { type: 'string', default: '' }`, no widget hint, used directly in URL strings and WebSocket query params.
- `jaffadog/signalk-windy-plugin` (master/index.js): plain string field plus a router endpoint that returns the key over HTTP. No protection at all.

This plugin already exceeds the ecosystem baseline: password widget on the field, log redaction for any key matching `apikey|api_key|accuweatherapikey|password|secret|token`, and a schema-level `minLength: 20` so blank or obviously-malformed values fail fast.

## Recommendation

**Close the TODO.** Symmetric encryption inside the plugin would require shipping or generating an unwrap key alongside the ciphertext, which on a single-user appliance is theatre. No upstream secrets API exists to wrap, and the per-vessel filesystem is already the trust boundary the rest of `~/.signalk/` relies on. Revisit only if (1) `@signalk/server-api` adds a `getSecret/setSecret` primitive backed by OS keychain or master password, (2) the ecosystem converges on a `signalk-secrets-*` convention, or (3) the plugin starts running in a multi-tenant or shared-volume context where filesystem isolation cannot be assumed.
