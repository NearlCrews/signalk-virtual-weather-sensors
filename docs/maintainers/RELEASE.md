# Release Checklist

Publishing requires explicit final approval. Do not create a release tag or
publish to npm until that approval has been given for the prepared commit.

## Prepare

1. Start from an up-to-date `main` branch with a clean worktree.
2. Update the version in `package.json` and `package-lock.json` without creating
   a tag.
3. Move the Unreleased changelog entries into a dated version section with an
   `<a id="vXYZ"></a>` anchor.
4. Replace the README `What's new` section with the new release summary.
5. Update documentation and run `npm run screenshots:panel` when the panel has
   changed.
6. Confirm package metadata, app icon, screenshots, keywords, and Signal K
   scoring inputs.

## Verify

Use Node 24.19.0 and npm 12.0.2:

```bash
npm ci
npx playwright install --with-deps chromium firefox webkit
npm run verify:release
npm update --dry-run --json
npm audit --omit=dev
npm audit
npm pack --dry-run --json --ignore-scripts
```

Also verify:

- The blocking Node 20.18 compatibility lane passes. It is the only CI lane
  that runs Node 20, and no CI lane runs on 32-bit ARM hardware.
- CI is green on `main` HEAD, which is the release commit: the official Signal
  K plugin workflow and the `signalk-admin` job, which mounts the production
  panel in Signal K 2.27.0 and the latest server, both pass there.
- CodeQL completes successfully and no open alert is introduced.
- The built panel uses host-shared React and stays within its approved bundle
  budget.
- Runtime and full dependency audits have no high-severity findings.

## Approval and release

1. Present the exact commit, version, changelog, verification results, package
   contents, and any accepted size or compatibility exceptions.
2. Obtain explicit final approval to tag and publish.
3. Create the annotated `vX.Y.Z` tag on the approved commit and push only that
   tag.
4. Create and publish the GitHub Release from that tag.

Publishing the GitHub Release triggers `.github/workflows/publish.yml`. The
workflow verifies the tag and commit, runs `verify:release`, packs once, uploads
the exact tarball, and publishes that downloaded artifact from a separate job
with npm provenance. npm skips lifecycle scripts such as `prepublishOnly` when it
publishes a packed tarball, so the workflow's explicit `verify:release` step,
which includes the full dependency audit, is the release gate.

The local approval guard is intentionally explicit:

```bash
SVWS_RELEASE_APPROVED=true npm run release:check
```

Set it only after final approval. The repository has no script that tags,
pushes, or creates a release automatically.

## Post-publish verification

After both workflow jobs complete successfully:

```bash
npm view signalk-virtual-weather-sensors version gitHead dist-tags time --json
npm view signalk-virtual-weather-sensors dist.integrity dist.shasum --json
```

Then confirm:

- The npm version and GitHub Release tag match.
- The npm `gitHead` matches the approved release commit.
- Provenance is present on npm.
- The App Store listing shows the current Admin hero first.
- The package installs in a clean temporary Signal K environment.
- `dist/index.js`, declarations, `public/remoteEntry.js`, panel chunks, CSS,
  icons, screenshots, README, license, and changelog are present.
- The published commit has green CI, Signal K plugin CI, browser, CodeQL, and
  publish results.
- The installed plugin registers, serves its status API and panel remote, and
  degrades cleanly when optional Weather API support is unavailable.

Do not call the release complete while any required job is queued or running.

## Registry follow-up

The Signal K plugin registry scores the published version on its own schedule
(a nightly run, or on demand through a `/rescore` request in the registry
repository), and the server caches its index, so the score cannot be known at
release time. After the registry has run, read
`https://signalk.org/signalk-plugin-registry/plugins/signalk-virtual-weather-sensors.json`
and check which `version` it scored. If it still lists the previous version,
the new one is simply not scored yet; do not cut another release to chase it.
Only when it scored the new version below 100 is there something to fix.
