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
const webpack = require('webpack');
const { ModuleFederationPlugin } = webpack.container;
const packageJson = require('./package.json');

const containerName = packageJson.name.replace(/[-@/]/g, '_');

class NormalizeCssModuleWhitespacePlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap('NormalizeCssModuleWhitespacePlugin', (compilation) => {
      const hooks = webpack.css.CssModulesPlugin.getCompilationHooks(compilation);
      hooks.renderModulePackage.tap('NormalizeCssModuleWhitespacePlugin', (source) => {
        const content = source.source().toString();
        const normalized = `${content.trimEnd()}\n`;
        return normalized === content ? source : new webpack.sources.RawSource(normalized);
      });
    });
  }
}

module.exports = {
  entry: {},
  mode: 'production',
  devtool: false,
  experiments: { css: true, outputModule: true },
  output: {
    path: path.resolve(__dirname, 'public'),
    clean: true,
    filename: '[name].js',
    chunkFilename: '[name].[contenthash].mjs',
    cssChunkFilename: '[name].[contenthash].css',
    module: true,
    chunkFormat: 'module',
    uniqueName: containerName,
  },
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        loader: 'esbuild-loader',
        exclude: /node_modules/,
        options: {
          loader: 'tsx',
          target: 'es2023',
          jsx: 'automatic',
        },
      },
      {
        test: /\.module\.css$/,
        type: 'css/module',
        parser: {
          container: false,
          dashedIdents: false,
          namedExports: false,
        },
        generator: {
          localIdentName: 'svws_[name]__[local]--[hash:base64:5]',
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
    new NormalizeCssModuleWhitespacePlugin(),
    new ModuleFederationPlugin({
      name: containerName,
      library: { type: 'module' },
      filename: 'remoteEntry.js',
      exposes: {
        './PluginConfigurationPanel': './src/configpanel/PluginConfigurationPanel',
      },
      // `singleton` ensures React state hooks work across the host UI and panel
      // boundary. The host must supply React 19. The shared UI package stays
      // inside this remote and is intentionally absent from this share map.
      shared: {
        react: {
          singleton: true,
          requiredVersion: '>=19.2.0 <20.0.0',
          import: false,
        },
      },
    }),
  ],
};
