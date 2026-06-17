/**
 * Unit tests for WarningsService: region dispatch (NWS for US points, empty
 * elsewhere with no network call), URL construction, and best-effort behavior
 * on a fetch failure.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { WarningsService } from '../../services/WarningsService.js';
import { createMockFetchResponse } from '../setup.js';

const MIAMI = { latitude: 25.7743, longitude: -80.1937 };
const NORWAY = { latitude: 60.0, longitude: 10.0 };

describe('WarningsService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches and maps NWS warnings for a US point', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(
      createMockFetchResponse({
        features: [
          {
            properties: {
              event: 'Gale Warning',
              onset: '2026-06-17T10:00:00Z',
              ends: '2026-06-17T22:00:00Z',
              headline: 'Gale Warning',
              senderName: 'NWS Miami FL',
            },
          },
        ],
      })
    );
    const service = new WarningsService();

    const warnings = await service.getWarnings(MIAMI);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.type).toBe('Gale Warning');
    const url = String((global.fetch as Mock).mock.calls[0][0]);
    expect(url).toContain('api.weather.gov/alerts/active?point=25.7743,-80.1937');
  });

  it('returns empty without a network call outside US coverage', async () => {
    const service = new WarningsService();
    const warnings = await service.getWarnings(NORWAY);
    expect(warnings).toEqual([]);
    expect(global.fetch as Mock).not.toHaveBeenCalled();
  });

  it('returns empty on a fetch failure (best-effort)', async () => {
    (global.fetch as Mock).mockResolvedValueOnce(
      createMockFetchResponse('err', { ok: false, status: 500 })
    );
    const service = new WarningsService();
    const warnings = await service.getWarnings(MIAMI);
    expect(warnings).toEqual([]);
  });
});
