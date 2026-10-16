import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { findStrictVersionShares } from './pipeline-guards.mjs';

/**
 * Repository-specific assertions about the built panel: non-strict federation
 * shares and the CSS module pipeline. The checks every consumer of the shared
 * UI shares (the host loading contract and ESM container export, exact pin and
 * its placement, version stamp, CSS token and container names, the production
 * JSX runtime and single copies of the library and React Aria from the build
 * stats, single-class CSS module overrides, a runtime render, the published
 * host share map, and the gzip size baseline) run afterwards through
 * `snui-check-consumer`, which the shared UI ships; see the `check:panel`
 * script.
 */

// The share map is checked as webpack receives it, the shared UI's published
// map included, so a strict share from either source fails.
const require = createRequire(import.meta.url);
const federation = require('../webpack.config.cjs').plugins.find(
  (plugin) => plugin.constructor.name === 'ModuleFederationPlugin'
);
if (!federation) {
  throw new Error('webpack.config.cjs no longer configures the ModuleFederationPlugin.');
}
const strictShares = findStrictVersionShares(federation.options?.shared);
if (strictShares.length > 0) {
  throw new Error(
    `Module Federation shares must not set strictVersion: ${strictShares.join(', ')}. Signal K 2.24 Admin registers React 19.0.0 while shipping 19.2.4, so a strict share never mounts on it.`
  );
}

const outputDirectory = 'public';
const names = await readdir(outputDirectory);
const javascriptNames = names.filter((name) => name.endsWith('.js') || name.endsWith('.mjs'));
const cssNames = names.filter((name) => name.endsWith('.css'));
const cssSources = await Promise.all(
  cssNames.map((name) => readFile(join(outputDirectory, name), 'utf8'))
);
const combinedCss = cssSources.join('\n');
if (cssNames.length === 0) {
  throw new Error('The configuration panel did not emit its CSS module asset.');
}
for (const [index, source] of cssSources.entries()) {
  if (/\n{2,}$/.test(source)) {
    throw new Error(`Generated CSS asset ${cssNames[index]} ends with a blank line.`);
  }
}
if (!/@container\s+snui-panel\b/.test(combinedCss)) {
  throw new Error('The panel CSS did not preserve the shared snui-panel container name.');
}

console.log(
  `Panel bundle passed: ${javascriptNames.length} JavaScript files and ${cssNames.length} CSS ${cssNames.length === 1 ? 'file' : 'files'} with non-strict shares, the shared container name, and normalized CSS endings.`
);
