import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const EXPECTED_UI_VERSION = process.env.SNUI_EXPECT_VERSION ?? '0.7.1';

async function expectSaveBlockedAt(page: Page, fieldName: string): Promise<void> {
  await page.getByRole('button', { name: 'Save configuration' }).click();
  const field = page.getByRole('textbox', { name: fieldName, exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('body')).not.toHaveAttribute('data-save-count', /\d/);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.getByRole('heading', { name: 'Virtual Weather Sensors' })).toBeVisible();
});

test('loads the production remote and never saves a stale number', async ({ page }) => {
  await expect(page.locator('[data-snui-root]')).toHaveAttribute(
    'data-snui-version',
    EXPECTED_UI_VERSION
  );
  await page.getByRole('button', { name: /Fetch and emission cadence/ }).click();

  const updateFrequency = page.getByRole('spinbutton', {
    name: 'Weather update frequency (minutes)',
  });
  await updateFrequency.fill('999');
  await expect(updateFrequency).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter a value from 1 to 60.')).toBeVisible();

  const saveButton = page.getByRole('button', { name: 'Save configuration' });
  await saveButton.click();
  await expect(updateFrequency).toBeFocused();
  await expect(page.locator('body')).not.toHaveAttribute('data-save-count', /\d/);

  await updateFrequency.fill('45');
  await expect(updateFrequency).not.toHaveAttribute('aria-invalid');
  await saveButton.click();
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '1');
  await expect(page.locator('body')).toHaveAttribute(
    'data-saved-configuration',
    /"updateFrequency":45/
  );
  await expect(page.locator('body')).toHaveAttribute(
    'data-saved-configuration',
    /"futureFixtureSetting":\{"enabled":true\}/
  );
  await expect(page.locator('body')).toHaveAttribute(
    'data-saved-configuration',
    /"futureBand":true/
  );
  const actionStatus = page.locator('[data-panel-action-bar] [tabindex="-1"]');
  await expect(actionStatus).toBeFocused();
  await expect(saveButton).toHaveAttribute('aria-busy', 'true');
  await expect(actionStatus).toContainText(/save requested/i);
  await expect(actionStatus).toContainText('Current plugin status is running', { timeout: 5_000 });
});

test('reports a synchronous host request failure without claiming persistence', async ({
  page,
}) => {
  await page.goto('/?save-failure');
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  await page.getByRole('button', { name: /Fetch and emission cadence/ }).click();
  await page.getByRole('spinbutton', { name: 'Weather update frequency (minutes)' }).fill('45');
  const saveButton = page.getByRole('button', { name: 'Save configuration' });

  await saveButton.click();
  await expect(page.locator('body')).toHaveAttribute('data-save-attempt-count', '1');
  await expect(page.locator('body')).not.toHaveAttribute('data-save-count', /\d/);
  await expect(page.locator('[data-panel-action-bar]')).toContainText(
    'Could not request the configuration save'
  );
  await expect(saveButton).not.toHaveAttribute('aria-busy');

  await saveButton.click();
  await expect(page.locator('body')).toHaveAttribute('data-save-attempt-count', '2');
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '1');
  await expect(page.locator('[data-panel-action-bar]')).toContainText(
    'Current plugin status is running',
    { timeout: 5_000 }
  );
});

test('keeps an edit made during the status check dirty and visible', async ({ page }) => {
  await page.getByRole('button', { name: /Fetch and emission cadence/ }).click();
  const updateFrequency = page.getByRole('spinbutton', {
    name: 'Weather update frequency (minutes)',
  });
  const saveButton = page.getByRole('button', { name: 'Save configuration' });

  await updateFrequency.fill('45');
  await saveButton.click();
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '1');
  await updateFrequency.fill('46');

  const actionBar = page.locator('[data-panel-action-bar]');
  await expect(actionBar).toContainText('Unsaved changes.');
  await expect(saveButton).not.toHaveAttribute('aria-busy', 'true', { timeout: 5_000 });
  await expect(actionBar).toContainText('Unsaved changes.');
  await expect(saveButton).toBeEnabled();
});

