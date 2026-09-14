/**
 * Smoke-loads the built plugin and checks the surface the Signal K server
 * calls into. It needs no Vitest, so the runtime-floor CI lane can run it on
 * the Node 20.18 that `engines.node` advertises. That lane exists to prove the
 * plugin's own runtime code works on the floor it promises, and importing the
 * bundle is what turns "it compiled" into "it loads and constructs".
 *
 * This is a smoke check, not a substitute for the unit suite: it asserts the
 * module shape the server contract needs and nothing about weather behavior.
 */

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

/** What `signalk-server` reads off a plugin object before it starts one. */
const REQUIRED_FUNCTIONS = ['start', 'stop', 'schema'];
const REQUIRED_STRINGS = ['id', 'name'];

/** Enough of the server API for construction; the plugin must not call these yet. */
function stubServerApi() {
  const unexpected = (method) => () => {
    throw new Error(`The plugin called app.${method}() during construction.`);
  };
  return {
    debug: () => {},
    error: () => {},
    setPluginStatus: unexpected('setPluginStatus'),
    setPluginError: unexpected('setPluginError'),
    handleMessage: unexpected('handleMessage'),
    getSelfPath: unexpected('getSelfPath'),
    registerPutHandler: unexpected('registerPutHandler'),
  };
}

const entry = pathToFileURL(new URL('../dist/index.js', import.meta.url).pathname).href;
const module = await import(entry);
const createPlugin = module.default;
assert.equal(
  typeof createPlugin,
  'function',
  'dist/index.js must default-export a plugin factory.'
);

const plugin = createPlugin(stubServerApi());
assert.equal(typeof plugin, 'object', 'The factory must return a plugin object.');
assert.notEqual(plugin, null, 'The factory must return a plugin object.');

for (const key of REQUIRED_STRINGS) {
  assert.equal(typeof plugin[key], 'string', `plugin.${key} must be a string.`);
  assert.notEqual(plugin[key].trim(), '', `plugin.${key} must not be empty.`);
}
for (const key of REQUIRED_FUNCTIONS) {
  assert.equal(typeof plugin[key], 'function', `plugin.${key} must be a function.`);
}

// `schema()` is the App Store fallback for admin UIs without the React panel,
// so a broken one degrades every such install to an unconfigurable plugin.
const schema = plugin.schema();
assert.equal(typeof schema, 'object', 'plugin.schema() must return an object.');
assert.notEqual(schema, null, 'plugin.schema() must return an object.');
assert.equal(schema.type, 'object', 'plugin.schema() must describe an object.');
assert.equal(typeof schema.properties, 'object', 'plugin.schema() must declare properties.');

process.stdout.write(
  `Plugin runtime check passed on Node ${process.versions.node}: ${plugin.id} loads, constructs, ` +
    `and returns a schema with ${String(Object.keys(schema.properties).length)} properties.\n`
);
