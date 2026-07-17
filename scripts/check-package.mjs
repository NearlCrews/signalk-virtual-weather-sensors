import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const { stdout } = await execFileAsync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['pack', '--dry-run', '--json', '--ignore-scripts'],
  { maxBuffer: 10 * 1024 * 1024 }
);
const [packResult] = JSON.parse(stdout);
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

const declaredAssets = [
  ['signalk.appIcon', packageJson.signalk?.appIcon],
  ...(packageJson.signalk?.screenshots ?? []).map((declaredPath, index) => [
    `signalk.screenshots[${index}]`,
    declaredPath,
  ]),
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
if (packageJson.devDependencies?.['signalk-nearlcrews-ui'] !== '0.3.0') {
  throw new Error('The UI package must be pinned to exact version 0.3.0 during its 0.x series.');
}

console.log(`Packed package passed: ${files.size} files in ${packResult.filename}.`);
