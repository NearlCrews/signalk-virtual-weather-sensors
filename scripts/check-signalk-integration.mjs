import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const pluginId = 'signalk-virtual-weather-sensors';
if (packageJson.name !== pluginId) {
  throw new Error(`Expected package.json name ${pluginId}.`);
}
const baseUrl = new URL(process.env.SIGNALK_URL ?? 'http://127.0.0.1:3000');
const authorization = process.env.SIGNALK_AUTHORIZATION?.trim();
const remotePath = `/${pluginId}/remoteEntry.js`;
const requestOptions = () => ({
  ...(authorization ? { headers: { Authorization: authorization } } : {}),
  signal: AbortSignal.timeout(10_000),
});

const serverResponse = await fetch(new URL('/signalk', baseUrl), requestOptions());
if (!serverResponse.ok) {
  throw new Error(`Signal K discovery failed with HTTP ${serverResponse.status}.`);
}

const pluginsResponse = await fetch(new URL('/skServer/plugins', baseUrl), requestOptions());
if (!pluginsResponse.ok) {
  if (pluginsResponse.status === 401 && !authorization) {
    throw new Error(
      'Signal K plugin discovery requires authentication. Set SIGNALK_AUTHORIZATION to the complete Authorization header value.'
    );
  }
  throw new Error(`Signal K plugin discovery failed with HTTP ${pluginsResponse.status}.`);
}
const plugins = await pluginsResponse.json();
const installedPlugin = Array.isArray(plugins)
  ? plugins.find((plugin) => plugin.packageName === pluginId)
  : undefined;
if (!installedPlugin) throw new Error(`Signal K did not load ${pluginId}.`);
if (installedPlugin.data?.enabled !== true) {
  throw new Error(`Signal K did not enable ${pluginId}.`);
}
for (const keyword of ['signalk-node-server-plugin', 'signalk-plugin-configurator']) {
  if (!installedPlugin.keywords?.includes(keyword)) {
    throw new Error(`Signal K did not recognize the ${keyword} keyword.`);
  }
}

const statusResponse = await fetch(
  new URL(`/plugins/${pluginId}/api/status`, baseUrl),
  requestOptions()
);
if (!statusResponse.ok) {
  throw new Error(`The status API failed with HTTP ${statusResponse.status}.`);
}
const status = await statusResponse.json();
if (typeof status !== 'object' || status === null || typeof status.running !== 'boolean') {
  throw new Error('The status API did not return a running flag.');
}

const remoteResponse = await fetch(new URL(remotePath, baseUrl), requestOptions());
if (!remoteResponse.ok) {
  throw new Error(`The installed configuration remote failed with HTTP ${remoteResponse.status}.`);
}
const remoteSource = await remoteResponse.text();
if (!remoteSource.includes('export')) {
  throw new Error('The installed configuration remote is not an ESM container.');
}

console.log(`Signal K registered the plugin, status API, and ${remotePath} at ${baseUrl.origin}.`);
