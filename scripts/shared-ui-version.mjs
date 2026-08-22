import { readFileSync } from 'node:fs';

/**
 * The exact signalk-nearlcrews-ui release this panel is built and verified
 * against. The shared UI ships breaking changes in minor releases, so an
 * unreviewed dependency bump must fail the panel checks rather than reach a
 * build: bumping the dependency means bumping this constant too, after
 * working through the package's migration notes.
 */
const EXPECTED_SHARED_UI_VERSION = '0.8.0';

/**
 * Asserts that the manifest pin and the installed package both match the
 * expected release. Returns the resolved version, which the panel checks also
 * assert against the rendered `data-snui-version` root attribute.
 */
export function assertSharedUiVersion(repositoryUrl) {
  const packageJson = JSON.parse(readFileSync(new URL('package.json', repositoryUrl), 'utf8'));
  const manifestVersion = packageJson.devDependencies?.['signalk-nearlcrews-ui'];
  if (manifestVersion !== EXPECTED_SHARED_UI_VERSION) {
    throw new Error(
      `signalk-nearlcrews-ui must be pinned to exact version ${EXPECTED_SHARED_UI_VERSION}.`
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
