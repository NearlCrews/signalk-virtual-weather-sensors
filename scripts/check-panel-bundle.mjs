import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const outputDirectory = 'public';
const names = await readdir(outputDirectory);
const javascriptNames = names.filter((name) => name.endsWith('.js') || name.endsWith('.mjs'));
const cssNames = names.filter((name) => name.endsWith('.css'));
const assetNames = [...javascriptNames, ...cssNames];
const files = await Promise.all(
  javascriptNames.map(async (name) => ({
    name,
    source: await readFile(join(outputDirectory, name), 'utf8'),
  }))
);
const assets = await Promise.all(
  assetNames.map(async (name) => ({
    name,
    source: await readFile(join(outputDirectory, name)),
  }))
);
const combinedCss = assets
  .filter((asset) => asset.name.endsWith('.css'))
  .map((asset) => asset.source.toString('utf8'))
  .join('\n');
const stats = JSON.parse(await readFile('.tmp/panel-stats.json', 'utf8'));
const baseline = JSON.parse(await readFile('scripts/panel-size-baseline.json', 'utf8'));

if (stats.errorsCount !== 0 || stats.warningsCount !== 0) {
  throw new Error(
    `Panel build reported ${stats.errorsCount} errors and ${stats.warningsCount} warnings.`
  );
}

const remoteEntry = files.find((file) => file.name === 'remoteEntry.js');
if (!remoteEntry?.source.includes('export')) {
  throw new Error('The ESM Module Federation remote does not export its container.');
}
if (cssNames.length === 0) {
  throw new Error('The configuration panel did not emit its CSS module asset.');
}
for (const asset of assets.filter((candidate) => candidate.name.endsWith('.css'))) {
  if (/\n{2,}$/.test(asset.source.toString('utf8'))) {
    throw new Error(`Generated CSS asset ${asset.name} ends with a blank line.`);
  }
}
if (combinedCss.includes('module__snui-')) {
  throw new Error('Webpack renamed a public signalk-nearlcrews-ui CSS identifier.');
}
for (const token of ['--snui-color-text', '--snui-space-2']) {
  if (!combinedCss.includes(`var(${token})`)) {
    throw new Error(`The panel CSS did not preserve the public ${token} token.`);
  }
}
if (!/@container\s+snui-panel\b/.test(combinedCss)) {
  throw new Error('The panel CSS did not preserve the shared snui-panel container name.');
}

const combined = files.map((file) => file.source).join('\n');
if (!combined.includes('data-snui-version')) {
  throw new Error('The configuration panel did not bundle signalk-nearlcrews-ui.');
}
for (const marker of [
  '__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE',
  'react.production.min',
  'react-dom.production.min',
]) {
  if (combined.includes(marker)) {
    throw new Error(`The configuration panel bundled a React implementation marker: ${marker}.`);
  }
}

function collectModuleNames(modules = []) {
  return modules.flatMap((module) => [
    module.name,
    ...collectModuleNames(module.modules ?? []),
    ...collectModuleNames(module.children ?? []),
  ]);
}

const moduleNames = collectModuleNames(stats.modules).filter((name) => typeof name === 'string');
if (!moduleNames.some((name) => name.includes('signalk-nearlcrews-ui'))) {
  throw new Error('Webpack statistics do not show the shared UI package in the panel bundle.');
}
if (!moduleNames.some((name) => name.startsWith('consume shared module (default) react@'))) {
  throw new Error('The panel is not consuming React from the Module Federation host share scope.');
}

const bundledReactModules = moduleNames.filter((name) =>
  /node_modules[\\/]react(?:-dom)?[\\/]/.test(name)
);
const unexpectedReactModules = bundledReactModules.filter(
  (name) =>
    !/[\\/]react[\\/]jsx-runtime\.js$/.test(name) &&
    !/[\\/]react[\\/]cjs[\\/]react-jsx-runtime\.production\.js$/.test(name)
);
if (unexpectedReactModules.length > 0) {
  throw new Error(
    `The panel bundled unexpected React modules: ${unexpectedReactModules.join(', ')}.`
  );
}

const rawBytes = assets.reduce((total, file) => total + file.source.byteLength, 0);
const gzipBytes = assets.reduce(
  (total, file) => total + gzipSync(file.source, { level: 9 }).byteLength,
  0
);
const maximumGzipBytes = Math.floor(
  baseline.gzipBytes * (1 + baseline.maximumIncreasePercent / 100)
);
let sizeSummary = `${gzipBytes} gzip bytes`;
if (gzipBytes > maximumGzipBytes) {
  const increase = (((gzipBytes - baseline.gzipBytes) / baseline.gzipBytes) * 100).toFixed(1);
  const approvedCeiling = baseline.approvedCeilingGzipBytes;
  if (!Number.isInteger(approvedCeiling)) {
    throw new Error(
      `Panel gzip size is ${gzipBytes} bytes, ${increase}% above the ${baseline.gzipBytes}-byte baseline and over the unapproved ${baseline.maximumIncreasePercent}% limit.`
    );
  }
  if (gzipBytes > approvedCeiling) {
    throw new Error(
      `Panel gzip size is ${gzipBytes} bytes, ${increase}% above the ${baseline.gzipBytes}-byte baseline and over the approved ${approvedCeiling}-byte ceiling.`
    );
  }
  sizeSummary += `, ${increase}% above the original baseline and within the approved ${approvedCeiling}-byte migration ceiling`;
}

console.log(
  `Panel bundle passed: ${javascriptNames.length} JavaScript files, ${cssNames.length} CSS ${cssNames.length === 1 ? 'file' : 'files'}, ${rawBytes} raw bytes, ${sizeSummary}, and host-shared React.`
);
