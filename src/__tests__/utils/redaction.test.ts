import { describe, expect, it } from 'vitest';
import {
  MAX_REDACTED_TEXT_LENGTH,
  redactSensitiveText,
  redactSensitiveValue,
} from '../../utils/redaction.js';

describe('redaction', () => {
  it('redacts credential forms and registered literal secrets', () => {
    const secret = 'fixture-secret-value';
    const output = redactSensitiveText(
      `Bearer token-value https://user:pass@example.test/?apikey=${secret}`,
      [secret]
    );
    expect(output).not.toContain(secret);
    expect(output).not.toContain('token-value');
    expect(output).not.toContain('user:pass');
  });

  it('bounds untrusted text after redaction', () => {
    const output = redactSensitiveText('x'.repeat(MAX_REDACTED_TEXT_LENGTH + 100));
    expect(output).toHaveLength(MAX_REDACTED_TEXT_LENGTH);
    expect(output).toMatch(/\.\.\.$/);
  });

  it('redacts sensitive keys and circular structured values', () => {
    const value: Record<string, unknown> = { token: 'value' };
    value.self = value;
    expect(redactSensitiveValue(value)).toEqual({
      token: '[REDACTED]',
      self: '[CIRCULAR]',
    });
  });
});
