import assert from 'node:assert/strict';
import { existsSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

// signalk-server serves the Admin from its own dependency-local path, but npm
// may hoist @signalk/server-admin-ui to the host's top-level node_modules.
// Link the installed copy back to where the server looks for it.
assert.ok(process.argv[2], 'the Signal K test-host directory is required');
const hostDirectory = resolve(process.argv[2]);
const require = createRequire(import.meta.url);
const serverDirectory = dirname(
  require.resolve('signalk-server/package.json', { paths: [hostDirectory] })
);
const expectedAdminDirectory = join(serverDirectory, 'node_modules', '@signalk', 'server-admin-ui');
let adminDirectory;

if (existsSync(expectedAdminDirectory)) {
  adminDirectory = realpathSync(expectedAdminDirectory);
} else {
  adminDirectory = dirname(
    require.resolve('@signalk/server-admin-ui/package.json', {
      paths: [serverDirectory, hostDirectory],
    })
  );
  mkdirSync(dirname(expectedAdminDirectory), { recursive: true });
  symlinkSync(adminDirectory, expectedAdminDirectory, 'dir');
}

process.stdout.write(`Signal K Admin test assets linked from ${adminDirectory}.\n`);
