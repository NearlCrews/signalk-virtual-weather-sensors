import type { ReactElement, ReactNode } from 'react';
import { act, useState } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { page, userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import NumberInput from '../../configpanel/components/NumberInput';
import StatusDashboard from '../../configpanel/components/StatusDashboard';
import { S, THEME_STYLE } from '../../configpanel/styles';
import type { PanelStatusResponse } from '../../types';

let container: HTMLDivElement;
let root: Root;

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

beforeEach(async () => {
  await page.viewport(1024, 800);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(element: ReactNode): Promise<void> {
  await act(async () => root.render(element));
}

function NumberHarness(): ReactElement {
  const [value, setValue] = useState(5);
  return (
    <div className="svws-panel" style={S.root}>
      <style>{THEME_STYLE}</style>
      <label htmlFor="interval">Interval</label>
      <NumberInput
        id="interval"
        value={value}
        min={1}
        max={10}
        units="minutes"
        onChange={setValue}
      />
    </div>
  );
}

describe('configuration panel in Chromium', () => {
  it('keeps an invalid number visible and explains how to fix it', async () => {
    await render(<NumberHarness />);
    const input = page.getByRole('spinbutton', { name: 'Interval' });

    await act(async () => {
      await userEvent.fill(input, '99');
      await userEvent.keyboard('{Enter}');
    });

    await expect.element(input).toHaveValue(99);
    await expect.element(input).toBeInvalid();
    await expect.element(page.getByRole('alert')).toHaveTextContent('Enter a value from 1 to 10.');

    await act(async () => {
      await userEvent.fill(input, '7');
      await userEvent.keyboard('{Enter}');
    });

    await expect.element(input).toHaveValue(7);
    await expect.element(input).toBeValid();
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
  });

  it('fits the status card within a narrow marine display', async () => {
    const status: PanelStatusResponse = {
      running: true,
      banner: 'Weather data is current',
      updates: 42,
      quotaUsedLast24h: 8,
      lastUpdateMinutesAgo: 1,
      activeNotifications: 0,
      weatherProviderRegistered: true,
    };

    await page.viewport(375, 800);
    await render(
      <div className="svws-panel" style={S.root}>
        <style>{THEME_STYLE}</style>
        <StatusDashboard
          status={status}
          loading={false}
          lastUpdatedMs={1_000}
          lastAttemptMs={1_000}
          stale={false}
        />
      </div>
    );

    const card = document.querySelector<HTMLElement>('.svws-status-card');
    const info = document.querySelector<HTMLElement>('.svws-card-info');
    expect(card).not.toBeNull();
    expect(info).not.toBeNull();
    if (!card || !info) return;

    expect(getComputedStyle(card).alignItems).toBe('flex-start');
    expect(getComputedStyle(info).minWidth).toBe('0px');
    expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await expect.element(page.getByText('Running', { exact: true })).toBeVisible();
  });
});
