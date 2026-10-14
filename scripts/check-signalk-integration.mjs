import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Proves an installed copy of this plugin works inside a running Signal K
// server: the server loads and enables it, its status API and panel remote are
// served, and the Signal K Admin mounts the production configuration panel in
// a real browser. CI runs it against a throwaway server with the packed
// tarball installed; see the signalk-admin job in .github/workflows/ci.yml.

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const pluginId = 'signalk-virtual-weather-sensors';
if (packageJson.name !== pluginId) {
  throw new Error(`Expected package.json name ${pluginId}.`);
}
// No default: the only server listening on a developer machine may be a live
// boat server, so the target must always be named.
if (!process.env.SIGNALK_URL) {
  throw new Error(
    'Set SIGNALK_URL to the Signal K server under test, for example a throwaway one.'
  );
}
const baseUrl = new URL(process.env.SIGNALK_URL);
const authorization = process.env.SIGNALK_AUTHORIZATION?.trim();
const headers = authorization ? { Authorization: authorization } : {};
const remotePath = `/${pluginId}/remoteEntry.js`;

async function request(path) {
  const response = await fetch(new URL(path, baseUrl), {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 && !authorization) {
    throw new Error(
      `${path} requires authentication. Set SIGNALK_AUTHORIZATION to the complete Authorization header value.`
    );
  }
  if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}.`);
  return response;
}

await request('/signalk');

const plugins = await (await request('/skServer/plugins')).json();
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

const status = await (await request(`/plugins/${pluginId}/api/status`)).json();
if (typeof status !== 'object' || status === null || typeof status.running !== 'boolean') {
  throw new Error('The status API did not return a running flag.');
}

const remoteSource = await (await request(remotePath)).text();
if (!remoteSource.includes('export')) {
  throw new Error('The installed configuration remote is not an ESM container.');
}
const adminHtml = await (await request('/admin/')).text();
if (!adminHtml.includes(`src="${remotePath}"`)) {
  throw new Error('The Signal K Admin did not inject the configuration remote.');
}

const browser = await chromium.launch({
  ...(process.env.SIGNALK_BROWSER_CHANNEL ? { channel: process.env.SIGNALK_BROWSER_CHANNEL } : {}),
  headless: true,
});
try {
  const context = await browser.newContext({ extraHTTPHeaders: headers });
  const page = await context.newPage();
  await page.goto(new URL(`/admin/#/serverConfiguration/plugins/${pluginId}`, baseUrl).href, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  const panelRoot = page.locator('[data-snui-root]');
  const hostFailure = page.getByText(/Plugin Configuration Unavailable|Error loading component/);
  await panelRoot.or(hostFailure).first().waitFor({ state: 'visible', timeout: 30_000 });
  if ((await hostFailure.count()) > 0) {
    const detail = await hostFailure.first().locator('xpath=..').innerText();
    throw new Error(`The Signal K Admin could not mount the panel: ${detail.replace(/\s+/g, ' ')}`);
  }

  const expectedUiVersion = packageJson.devDependencies['signalk-nearlcrews-ui'];
  const mountedUiVersion = await panelRoot.first().getAttribute('data-snui-version');
  if (mountedUiVersion !== expectedUiVersion) {
    throw new Error(
      `The mounted panel reports shared UI ${String(mountedUiVersion)}, not the pinned ${expectedUiVersion}.`
    );
  }
  await page
    .getByRole('button', { name: /Fetch and emission cadence/ })
    .waitFor({ state: 'visible', timeout: 10_000 });
} finally {
  await browser.close();
}

console.log(
  `Signal K at ${baseUrl.origin} loaded the plugin, served its status API and ${remotePath}, and mounted the production panel in the Admin.`
);
