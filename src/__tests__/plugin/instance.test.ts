import { describe, expect, it, vi } from 'vitest';
import type { PluginInstance } from '../../plugin/instance.js';
import { setBanner } from '../../plugin/instance.js';

function makeInstance(): PluginInstance {
  const logger = vi.fn();
  logger.redact = (value: string): string => value.replaceAll('secret', '[REDACTED]');
  return {
    lastBanner: null,
    logger,
  } as unknown as PluginInstance;
}

describe('setBanner', () => {
  it('redacts, bounds, and deduplicates admin banner messages', () => {
    const app = { setPluginStatus: vi.fn(), setPluginError: vi.fn() };
    const instance = makeInstance();
    const message = `secret ${'x'.repeat(600)}`;

    setBanner(instance, app as never, 'error', message);
    setBanner(instance, app as never, 'error', message);

    expect(app.setPluginError).toHaveBeenCalledTimes(1);
    const rendered = String(app.setPluginError.mock.calls[0]?.[0]);
    expect(rendered).not.toContain('secret');
    expect(rendered).toHaveLength(512);
    expect(rendered).toMatch(/\.\.\.$/);
  });
});
