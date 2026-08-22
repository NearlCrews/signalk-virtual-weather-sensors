import { readFileSync } from 'node:fs';

/**
 * The exact signalk-nearlcrews-ui release this panel is built and verified
 * against. The shared UI ships breaking changes in minor releases, so an
 * unreviewed dependency bump must fail the panel checks rather than reach a
 * build: bumping the dependency means bumping this constant too, after
 * working through the package's migration notes.
 */
const EXPECTED_SHARED_UI_VERSION = '0.8.2';

/**
 * An exact version in the package's 0.x series and nothing else: no range
 * operator, no prerelease tag. This shape guard is deliberately separate from
 * the literal above and must NEVER be hand-edited to accommodate a value that
 * failed it. Equality against the literal alone leaves a repair-path hole:
 * once `npm install signalk-nearlcrews-ui@latest` has written `^0.9.0`, the
 * tempting repair is to paste the failing value into the literal, after which
 * both sides read `^0.9.0`, the check passes, and its message still claims
 * exactness. The shape guard rejects that paste whatever the literal says.
 */
const EXACT_ZERO_X_VERSION = /^0\.\d+\.\d+$/;

/**
 * Throws unless `value` is an exact 0.x version. `source` names the pin site
 * the value came from, so a failure points at the file to fix, and the
 * received value is always reported.
 */
export function assertExactSharedUiPin(value, source) {
  if (typeof value !== 'string' || !EXACT_ZERO_X_VERSION.test(value)) {
    throw new Error(
      `${source} must pin signalk-nearlcrews-ui to an exact 0.x version such as 0.8.2, not ${JSON.stringify(value)}.`
    );
  }
}

/**
 * Asserts that the manifest pin and the installed package both match the
 * expected release. Returns the resolved version, which the panel checks also
 * assert against the rendered `data-snui-version` root attribute.
 */
export function assertSharedUiVersion(repositoryUrl) {
  const packageJson = JSON.parse(readFileSync(new URL('package.json', repositoryUrl), 'utf8'));
  const manifestVersion = packageJson.devDependencies?.['signalk-nearlcrews-ui'];
  assertExactSharedUiPin(manifestVersion, 'package.json');
  if (manifestVersion !== EXPECTED_SHARED_UI_VERSION) {
    throw new Error(
      `signalk-nearlcrews-ui must be pinned to exact version ${EXPECTED_SHARED_UI_VERSION}, not ${manifestVersion}.`
    );
  }
  const installedVersion = JSON.parse(
    readFileSync(new URL('node_modules/signalk-nearlcrews-ui/package.json', repositoryUrl), 'utf8')
  ).version;
  if (installedVersion !== manifestVersion) {
    throw new Error(
      `Installed signalk-nearlcrews-ui ${String(installedVersion)} does not match package.json ${manifestVersion}.`
    );
  }
  return installedVersion;
}
