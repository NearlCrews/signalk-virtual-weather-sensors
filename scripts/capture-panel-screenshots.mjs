import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const repositoryRoot = resolve(import.meta.dirname, '..');
const outputDirectory = resolve(repositoryRoot, 'assets/screenshots');
const baseUrl = 'http://127.0.0.1:4176';
const vite = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--config', 'fixtures/browser/vite.config.ts'],
  { cwd: repositoryRoot, stdio: 'ignore' }
);

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`Screenshot fixture exited with ${vite.exitCode}.`);
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The fixture is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error('Screenshot fixture did not start within 30 seconds.');
}

try {
  await waitForServer();
  const configuredChromium = process.env.CHROMIUM_PATH;
  const systemChromium = existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined;
  const executablePath = configuredChromium ?? systemChromium;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
    await page.goto(`${baseUrl}/?screenshot`, { waitUntil: 'networkidle' });
    await page.locator('[data-snui-root]').waitFor();
    await page.getByText('Running', { exact: true }).waitFor();

    await page.screenshot({
      path: resolve(outputDirectory, 'config-panel-status.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 800, height: 1200 });
    await page.getByRole('button', { name: /Severe-weather notifications/ }).click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    await page.screenshot({
      path: resolve(outputDirectory, 'config-panel-notifications.png'),
      fullPage: true,
    });

    await page.getByRole('button', { name: /Severe-weather notifications/ }).click();
    await page.setViewportSize({ width: 800, height: 900 });
    await page.getByRole('radio', { name: 'Night' }).click();
    await page.mouse.move(0, 0);
    await page.locator('[data-snui-root][data-snui-theme="night"]').waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({
      path: resolve(outputDirectory, 'config-panel-night.png'),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
} finally {
  vite.kill('SIGTERM');
}

console.log('Updated configuration-panel screenshots in assets/screenshots.');
