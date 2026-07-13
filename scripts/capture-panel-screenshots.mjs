import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const repoRoot = resolve(import.meta.dirname, '..');
const outputDir = join(repoRoot, 'assets', 'screenshots');
const workDir = await mkdtemp(join(tmpdir(), 'svws-panel-'));
const bundlePath = join(workDir, 'panel-preview.js');
const htmlPath = join(workDir, 'index.html');
const panelPath = resolve(repoRoot, 'src/configpanel/PluginConfigurationPanel.tsx');

const previewSource = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import PluginConfigurationPanel from ${JSON.stringify(panelPath)};

const status = {
  running: true,
  banner: 'Running, last update 1m ago (3 updates, 8 API requests)',
  updates: 3,
  quotaUsedLast24h: 8,
  lastUpdateMinutesAgo: 1,
  activeNotifications: 0,
  weatherProviderRegistered: true,
};

globalThis.fetch = async () => new Response(JSON.stringify(status), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

const configuration = {
  weatherProvider: 'accuweather',
  weatherMode: 'single',
  accuWeatherApiKey: 'configured-placeholder-key',
  updateFrequency: 30,
  emissionInterval: 5,
  dailyApiQuota: 50,
  marineData: false,
  notifications: {
    enabled: true,
    wind: true,
    visibility: true,
    heat: true,
    cold: true,
    weather: true,
  },
};

createRoot(document.getElementById('root')).render(
  <PluginConfigurationPanel configuration={configuration} save={async () => {}} />
);
`;

await build({
  stdin: {
    contents: previewSource,
    loader: 'tsx',
    resolveDir: repoRoot,
    sourcefile: 'panel-preview.tsx',
  },
  bundle: true,
  outfile: bundlePath,
  platform: 'browser',
  format: 'esm',
  target: 'es2023',
  jsx: 'automatic',
});

await writeFile(
  htmlPath,
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Virtual Weather Sensors panel preview</title>
    <style>
      html, body { margin: 0; min-height: 100%; background: #ffffff; }
      body { width: 800px; font-family: sans-serif; }
      #root { width: 800px; }
      .svws-panel { box-sizing: border-box; min-height: 100vh; }
    </style>
  </head>
  <body>
    <main id="root"></main>
    <script type="module" src="/panel-preview.js"></script>
  </body>
</html>`,
  'utf8'
);

const server = createServer(async (request, response) => {
  try {
    const requestedPath = request.url === '/panel-preview.js' ? bundlePath : htmlPath;
    const body = await readFile(requestedPath);
    response.writeHead(200, {
      'content-type': requestedPath.endsWith('.js')
        ? 'text/javascript; charset=utf-8'
        : 'text/html; charset=utf-8',
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500);
    response.end(error instanceof Error ? error.message : String(error));
  }
});

await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(0, '127.0.0.1', resolveListen);
});

const address = server.address();
if (!address || typeof address === 'string') {
  throw new Error('Screenshot preview server did not return a TCP address');
}

const configuredChromium = process.env.CHROMIUM_PATH;
const systemChromium = existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined;
const executablePath = configuredChromium ?? systemChromium;

try {
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
    await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'networkidle' });
    await page.getByText('Running', { exact: true }).waitFor();

    await page.screenshot({
      path: join(outputDir, 'config-panel-status.png'),
      fullPage: true,
    });

    await page.getByRole('button', { name: /Severe-weather notifications/ }).click();
    await page.screenshot({
      path: join(outputDir, 'config-panel-notifications.png'),
      fullPage: true,
    });

    await page.getByRole('button', { name: /Severe-weather notifications/ }).click();
    await page.getByRole('button', { name: 'Night', exact: true }).click();
    await page.locator('.svws-panel[data-svws-theme="night"]').waitFor();
    await page.waitForTimeout(200);
    const nightHeaderColor = await page
      .locator('.svws-section-header')
      .first()
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    if (nightHeaderColor !== 'rgb(17, 8, 8)') {
      throw new Error(`Night theme did not settle before capture: ${nightHeaderColor}`);
    }
    await page.screenshot({
      path: join(outputDir, 'config-panel-night.png'),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
} finally {
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  await rm(workDir, { recursive: true, force: true });
}

console.log('Updated configuration-panel screenshots in assets/screenshots.');
