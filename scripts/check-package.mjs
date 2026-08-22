import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (Object.hasOwn(packageJson, 'gitHead')) {
  throw new Error(
    'gitHead must be injected into the release artifact, not committed to package.json.'
  );
}
if (packageJson.packageManager !== 'npm@12.0.2') {
  throw new Error('packageManager must pin the contributor and release toolchain to npm 12.0.2.');
}
const { stdout } = await execFileAsync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['pack', '--dry-run', '--json', '--ignore-scripts'],
  { maxBuffer: 10 * 1024 * 1024 }
);
const parsedPackResult = JSON.parse(stdout);
const packResults = Array.isArray(parsedPackResult)
  ? parsedPackResult
  : Object.values(parsedPackResult);
if (packResults.length !== 1 || !Array.isArray(packResults[0]?.files)) {
  throw new Error('npm pack must return exactly one package with a file manifest.');
}
const [packResult] = packResults;
const files = new Set(packResult.files.map((file) => file.path));
const normalizeDeclaredPath = (declaredPath) => declaredPath.replace(/^\.\//, '');

for (const requiredPath of [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/index.js.map',
  'package.json',
  'public/remoteEntry.js',
]) {
  if (!files.has(requiredPath)) throw new Error(`Packed package is missing ${requiredPath}.`);
}

const rootExport = packageJson.exports?.['.'];
const declaredEntrypoints = [
  ['main', packageJson.main],
  ['types', packageJson.types],
  [
    'exports["."].import',
    typeof rootExport === 'object' && rootExport !== null ? rootExport.import : rootExport,
  ],
  [
    'exports["."].types',
    typeof rootExport === 'object' && rootExport !== null ? rootExport.types : undefined,
  ],
];
for (const [field, declaredPath] of declaredEntrypoints) {
  if (typeof declaredPath !== 'string' || !declaredPath.trim()) {
    throw new Error(`${field} must declare a non-empty package-relative entrypoint.`);
  }
  const packedPath = normalizeDeclaredPath(declaredPath.trim());
  if (packedPath.startsWith('../') || packedPath.startsWith('/') || !files.has(packedPath)) {
    throw new Error(`${field} does not resolve to packed file ${packedPath}.`);
  }
}

if (![...files].some((file) => /^public\/.+\.mjs$/.test(file))) {
  throw new Error('Packed package is missing the panel JavaScript chunks.');
}
if (![...files].some((file) => /^public\/.+\.css$/.test(file))) {
  throw new Error('Packed package is missing the panel CSS asset.');
}
for (const entry of await readdir('public', { withFileTypes: true })) {
  if (entry.isFile() && !files.has(`public/${entry.name}`)) {
    throw new Error(`Packed package is missing generated panel asset public/${entry.name}.`);
  }
}

const screenshots = packageJson.signalk?.screenshots;
if (!Array.isArray(screenshots) || screenshots.length === 0) {
  throw new Error('signalk.screenshots must list the App Store hero and detail images.');
}
const declaredAssets = [
  ['signalk.appIcon', packageJson.signalk?.appIcon],
  ...screenshots.map((declaredPath, index) => [`signalk.screenshots[${index}]`, declaredPath]),
];
for (const [field, declaredPath] of declaredAssets) {
  if (typeof declaredPath !== 'string' || !declaredPath.trim()) {
    throw new Error(`${field} must declare a non-empty package-relative asset path.`);
  }
  const packedPath = normalizeDeclaredPath(declaredPath.trim());
  if (packedPath.startsWith('../') || packedPath.startsWith('/') || !files.has(packedPath)) {
    throw new Error(`${field} does not resolve to packed file ${packedPath}.`);
  }
}

const heroPath = normalizeDeclaredPath(screenshots[0]);
if (heroPath !== 'assets/screenshots/00-admin-hero.png') {
  throw new Error('The current Admin hero must be the first App Store screenshot.');
}
const hero = await readFile(heroPath);
if (
  hero.subarray(1, 4).toString('ascii') !== 'PNG' ||
  hero.readUInt32BE(16) !== 1280 ||
  hero.readUInt32BE(20) !== 800
) {
  throw new Error('The first App Store screenshot must be a 1280 by 800 PNG hero image.');
}
if (hero.byteLength > 500_000) {
  throw new Error('The first App Store screenshot must remain under 500 KB.');
}

for (const file of files) {
  if (
    file.startsWith('src/') ||
    file.startsWith('tests/') ||
    file.startsWith('fixtures/') ||
    file.startsWith('docs/superpowers/') ||
    file.startsWith('.tmp/')
  ) {
    throw new Error(`Packed package contains development-only file ${file}.`);
  }
}

if (packageJson.dependencies?.['signalk-nearlcrews-ui']) {
  throw new Error('signalk-nearlcrews-ui must be a bundled development dependency.');
}
if (packageJson.devDependencies?.['signalk-nearlcrews-ui'] !== '0.8.0') {
  throw new Error('The UI package must be pinned to exact version 0.8.0 during its 0.x series.');
}

console.log(`Packed package passed: ${files.size} files in ${packResult.filename}.`);
