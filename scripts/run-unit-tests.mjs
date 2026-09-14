/**
 * Runs the Vitest unit suite, or skips it with a notice on a Node too old for
 * Vitest 5. See `unit-test-toolchain.mjs` for why the two floors differ.
 *
 * Every argument is forwarded to `vitest run`, so `--coverage` and a path
 * filter behave exactly as they did when the scripts called Vitest directly.
 */

import { spawnSync } from 'node:child_process';
import {
  supportsUnitTestToolchain,
  UNIT_TEST_TOOLCHAIN_FLOOR_TEXT,
} from './unit-test-toolchain.mjs';

const nodeVersion = process.versions.node;
if (!supportsUnitTestToolchain(nodeVersion)) {
  process.stdout.write(
    `Skipping the unit suite on Node ${nodeVersion}: Vitest 5 requires ` +
      `${UNIT_TEST_TOOLCHAIN_FLOOR_TEXT}.\n` +
      'This lane proves the plugin runtime, not the test toolchain. It installs, type-checks, ' +
      'compiles, checks module boundaries, and smoke-loads the built plugin on the Node 20.18 ' +
      'floor that `engines.node` advertises. The unit suite runs on the supported development ' +
      'runtimes instead.\n' +
      'Signal K server declares `node: >=22` and a plugin runs inside the server process, so no ' +
      'supported installation executes this plugin on Node 20.\n'
  );
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)],
  { stdio: 'inherit' }
);
if (result.error !== undefined) throw result.error;
process.exit(result.status ?? 1);
