import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const configuredChromium = process.env.CHROMIUM_PATH;
const systemChromium = existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined;
const executablePath = configuredChromium ?? systemChromium;

export default defineConfig({
  test: {
    include: ['src/__tests__/configpanel/**/*.browser.test.tsx'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(executablePath ? { launchOptions: { executablePath } } : undefined),
      instances: [{ browser: 'chromium' }],
    },
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
});