test('uses Auto for a fresh profile without persisting an implicit choice', async ({ page }) => {
  const root = page.locator('[data-snui-root]');
  const themeGroup = page.getByRole('radiogroup', { name: 'Panel theme' });
  const light = themeGroup.getByRole('radio', { name: 'Light' });
  const auto = themeGroup.getByRole('radio', { name: 'Auto' });

  await expect(root).not.toHaveAttribute('data-snui-theme');
  await expect(root).toHaveCSS('background-color', 'rgb(244, 246, 248)');
  await expect(auto).toBeChecked();
  await expect(auto).toHaveAttribute('tabindex', '0');
  await expect(light).not.toBeChecked();
  await expect(light).toHaveAttribute('tabindex', '-1');
  expect(
    await page.evaluate(() => ({
      legacy: localStorage.getItem('svws-theme'),
      shared: localStorage.getItem('signalk-nearlcrews-ui.theme.v1'),
    }))
  ).toEqual({ legacy: null, shared: null });
});

test('keeps Auto light without a host marker and lets System follow the OS', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const root = page.locator('[data-snui-root]');
  const themeGroup = page.getByRole('radiogroup', { name: 'Panel theme' });

  await themeGroup.getByRole('radio', { name: 'Auto' }).click();
  await expect(root).not.toHaveAttribute('data-snui-theme');
  await expect(root).toHaveCSS('background-color', 'rgb(244, 246, 248)');
  await expect(root).toHaveCSS('color', 'rgb(24, 32, 44)');

  await themeGroup.getByRole('radio', { name: 'System' }).click();
  await expect(root).toHaveAttribute('data-snui-theme', 'system');
  await expect(root).toHaveCSS('background-color', 'rgb(16, 19, 28)');
  await expect(root).toHaveCSS('color', 'rgb(245, 247, 250)');

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveCSS('background-color', 'rgb(244, 246, 248)');
  await expect(root).toHaveCSS('color', 'rgb(24, 32, 44)');
});

test('blocks a missing AccuWeather key and focuses its field', async ({ page }) => {
  await page.getByRole('button', { name: /Weather source/ }).click();
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('accuweather');
  await expectSaveBlockedAt(page, 'API key');
});

test('reveals an API key without losing its value, focus, or selection', async ({ page }) => {
  await page.getByRole('button', { name: /Weather source/ }).click();
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('accuweather');
  const apiKey = page.locator('#svws-apikey');
  await expect(apiKey).toHaveAttribute('autocapitalize', 'none');
  await expect(apiKey).toHaveAttribute('autocomplete', 'off');
  await expect(apiKey).toHaveAttribute('autocorrect', 'off');
  await expect(apiKey).toHaveAttribute('spellcheck', 'false');
  await apiKey.fill('test-api-key-1234567890');
  await apiKey.focus();
  await apiKey.evaluate((element) => {
    (element as HTMLInputElement).setSelectionRange(5, 12);
  });

  await page.getByRole('button', { name: 'Show' }).click();
  await expect(apiKey).toHaveAttribute('type', 'text');
  await expect(apiKey).toHaveValue('test-api-key-1234567890');
  await expect(apiKey).toBeFocused();
  expect(
    await apiKey.evaluate((element) => {
      const input = element as HTMLInputElement;
      return [input.selectionStart, input.selectionEnd];
    })
  ).toEqual([5, 12]);

  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(apiKey).toHaveAttribute('type', 'password');
  await expect(apiKey).toBeFocused();
});

test('uses a shared relative age when status polling becomes stale', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'The Playwright clock contract is covered in Chromium.');
  await page.clock.install({ time: new Date('2026-08-12T12:00:00Z') });
  await page.goto('/?status-fails-after-first');
  await expect(page.locator('body')).toHaveAttribute('data-status-request-count', /[1-9]\d*/);

  await page.clock.fastForward(30_000);
  await expect(page.getByText(/^Updated \d+ seconds ago$/)).toBeVisible();
});

