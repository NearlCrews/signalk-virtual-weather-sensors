/**
 * Webpack build for the React config panel.
 *
 * The Signal K Admin UI v2.13+ loads `./PluginConfigurationPanel` from any
 * plugin whose `package.json` keywords include `signalk-plugin-configurator`.
 * Module Federation lets us ship the panel as a federated remote so React 19
 * is shared with (not duplicated by) the host admin UI.
 *
 * This config sits alongside `esbuild.config.js`. esbuild builds the plugin
 * runtime; webpack builds only the panel into `public/`. Both run from the
 * top-level `npm run build`.
 */

const path = require('node:path');
const { ModuleFederationPlugin } = require('webpack').container;
const packageJson = require('./package.json');

module.exports = {
  entry: './src/configpanel/index.js',
  mode: 'production',
  output: {
    path: path.resolve(__dirname, 'public'),
    clean: false,
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        loader: 'babel-loader',
        exclude: /node_modules/,
        options: { presets: ['@babel/preset-react'] },
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx'],
  },
  plugins: [
    new ModuleFederationPlugin({
      // Module-Federation `name` must be a valid JS identifier; dashes / @ /
      // slashes are stripped per the SK admin-UI convention. The host loads
      // `<plugin-name>__PluginConfigurationPanel` from this remote.
      name: packageJson.name.replace(/[-@/]/g, '_'),
      library: {
        type: 'var',
        name: packageJson.name.replace(/[-@/]/g, '_'),
      },
      filename: 'remoteEntry.js',
      exposes: {
        './PluginConfigurationPanel': './src/configpanel/PluginConfigurationPanel',
      },
      // `singleton` ensures React state hooks work across the host UI / panel
      // boundary. `requiredVersion: '^19'` matches what the SK admin UI ships;
      // a future host bump to React 20 will require us to publish a matching
      // bump or the panel will fall back to its bundled React copy.
      shared: {
        react: { singleton: true, requiredVersion: '^19' },
        'react-dom': { singleton: true, requiredVersion: '^19' },
      },
    }),
  ],
};
