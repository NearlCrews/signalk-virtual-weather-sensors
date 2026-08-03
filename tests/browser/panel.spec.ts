import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

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
  await expect(page.locator('[data-snui-root]')).toHaveAttribute('data-snui-version', '0.6.1');
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
  const actionStatus = page.locator('[data-panel-action-bar] [tabindex="-1"]');
  await expect(actionStatus).toBeFocused();
  await expect(saveButton).toHaveAttribute('aria-busy', 'true');
  await expect(actionStatus).toContainText('Saving');
  await expect(actionStatus).toContainText('Plugin restarted', { timeout: 5_000 });
});

test('uses Auto for a fresh profile without persisting an implicit choice', async ({ page }) => {
  const root = page.locator('[data-snui-root]');
  const themeGroup = page.getByRole('radiogroup', { name: 'Panel theme' });
  const light = themeGroup.getByRole('radio', { name: 'Light' });
  const auto = themeGroup.getByRole('radio', { name: 'Auto' });

  await expect(root).not.toHaveAttribute('data-snui-theme');
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

test('blocks a missing AccuWeather key and focuses its field', async ({ page }) => {
  await page.getByRole('button', { name: /Weather source/ }).click();
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('accuweather');
  await expectSaveBlockedAt(page, 'API key');
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

test('has no Axe findings or horizontal overflow at 320 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByRole('button', { name: /Weather source/ }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('responds to a narrow embedded panel inside a wide host', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('main').evaluate((element) => {
    element.style.width = '320px';
    element.style.padding = '0';
  });
  await page.getByRole('button', { name: /Weather source/ }).click();
  const root = page.locator('[data-snui-root]');
  await expect(root).toHaveCSS('width', '320px');
  expect(
    await root.evaluate((element) => element.scrollWidth - element.clientWidth)
  ).toBeLessThanOrEqual(0);
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
  await expect(page.locator('[data-snui-root]')).toHaveCount(0);
});
