import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import webpack from 'webpack';

const require = createRequire(import.meta.url);
const config = require('../webpack.config.cjs');

const stats = await new Promise((resolve, reject) => {
  webpack(config, (error, result) => {
    if (error) {
      reject(error);
      return;
    }
    if (!result) {
      reject(new Error('Webpack completed without build statistics.'));
      return;
    }
    resolve(result);
  });
});

const output = stats.toString({
  all: false,
  assets: true,
  colors: process.stdout.isTTY,
  errors: true,
  warnings: true,
});
if (output) console.log(output);

const statsJson = stats.toJson({
  all: false,
  assets: true,
  chunkModules: true,
  chunks: true,
  errors: true,
  modules: true,
  nestedModules: true,
  warnings: true,
});
await mkdir('.tmp', { recursive: true });
await writeFile(
  '.tmp/panel-stats.json',
  `${JSON.stringify(
    {
      ...statsJson,
      errorsCount: statsJson.errors?.length ?? 0,
      warningsCount: statsJson.warnings?.length ?? 0,
    },
    null,
    2
  )}\n`
);

if (stats.hasErrors() || stats.hasWarnings()) {
  process.exitCode = 1;
}
