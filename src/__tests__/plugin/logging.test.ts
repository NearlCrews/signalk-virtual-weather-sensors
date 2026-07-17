import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../plugin/logging.js';

describe('createLogger', () => {
  it('redacts messages and nested metadata at every log level', () => {
    const app = { debug: vi.fn(), error: vi.fn() };
    const logger = createLogger(app as never);
    const secret = 'secret-api-key-value';
    logger.addSensitiveValue?.(secret);
    logger('info', `Calling https://weather.test/x?apikey=${secret}`, {
      nested: { token: secret, text: `Bearer ${secret}` },
    });
    const line = String(app.debug.mock.calls[0]?.[0]);
    expect(line).not.toContain(secret);
    expect(line).toContain('[REDACTED]');
  });
});
