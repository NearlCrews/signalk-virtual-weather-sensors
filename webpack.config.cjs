/**
 * Webpack build for the React config panel.
 *
 * The Signal K Admin UI v2.13+ loads `./PluginConfigurationPanel` from any
 * plugin whose `package.json` keywords include `signalk-plugin-configurator`.
 * Module Federation lets us ship the panel as a federated remote so React 19
 * is shared with (not duplicated by) the host admin UI.
 *
 * `library.type` choice is load-bearing: this package's `package.json` has
 * `"type": "module"`, which makes the SK server inject the remoteEntry as
 * `<script type="module" src="..."></script>` (see
 * signalk-server/src/serverroutes.ts ~line 265). The admin UI's
 * `toLazyDynamicComponent` then does `await import(remoteEntryUrl)` and
 * looks for `.get` / `.init` exports on the resolved module. A
 * `library: { type: 'var' }` bundle would assign to `window.<name>` via a
 * classic script and export nothing via ESM, so the import returns an
 * empty module and the admin UI logs "Could not load module ...". The fix
 * is to emit a real ESM module here via `experiments.outputModule`,
 * `output.module`, and `library: { type: 'module' }`. Sibling plugins with
 * the same `"type": "module"` constraint (`signalk-openrouter-companion`)
 * use this exact configuration.
 *
 * This config sits alongside `esbuild.config.js`. esbuild builds the plugin
 * runtime; webpack builds only the panel into `public/`. Both run from the
 * top-level `npm run build`.
 */

const path = require('node:path');
const { ModuleFederationPlugin } = require('webpack').container;
const packageJson = require('./package.json');

const containerName = packageJson.name.replace(/[-@/]/g, '_');

module.exports = {
  entry: './src/configpanel/index.tsx',
  mode: 'production',
  experiments: { outputModule: true },
  output: {
    path: path.resolve(__dirname, 'public'),
    clean: true,
    module: true,
    chunkFormat: 'module',
  },
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        loader: 'babel-loader',
        exclude: /node_modules/,
        options: {
          presets: [
            ['@babel/preset-typescript', { isTSX: true, allExtensions: true }],
            ['@babel/preset-react', { runtime: 'automatic' }],
          ],
        },
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
    // Map ESM-style ".js" specifiers onto sibling ".ts" sources so
    // panel-reachable modules can use the same import paths the Node plugin
    // build (esbuild) accepts.
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
    },
  },
  plugins: [
    new ModuleFederationPlugin({
      name: containerName,
      library: { type: 'module' },
      filename: 'remoteEntry.js',
      exposes: {
        './PluginConfigurationPanel': './src/configpanel/PluginConfigurationPanel',
      },
      // `singleton` ensures React state hooks work across the host UI / panel
      // boundary. `requiredVersion` comes from devDependencies so the
      // federation share-scope check matches what we built against; a future
      // host React bump only needs the devDep version raised.
      shared: {
        react: {
          singleton: true,
          requiredVersion: packageJson.devDependencies.react,
        },
      },
    }),
  ],
};
