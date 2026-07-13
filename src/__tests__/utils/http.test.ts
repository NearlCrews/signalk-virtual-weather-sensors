import { describe, expect, it } from 'vitest';
import { readBoundedJson } from '../../utils/http.js';

describe('readBoundedJson', () => {
  it('enforces the limit in UTF-8 bytes while streaming', async () => {
    const response = new Response('"😀😀"', {
      headers: { 'content-type': 'application/json' },
    });

    await expect(readBoundedJson(response, 6, 'emoji response')).rejects.toThrow(
      'RESPONSE_TOO_LARGE'
    );
  });

  it('parses a body that fits the byte limit', async () => {
    const response = new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json' },
    });

    await expect(readBoundedJson<{ ok: boolean }>(response, 32)).resolves.toEqual({ ok: true });
  });
});
