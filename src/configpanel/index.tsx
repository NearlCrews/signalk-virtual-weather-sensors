// Module Federation entry point. The exposes map in webpack.config.cjs loads
// PluginConfigurationPanel directly; webpack still requires an `entry` that
// resolves, and re-exporting the panel keeps this file meaningful.
export { default } from './PluginConfigurationPanel.js';