test('blocks an invalid Open-Meteo base URL and focuses its field', async ({ page }) => {
  await page.getByRole('button', { name: /Weather source/ }).click();
  await page.getByRole('textbox', { name: 'Open-Meteo base URL' }).fill('not a URL');
  await expectSaveBlockedAt(page, 'Open-Meteo base URL');
});

test('keeps reorder controls focusable and announces the new merge order', async ({ page }) => {
  await page.getByRole('button', { name: /Weather source/ }).click();
  await page.getByRole('combobox', { name: 'Provider mode' }).selectOption('merged');

  await expect(page.getByRole('checkbox', { name: /Open-Meteo.*primary/ })).toBeChecked();
  await expect(
    page.getByText('Excluded from fetching until an AccuWeather key is set.')
  ).toBeVisible();
  const moveDown = page.getByRole('button', { name: /Move Open-Meteo.* down/ });
  await moveDown.focus();
  await moveDown.click();
  await expect(moveDown).toBeFocused();
  await expect(page.getByRole('checkbox', { name: /Met\.no.*primary/ })).toBeChecked();
  await expect(page.getByRole('status').filter({ hasText: 'Merge order:' })).toContainText(
    /Merge order: 1 Met.no.*2 Open-Meteo/
  );
});

test('blocks a keyless merge when every selected provider needs a key', async ({ page }) => {
  await page.getByRole('button', { name: /Weather source/ }).click();
  await page.getByRole('combobox', { name: 'Provider mode' }).selectOption('merged');
  await page.getByRole('checkbox', { name: /Open-Meteo/ }).uncheck();
  await page.getByRole('checkbox', { name: /Met\.no/ }).uncheck();
  await expectSaveBlockedAt(page, 'API key');
});

test('ignores the retired legacy preference and supports every theme', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.removeItem('signalk-nearlcrews-ui.theme.v1');
    localStorage.setItem('svws-theme', 'night');
  });
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.locator('[data-snui-root]')).not.toHaveAttribute('data-snui-theme');
  await expect(page.getByRole('radio', { name: 'Auto' })).toBeChecked();
  expect(
    await page.evaluate(() => ({
      legacy: localStorage.getItem('svws-theme'),
      shared: localStorage.getItem('signalk-nearlcrews-ui.theme.v1'),
    }))
  ).toEqual({ legacy: 'night', shared: null });

  const themeGroup = page.getByRole('radiogroup', { name: 'Panel theme' });
  for (const [label, value] of [
    ['System', 'system'],
    ['Light', 'light'],
    ['Dark', 'dark'],
    ['Night', 'night'],
  ] as const) {
    await themeGroup.getByRole('radio', { name: label }).click();
    await expect(page.locator('[data-snui-root]')).toHaveAttribute('data-snui-theme', value);
  }
  await themeGroup.getByRole('radio', { name: 'Auto' }).click();
  await expect(page.locator('[data-snui-root]')).not.toHaveAttribute('data-snui-theme');
});

test('has no Axe findings in every theme', async ({ page, browserName, isMobile }) => {
  test.setTimeout(180_000);
  test.skip(browserName !== 'chromium' || isMobile, 'One Chromium pass covers computed colors.');
  const root = page.locator('[data-snui-root]');
  const themeGroup = page.getByRole('radiogroup', { name: 'Panel theme' });
  await page.addStyleTag({ content: '* { transition: none !important; }' });

  for (const [label, value] of [
    ['Auto', null],
    ['System', 'system'],
    ['Light', 'light'],
    ['Dark', 'dark'],
    ['Night', 'night'],
  ] as const) {
    await themeGroup.getByRole('radio', { name: label }).click();
    if (value === null) {
      await expect(root).not.toHaveAttribute('data-snui-theme');
    } else {
      await expect(root).toHaveAttribute('data-snui-theme', value);
    }
    expect(
      (await new AxeBuilder({ page }).include('[data-snui-root]').analyze()).violations,
      `${label} theme`
    ).toEqual([]);
  }
});

