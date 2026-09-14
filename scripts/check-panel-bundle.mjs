import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Repository-specific assertions about the built panel: the ESM container
 * export the Signal K Admin loader needs, the CSS module pipeline, and the
 * production JSX runtime contract. The checks every consumer of the shared UI
 * shares (exact pin against the installed release, version stamp, no bundled
 * React runtime, the published host share map, and the gzip size baseline) run
 * afterwards through `snui-check-consumer`, which the shared UI ships; see the
 * `check:panel` script.
 */

const outputDirectory = 'public';
const names = await readdir(outputDirectory);
const javascriptNames = names.filter((name) => name.endsWith('.js') || name.endsWith('.mjs'));
const cssNames = names.filter((name) => name.endsWith('.css'));
const cssSources = await Promise.all(
  cssNames.map((name) => readFile(join(outputDirectory, name), 'utf8'))
);
const combinedCss = cssSources.join('\n');
const stats = JSON.parse(await readFile('.tmp/panel-stats.json', 'utf8'));

const remoteEntry = await readFile(join(outputDirectory, 'remoteEntry.js'), 'utf8');
if (!remoteEntry.includes('export')) {
  throw new Error('The ESM Module Federation remote does not export its container.');
}
if (cssNames.length === 0) {
  throw new Error('The configuration panel did not emit its CSS module asset.');
}
for (const [index, source] of cssSources.entries()) {
  if (/\n{2,}$/.test(source)) {
    throw new Error(`Generated CSS asset ${cssNames[index]} ends with a blank line.`);
  }
}
if (combinedCss.includes('module__snui-')) {
  throw new Error('Webpack renamed a public signalk-nearlcrews-ui CSS identifier.');
}
for (const token of ['--snui-color-text-muted', '--snui-space-2']) {
  if (!combinedCss.includes(`var(${token})`)) {
    throw new Error(`The panel CSS did not preserve the public ${token} token.`);
  }
}
if (!/@container\s+snui-panel\b/.test(combinedCss)) {
  throw new Error('The panel CSS did not preserve the shared snui-panel container name.');
}

function collectModuleNames(modules = []) {
  return modules.flatMap((module) => [
    module.name,
    ...collectModuleNames(module.modules ?? []),
    ...collectModuleNames(module.children ?? []),
  ]);
}

// The host supplies the production `react/jsx-runtime`; a panel compiled
// against the development runtime fails to load, so the only React module the
// remote may carry is that runtime's production entry.
const moduleNames = collectModuleNames(stats.modules).filter((name) => typeof name === 'string');
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

console.log(
  `Panel bundle passed: ${javascriptNames.length} JavaScript files and ${cssNames.length} CSS ${cssNames.length === 1 ? 'file' : 'files'} with the ESM container export, preserved CSS identifiers and tokens, and only the production JSX runtime from React.`
);