test('has no Axe findings or horizontal overflow at 320 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByRole('button', { name: /Weather source/ }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('responds to a narrow embedded panel inside a wide host', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('.plugin-list').evaluate((element) => {
    element.style.display = 'none';
  });
  await page.locator('.config-column').evaluate((element) => {
    element.style.flex = '0 0 320px';
  });
  await page.getByRole('button', { name: /Weather source/ }).click();
  const root = page.locator('[data-snui-root]');
  const width = await root.evaluate((element) => element.clientWidth);
  expect(width).toBeGreaterThan(250);
  expect(width).toBeLessThanOrEqual(320);
  expect(
    await root.evaluate((element) => element.scrollWidth - element.clientWidth)
  ).toBeLessThanOrEqual(0);
});

test('runs inside the current Admin scroll and card contract', async ({ page }) => {
  const overflow = await page.locator('.app-body').evaluate((element) => {
    const style = getComputedStyle(element);
    return { x: style.overflowX, y: style.overflowY };
  });
  expect(overflow).toEqual({ x: 'hidden', y: 'auto' });
  await expect(page.locator('.config-column.card [data-snui-root]')).toBeVisible();
});

test('keeps the viewport action bar reachable inside the Admin overflow contract', async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 800, height: 568 });
  for (const heading of [
    /Weather source/,
    /Fetch and emission cadence/,
    /Severe-weather notifications/,
  ]) {
    await page.getByRole('button', { name: heading }).click();
  }

  const actionBar = page.locator('[data-panel-action-bar]');
  await expect(actionBar).toHaveClass(/snui-action-bar--sticky-viewport-bottom/);
  await actionBar.evaluate((element) => element.scrollIntoView({ block: 'end' }));
  await page.evaluate(() => window.scrollBy(0, -160));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(actionBar.locator('..')).toHaveAttribute('data-snui-docked', '');

  await expect
    .poll(async () => {
      const box = await actionBar.boundingBox();
      return box === null ? Number.POSITIVE_INFINITY : box.y + box.height;
    })
    .toBeLessThanOrEqual(569);
  const [barBox, columnBox] = await Promise.all([
    actionBar.boundingBox(),
    page.locator('.config-column').boundingBox(),
  ]);
  expect(barBox).not.toBeNull();
  expect(columnBox).not.toBeNull();
  expect(barBox?.y ?? -1).toBeGreaterThanOrEqual(55);
  expect(barBox?.x ?? 0).toBeGreaterThanOrEqual((columnBox?.x ?? 0) - 1);
  expect((barBox?.x ?? 0) + (barBox?.width ?? 0)).toBeLessThanOrEqual(
    (columnBox?.x ?? 0) + (columnBox?.width ?? 0) + 1
  );
});

test('provides 44-pixel coarse-pointer targets @coarse', async ({ page }) => {
  for (const control of [
    page.getByRole('radio', { name: 'Auto' }),
    page.getByRole('button', { name: /Weather source/ }),
    page.getByRole('button', { name: 'Save configuration' }),
  ]) {
    expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
});

test('lets an unconfigured plugin save defaults', async ({ page }) => {
  await page.goto('/?unconfigured');
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  const saveButton = page.getByRole('button', { name: 'Save configuration' });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '1');
});

test('shows a compatibility message when native CSS scope is unavailable', async ({ page }) => {
  await page.goto('/?unsupported-css-scope');
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.locator('[data-browser-compatibility-message]')).toContainText(
    'Browser update required'
  );
  await expect(page.locator('[data-browser-compatibility-message]')).toContainText(
    'newer browser or embedded WebView'
  );
  await expect(page.locator('[data-snui-root]')).toHaveCount(0);
  await expect(page.locator('style[data-snui-styles]')).toHaveCount(0);
});
